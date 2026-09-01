/// Image custom elements for raster images, full-colour SVG documents, and
/// tintable SVG icons.
///
/// `<img>` accepts a discriminated source, plus DOM-compatible string sugar:
/// HTTP(S) strings are URLs, `data:` URLs are RFC 2397 image bytes, and every
/// other string is a path. Every source becomes bounded bytes before GPUI
/// decodes it. `<svg>` remains the lightweight monochrome icon element.
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use web_time::Instant;

use futures::AsyncReadExt as _;
use gpui::http_client::HttpRequestExt as _;
use serde::Deserialize;

use super::{CustomElement, CustomElementFactory, CustomRenderContext};

pub(crate) const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const CANVAS_ATLAS_TILE_BUDGET: usize = 64;
const URL_CACHE_CAPACITY: usize = 32;
const MAX_REDIRECTS: usize = 5;
const IMAGE_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const URL_SUCCESS_TTL: Duration = Duration::from_secs(5 * 60);
const URL_FAILURE_RETRY_MIN: Duration = Duration::from_secs(1);
const URL_FAILURE_RETRY_MAX: Duration = Duration::from_secs(30);

/// Network boundary shared by one renderer and every `<img>` it owns.
/// Private development servers are opt-in; link-local and metadata networks
/// remain blocked even when that opt-in is enabled.
#[derive(Clone)]
pub(crate) struct ImageNetworkPolicy {
    allow_private: Arc<AtomicBool>,
    #[cfg(not(target_family = "wasm"))]
    client: Arc<dyn gpui::http_client::HttpClient>,
    request_timeout: Duration,
}

impl Default for ImageNetworkPolicy {
    fn default() -> Self {
        let allow_private = Arc::new(AtomicBool::new(false));
        Self {
            #[cfg(not(target_family = "wasm"))]
            client: restricted_image_http_client(allow_private.clone()),
            allow_private,
            request_timeout: IMAGE_REQUEST_TIMEOUT,
        }
    }
}

impl ImageNetworkPolicy {
    pub(crate) fn set_allow_private(&self, enabled: bool) {
        self.allow_private.store(enabled, Ordering::Relaxed);
    }

    fn allows_private(&self) -> bool {
        self.allow_private.load(Ordering::Relaxed)
    }

    fn client(
        &self,
        fallback: Arc<dyn gpui::http_client::HttpClient>,
    ) -> Arc<dyn gpui::http_client::HttpClient> {
        #[cfg(not(target_family = "wasm"))]
        {
            let _ = fallback;
            self.client.clone()
        }
        #[cfg(target_family = "wasm")]
        {
            fallback
        }
    }
}

#[cfg(not(target_family = "wasm"))]
struct RestrictedImageDnsResolver {
    allow_private: Arc<AtomicBool>,
}

#[cfg(not(target_family = "wasm"))]
impl reqwest::dns::Resolve for RestrictedImageDnsResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        let allow_private = self.allow_private.load(Ordering::Relaxed);
        Box::pin(async move {
            let resolved = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|error| Box::new(error) as Box<dyn std::error::Error + Send + Sync>)?
                .collect::<Vec<_>>();
            if resolved.is_empty() {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("image URL host {host:?} resolved to no addresses"),
                ))
                    as Box<dyn std::error::Error + Send + Sync>);
            }
            for address in &resolved {
                validate_destination_ip(address.ip(), allow_private).map_err(|reason| {
                    Box::new(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        format!("image URL host {host:?} is blocked: {reason}"),
                    )) as Box<dyn std::error::Error + Send + Sync>
                })?;
            }
            Ok(Box::new(resolved.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

#[cfg(not(target_family = "wasm"))]
fn restricted_image_http_client(
    allow_private: Arc<AtomicBool>,
) -> Arc<dyn gpui::http_client::HttpClient> {
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .connect_timeout(Duration::from_secs(10))
        .tcp_keepalive(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(30))
        .http2_keep_alive_interval(Duration::from_secs(15))
        .http2_keep_alive_timeout(Duration::from_secs(10))
        .http2_keep_alive_while_idle(true)
        // A proxy can resolve the destination outside this policy boundary.
        .no_proxy()
        .user_agent(concat!("GPUIX/", env!("CARGO_PKG_VERSION")))
        .dns_resolver(Arc::new(RestrictedImageDnsResolver { allow_private }))
        .build()
        .expect("failed to initialize the restricted image HTTP client");
    Arc::new(reqwest_client::ReqwestClient::from(client))
}

pub struct ImgFactory;

pub struct SvgFactory;

impl CustomElementFactory for SvgFactory {
    fn element_type(&self) -> &str {
        "svg"
    }

    fn create(&self, _id: u64) -> Box<dyn CustomElement> {
        Box::new(SvgElement::default())
    }
}

impl CustomElementFactory for ImgFactory {
    fn element_type(&self) -> &str {
        "img"
    }

    fn create(&self, _id: u64) -> Box<dyn CustomElement> {
        Box::new(ImgElement::default())
    }
}

#[derive(Debug, Clone)]
enum ImgObjectFit {
    Fill,
    Contain,
    Cover,
    ScaleDown,
    None,
}

impl Default for ImgObjectFit {
    fn default() -> Self {
        Self::Contain
    }
}

impl ImgObjectFit {
    fn from_str(value: &str) -> Self {
        match value {
            "fill" => Self::Fill,
            "cover" => Self::Cover,
            "scaleDown" => Self::ScaleDown,
            "none" => Self::None,
            _ => Self::Contain,
        }
    }

    fn as_gpui(&self) -> gpui::ObjectFit {
        match self {
            Self::Fill => gpui::ObjectFit::Fill,
            Self::Contain => gpui::ObjectFit::Contain,
            Self::Cover => gpui::ObjectFit::Cover,
            Self::ScaleDown => gpui::ObjectFit::ScaleDown,
            Self::None => gpui::ObjectFit::None,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) enum ImageSource {
    Path(String),
    Url(String),
    Data {
        /// Structured sources name a supported decoder. A `data:` URL whose
        /// Fetch MIME type is missing or unsupported deliberately leaves this
        /// empty so image decoding follows the browser's byte-sniffing path.
        mime_type: Option<String>,
        bytes: Arc<[u8]>,
    },
}

// Data sources keep one Arc while their retained prop is unchanged. Identity
// equality keeps GPUI's per-frame asset lookup from hashing or comparing up to
// 10 MiB of bytes on every paint.
impl PartialEq for ImageSource {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Path(left), Self::Path(right)) | (Self::Url(left), Self::Url(right)) => {
                left == right
            }
            (
                Self::Data {
                    mime_type: left_mime,
                    bytes: left_bytes,
                },
                Self::Data {
                    mime_type: right_mime,
                    bytes: right_bytes,
                },
            ) => left_mime == right_mime && Arc::ptr_eq(left_bytes, right_bytes),
            _ => false,
        }
    }
}

impl Eq for ImageSource {}

impl Hash for ImageSource {
    fn hash<H: Hasher>(&self, state: &mut H) {
        std::mem::discriminant(self).hash(state);
        match self {
            Self::Path(path) => path.hash(state),
            Self::Url(url) => url.hash(state),
            Self::Data { mime_type, bytes } => {
                mime_type.hash(state);
                bytes.as_ptr().hash(state);
                bytes.len().hash(state);
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, tag = "kind", rename_all = "lowercase")]
enum WireImageSource {
    Path {
        path: String,
    },
    Url {
        url: String,
    },
    Data {
        #[serde(rename = "mimeType")]
        mime_type: String,
        bytes: Vec<u8>,
    },
}

impl ImageSource {
    pub(crate) fn parse(value: &serde_json::Value) -> Result<Self, String> {
        if let Some(source) = value.as_str() {
            return if is_data_url(source) {
                let (mime_type, bytes) = parse_data_url(source)?;
                Ok(Self::Data {
                    mime_type,
                    bytes: bytes.into(),
                })
            } else if source.starts_with("http://") || source.starts_with("https://") {
                parse_image_url(source)?;
                Ok(Self::Url(source.to_string()))
            } else if source.trim().is_empty() {
                Err("path must not be empty".into())
            } else {
                Ok(Self::Path(source.to_string()))
            };
        }

        let source: WireImageSource = serde_json::from_value(value.clone()).map_err(|error| {
            format!(
                "expected a path or HTTP(S) URL string, {{ kind: \"path\", path }}, {{ kind: \"url\", url }}, or {{ kind: \"data\", mimeType, bytes }}: {error}"
            )
        })?;

        match source {
            WireImageSource::Path { path } => {
                if path.trim().is_empty() {
                    return Err("path must not be empty".into());
                }
                Ok(Self::Path(path))
            }
            WireImageSource::Url { url } => {
                parse_image_url(&url)?;
                Ok(Self::Url(url))
            }
            WireImageSource::Data { mime_type, bytes } => {
                let mime_type = normalize_mime_type(&mime_type);
                supported_image_format(&mime_type)?;
                ensure_size(bytes.len(), "data source")?;
                Ok(Self::Data {
                    mime_type: Some(mime_type),
                    bytes: bytes.into(),
                })
            }
        }
    }

    pub(crate) fn label(&self) -> String {
        match self {
            Self::Path(path) => format!("path {path:?}"),
            Self::Url(url) => format!("URL {:?}", redacted_url(url)),
            Self::Data { mime_type, bytes } => {
                let source = mime_type.as_deref().unwrap_or("sniffed");
                format!("{source} data ({} bytes)", bytes.len())
            }
        }
    }
}

fn is_data_url(source: &str) -> bool {
    source
        .get(..5)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("data:"))
}

/// Process a `data:` URL using Fetch's deployed-content-compatible grammar.
/// The decoder hint is absent when Fetch's MIME record is not one GPUI can
/// decode directly; then `load_image` image-sniffs the bytes as browsers do.
fn parse_data_url(source: &str) -> Result<(Option<String>, Vec<u8>), String> {
    let payload = source
        .get(5..)
        .ok_or_else(|| "invalid data URL: missing data: scheme".to_string())?;
    let (media_type, data) = payload
        .split_once(',')
        .ok_or_else(|| "invalid data URL: missing comma before data".to_string())?;

    let media_type = media_type.trim_matches(|character: char| character.is_ascii_whitespace());
    let (media_type, base64) = split_terminal_base64_marker(media_type);
    let media_type = if media_type.starts_with(';') {
        format!("text/plain{media_type}")
    } else {
        media_type.to_string()
    };
    let mime_type = normalize_mime_type(&media_type);
    let mime_type = supported_image_format(&mime_type).ok().map(|_| mime_type);

    let data = percent_decode_data_url(data);
    let bytes = if base64 {
        decode_forgiving_base64(&data)?
    } else {
        data
    };
    ensure_size(bytes.len(), "data URL")?;
    Ok((mime_type, bytes))
}

/// Fetch asks URL to percent-decode the body. Invalid percent escapes remain
/// literal, rather than making the URL processor fail on their own.
fn percent_decode_data_url(data: &str) -> Vec<u8> {
    let bytes = data.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        let high = bytes
            .get(index + 1)
            .and_then(|digit| (*digit as char).to_digit(16));
        let low = bytes
            .get(index + 2)
            .and_then(|digit| (*digit as char).to_digit(16));
        if let (Some(high), Some(low)) = (high, low) {
            decoded.push((high << 4 | low) as u8);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    decoded
}

/// Fetch recognizes the `base64` signal only as the terminal `; *base64`
/// production. An earlier parameter named base64 is ordinary metadata.
fn split_terminal_base64_marker(media_type: &str) -> (&str, bool) {
    let Some(marker_start) = media_type.len().checked_sub("base64".len()) else {
        return (media_type, false);
    };
    let (before_marker, marker) = media_type.split_at(marker_start);
    if !marker.eq_ignore_ascii_case("base64") {
        return (media_type, false);
    }
    let before_marker = before_marker.trim_end_matches(' ');
    let Some(media_type) = before_marker.strip_suffix(';') else {
        return (media_type, false);
    };
    (media_type, true)
}

/// Infra's forgiving-base64 algorithm deliberately differs from canonical
/// RFC 4648 decoding: it rejects partial padding, but discards unused bits.
fn decode_forgiving_base64(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoded = data
        .iter()
        .copied()
        .filter(|byte| !matches!(byte, b'\t' | b'\n' | b'\x0c' | b'\r' | b' '))
        .collect::<Vec<_>>();
    if encoded.len() % 4 == 0 {
        if encoded.ends_with(b"==") {
            encoded.truncate(encoded.len() - 2);
        } else if encoded.ends_with(b"=") {
            encoded.truncate(encoded.len() - 1);
        }
    }
    if encoded.len() % 4 == 1 {
        return Err("invalid data URL: invalid base64 payload length".into());
    }

    let mut output = Vec::with_capacity(encoded.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u8;
    for byte in encoded {
        let value = base64_value(byte)
            .ok_or_else(|| "invalid data URL: invalid base64 payload".to_string())?;
        buffer = buffer << 6 | u32::from(value);
        bits += 6;
        if bits == 24 {
            output.extend_from_slice(&buffer.to_be_bytes()[1..]);
            buffer = 0;
            bits = 0;
        }
    }
    match bits {
        0 => {}
        12 => output.push((buffer >> 4) as u8),
        18 => output.extend_from_slice(&[(buffer >> 10) as u8, (buffer >> 2) as u8]),
        _ => unreachable!("base64 length modulo four rules out this remainder"),
    }
    Ok(output)
}

fn base64_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

fn parse_image_url(url: &str) -> Result<gpui::http_client::Url, String> {
    let parsed =
        gpui::http_client::Url::parse(url).map_err(|error| format!("invalid URL: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!(
            "unsupported URL scheme {:?}; expected http or https",
            parsed.scheme()
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("credentials in image URLs are not allowed".into());
    }
    if parsed.host().is_none() {
        return Err("image URL must include a host".into());
    }
    Ok(parsed)
}

fn redacted_url(url: &str) -> String {
    let Ok(mut parsed) = gpui::http_client::Url::parse(url) else {
        return "<invalid image URL>".into();
    };
    let _ = parsed.set_password(None);
    let _ = parsed.set_username("");
    parsed.set_query(None);
    parsed.set_fragment(None);
    parsed.to_string()
}

fn validate_url_destination(
    url: &gpui::http_client::Url,
    allow_private: bool,
) -> Result<(), String> {
    match url.host() {
        Some(gpui::http_client::Host::Ipv4(address)) => {
            validate_destination_ip(IpAddr::V4(address), allow_private)
        }
        Some(gpui::http_client::Host::Ipv6(address)) => {
            validate_destination_ip(IpAddr::V6(address), allow_private)
        }
        Some(gpui::http_client::Host::Domain(_)) => Ok(()),
        None => Err("image URL must include a host".into()),
    }
}

fn validate_destination_ip(address: IpAddr, allow_private: bool) -> Result<(), String> {
    match address {
        IpAddr::V4(address) => validate_ipv4_destination(address, allow_private),
        IpAddr::V6(address) => {
            if let Some(mapped) = address.to_ipv4_mapped() {
                return validate_ipv4_destination(mapped, allow_private);
            }
            validate_ipv6_destination(address, allow_private)
        }
    }
}

fn validate_ipv4_destination(address: Ipv4Addr, allow_private: bool) -> Result<(), String> {
    let octets = address.octets();
    let carrier_grade_nat = octets[0] == 100 && (octets[1] & 0xc0) == 0x40;
    let reserved = octets[0] == 0
        || address.is_multicast()
        || address == Ipv4Addr::BROADCAST
        || octets[0] >= 240;
    if address.is_link_local() || carrier_grade_nat {
        return Err(format!(
            "link-local and cloud-metadata address {address} is never allowed"
        ));
    }
    if reserved {
        return Err(format!("reserved address {address} is not allowed"));
    }
    if (address.is_loopback() || address.is_private()) && !allow_private {
        return Err(format!(
            "private network address {address} is disabled; set allowPrivateNetworkImages on the renderer to opt in"
        ));
    }
    Ok(())
}

fn validate_ipv6_destination(address: Ipv6Addr, allow_private: bool) -> Result<(), String> {
    let first_segment = address.segments()[0];
    let link_local = (first_segment & 0xffc0) == 0xfe80;
    let unique_local = (first_segment & 0xfe00) == 0xfc00;
    if link_local {
        return Err(format!(
            "link-local and cloud-metadata address {address} is never allowed"
        ));
    }
    if address.is_unspecified() || address.is_multicast() {
        return Err(format!("reserved address {address} is not allowed"));
    }
    if (address.is_loopback() || unique_local) && !allow_private {
        return Err(format!(
            "private network address {address} is disabled; set allowPrivateNetworkImages on the renderer to opt in"
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct ImageRequest {
    source: ImageSource,
    current_color: Option<u32>,
}

#[derive(Clone, Debug)]
struct LoadedBytes {
    bytes: Arc<[u8]>,
    mime_type: Option<String>,
}

#[derive(Clone)]
struct CachedUrl {
    loaded: LoadedBytes,
    effective_url: String,
    etag: Option<String>,
    last_modified: Option<String>,
    last_used: u64,
}

#[derive(Default)]
struct UrlCache {
    entries: HashMap<String, CachedUrl>,
    clock: u64,
}

impl UrlCache {
    fn get(&mut self, url: &str) -> Option<CachedUrl> {
        self.clock = self.clock.wrapping_add(1);
        let cached = self.entries.get_mut(url)?;
        cached.last_used = self.clock;
        Some(cached.clone())
    }

    fn insert(&mut self, url: String, mut cached: CachedUrl) {
        self.clock = self.clock.wrapping_add(1);
        cached.last_used = self.clock;
        self.entries.insert(url, cached);

        if self.entries.len() > URL_CACHE_CAPACITY {
            if let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(url, _)| url.clone())
            {
                self.entries.remove(&oldest);
            }
        }
    }
}

static URL_CACHE: OnceLock<Mutex<UrlCache>> = OnceLock::new();

fn url_cache() -> &'static Mutex<UrlCache> {
    URL_CACHE.get_or_init(|| Mutex::new(UrlCache::default()))
}

fn normalize_mime_type(mime_type: &str) -> String {
    mime_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn supported_image_format(mime_type: &str) -> Result<gpui::ImageFormat, String> {
    let format = gpui::ImageFormat::from_mime_type(mime_type)
        .ok_or_else(|| format!("unsupported MIME type {mime_type:?}"))?;
    match format {
        gpui::ImageFormat::Png
        | gpui::ImageFormat::Jpeg
        | gpui::ImageFormat::Webp
        | gpui::ImageFormat::Gif
        | gpui::ImageFormat::Svg => Ok(format),
        _ => Err(format!("unsupported MIME type {mime_type:?}")),
    }
}

fn ensure_size(size: usize, source: &str) -> Result<(), String> {
    if size > MAX_IMAGE_BYTES {
        Err(format!(
            "{source} is {size} bytes; the maximum image size is {MAX_IMAGE_BYTES} bytes (10 MiB)"
        ))
    } else {
        Ok(())
    }
}

fn sniff_image_format(bytes: &[u8]) -> Result<gpui::ImageFormat, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok(gpui::ImageFormat::Png);
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Ok(gpui::ImageFormat::Jpeg);
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Ok(gpui::ImageFormat::Webp);
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok(gpui::ImageFormat::Gif);
    }

    let text = std::str::from_utf8(bytes)
        .map_err(|_| "bytes do not match PNG, JPEG, WebP, GIF, or SVG".to_string())?;
    let text = text.trim_start_matches('\u{feff}').trim_start();
    if text.get(..4096).unwrap_or(text).contains("<svg") {
        return Ok(gpui::ImageFormat::Svg);
    }

    Err("bytes do not match PNG, JPEG, WebP, GIF, or SVG".into())
}

fn replace_current_color(bytes: &[u8], color: u32) -> Result<Vec<u8>, String> {
    let source =
        std::str::from_utf8(bytes).map_err(|error| format!("SVG is not valid UTF-8: {error}"))?;
    let replacement = format!("#{color:08x}");
    let source_bytes = source.as_bytes();
    let mut output = String::with_capacity(source.len());
    let mut index = 0;
    let mut style_depth = 0usize;

    while index < source_bytes.len() {
        if source_bytes[index] != b'<' {
            let end = source_bytes[index..]
                .iter()
                .position(|byte| *byte == b'<')
                .map_or(source_bytes.len(), |offset| index + offset);
            let text = &source[index..end];
            if style_depth > 0 {
                output.push_str(&replace_css_current_color(
                    text,
                    &replacement,
                    CssContext::Stylesheet,
                ));
            } else {
                output.push_str(text);
            }
            index = end;
            continue;
        }

        let end = find_xml_tag_end(source_bytes, index)
            .ok_or_else(|| "SVG contains an unterminated XML tag".to_string())?;
        let tag = &source[index..=end];
        let tag_info = xml_tag_info(tag);
        output.push_str(&rewrite_xml_tag(tag, &replacement));
        if let Some((closing, is_style, self_closing)) = tag_info {
            if is_style {
                if closing {
                    style_depth = style_depth.saturating_sub(1);
                } else if !self_closing {
                    style_depth += 1;
                }
            }
        }
        index = end + 1;
    }

    Ok(output.into_bytes())
}

fn find_xml_tag_end(bytes: &[u8], start: usize) -> Option<usize> {
    if bytes[start..].starts_with(b"<!--") {
        return bytes[start + 4..]
            .windows(3)
            .position(|window| window == b"-->")
            .map(|offset| start + 4 + offset + 2);
    }
    if bytes[start..].starts_with(b"<![CDATA[") {
        return bytes[start + 9..]
            .windows(3)
            .position(|window| window == b"]]>")
            .map(|offset| start + 9 + offset + 2);
    }

    let mut quote = None;
    for (offset, byte) in bytes[start + 1..].iter().copied().enumerate() {
        match (quote, byte) {
            (Some(expected), current) if expected == current => quote = None,
            (None, b'\'' | b'"') => quote = Some(byte),
            (None, b'>') => return Some(start + 1 + offset),
            _ => {}
        }
    }
    None
}

fn xml_tag_info(tag: &str) -> Option<(bool, bool, bool)> {
    let bytes = tag.as_bytes();
    if bytes.starts_with(b"<!--") || bytes.starts_with(b"<!") || bytes.starts_with(b"<?") {
        return None;
    }
    let mut index = 1;
    while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
        index += 1;
    }
    let closing = bytes.get(index) == Some(&b'/');
    if closing {
        index += 1;
    }
    while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
        index += 1;
    }
    let start = index;
    while bytes
        .get(index)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-'))
    {
        index += 1;
    }
    (start < index).then(|| {
        let name = &tag[start..index];
        (
            closing,
            name.eq_ignore_ascii_case("style"),
            tag[..tag.len().saturating_sub(1)].trim_end().ends_with('/'),
        )
    })
}

fn rewrite_xml_tag(tag: &str, replacement: &str) -> String {
    if xml_tag_info(tag).is_none() {
        return tag.to_string();
    }

    let bytes = tag.as_bytes();
    let mut output = String::with_capacity(tag.len());
    let mut copied_through = 0;
    let mut index = 1;
    while index < bytes.len() && bytes[index] != b'>' {
        while index < bytes.len() && (bytes[index].is_ascii_whitespace() || bytes[index] == b'/') {
            index += 1;
        }
        let name_start = index;
        while index < bytes.len()
            && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b':' | b'_' | b'-'))
        {
            index += 1;
        }
        if name_start == index {
            index += 1;
            continue;
        }
        let name = &tag[name_start..index];
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if bytes.get(index) != Some(&b'=') {
            continue;
        }
        index += 1;
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        let Some(quote @ (b'\'' | b'"')) = bytes.get(index).copied() else {
            continue;
        };
        let value_start = index + 1;
        let Some(relative_end) = bytes[value_start..].iter().position(|byte| *byte == quote) else {
            return tag.to_string();
        };
        let value_end = value_start + relative_end;
        let value = &tag[value_start..value_end];
        let rewritten = if name.eq_ignore_ascii_case("style") {
            Some(replace_css_current_color(
                value,
                replacement,
                CssContext::InlineDeclarations,
            ))
        } else if is_svg_color_attribute(name) {
            Some(replace_css_current_color(
                value,
                replacement,
                CssContext::ColorValue,
            ))
        } else {
            None
        };
        if let Some(rewritten) = rewritten {
            output.push_str(&tag[copied_through..value_start]);
            output.push_str(&rewritten);
            copied_through = value_end;
        }
        index = value_end + 1;
    }
    output.push_str(&tag[copied_through..]);
    output
}

fn is_svg_color_attribute(name: &str) -> bool {
    [
        "color",
        "fill",
        "stroke",
        "stop-color",
        "flood-color",
        "lighting-color",
        "solid-color",
    ]
    .iter()
    .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

#[derive(Clone, Copy)]
enum CssContext {
    Stylesheet,
    InlineDeclarations,
    ColorValue,
}

fn replace_css_current_color(source: &str, replacement: &str, context: CssContext) -> String {
    let bytes = source.as_bytes();
    let mut output = String::with_capacity(source.len());
    let mut index = 0;
    let mut copied_through = 0;
    let mut brace_depth = 0usize;
    let mut in_value = matches!(context, CssContext::ColorValue);
    let mut function_stack = Vec::new();

    while index < bytes.len() {
        if bytes[index..].starts_with(b"/*") {
            index = bytes[index + 2..]
                .windows(2)
                .position(|window| window == b"*/")
                .map_or(bytes.len(), |offset| index + 2 + offset + 2);
            continue;
        }
        if matches!(bytes[index], b'\'' | b'"') {
            let quote = bytes[index];
            index += 1;
            while index < bytes.len() {
                if bytes[index] == b'\\' {
                    index = (index + 2).min(bytes.len());
                } else if bytes[index] == quote {
                    index += 1;
                    break;
                } else {
                    index += 1;
                }
            }
            continue;
        }

        match bytes[index] {
            b'{' => {
                brace_depth += 1;
                in_value = false;
                index += 1;
                continue;
            }
            b'}' => {
                brace_depth = brace_depth.saturating_sub(1);
                in_value = false;
                index += 1;
                continue;
            }
            b':' if matches!(context, CssContext::InlineDeclarations)
                || (matches!(context, CssContext::Stylesheet) && brace_depth > 0) =>
            {
                in_value = true;
                index += 1;
                continue;
            }
            b';' if !matches!(context, CssContext::ColorValue) => {
                in_value = false;
                index += 1;
                continue;
            }
            b'(' => {
                let mut end = index;
                while end > 0 && bytes[end - 1].is_ascii_whitespace() {
                    end -= 1;
                }
                let mut start = end;
                while start > 0
                    && (bytes[start - 1].is_ascii_alphanumeric()
                        || matches!(bytes[start - 1], b'_' | b'-'))
                {
                    start -= 1;
                }
                function_stack.push(source[start..end].eq_ignore_ascii_case("url"));
                index += 1;
                continue;
            }
            b')' => {
                function_stack.pop();
                index += 1;
                continue;
            }
            _ => {}
        }

        if bytes[index].is_ascii_alphabetic() || matches!(bytes[index], b'_' | b'-') {
            let token_start = index;
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b'_' | b'-'))
            {
                index += 1;
            }
            if in_value
                && !function_stack.iter().any(|inside_url| *inside_url)
                && source[token_start..index].eq_ignore_ascii_case("currentcolor")
            {
                output.push_str(&source[copied_through..token_start]);
                output.push_str(replacement);
                copied_through = index;
            }
            continue;
        }
        index += 1;
    }
    output.push_str(&source[copied_through..]);
    output
}

fn add_validator_headers(
    mut builder: gpui::http_client::Builder,
    cached: Option<&CachedUrl>,
) -> gpui::http_client::Builder {
    if let Some(etag) = cached.and_then(|entry| entry.etag.as_deref()) {
        builder = builder.header(gpui::http_client::http::header::IF_NONE_MATCH, etag);
    }
    if let Some(last_modified) = cached.and_then(|entry| entry.last_modified.as_deref()) {
        builder = builder.header(
            gpui::http_client::http::header::IF_MODIFIED_SINCE,
            last_modified,
        );
    }
    builder
}

async fn read_limited(
    body: &mut gpui::http_client::AsyncBody,
    source: &str,
) -> Result<Arc<[u8]>, String> {
    let mut bytes = Vec::new();
    body.take((MAX_IMAGE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| format!("failed to read {source}"))?;
    ensure_size(bytes.len(), source)?;
    Ok(bytes.into())
}

async fn load_url(
    url: &str,
    client: Arc<dyn gpui::http_client::HttpClient>,
    policy: &ImageNetworkPolicy,
) -> Result<LoadedBytes, String> {
    let cached = url_cache().lock().unwrap().get(url);
    let mut current = parse_image_url(url)?;
    current.set_fragment(None);
    let started_at = Instant::now();

    for redirect_count in 0..=MAX_REDIRECTS {
        validate_url_destination(&current, policy.allows_private())?;
        let safe_url = redacted_url(current.as_str());
        let remaining = policy
            .request_timeout
            .checked_sub(started_at.elapsed())
            .ok_or_else(|| format!("image request for {safe_url:?} timed out"))?;
        let validators = cached
            .as_ref()
            .filter(|entry| entry.effective_url == current.as_str());
        let request = add_validator_headers(
            gpui::http_client::Builder::new()
                .uri(current.as_str())
                .follow_redirects(gpui::http_client::RedirectPolicy::NoFollow)
                .timeout(remaining),
            validators,
        )
        .body(().into())
        .map_err(|_| format!("failed to build image request for {safe_url:?}"))?;

        let mut response = client
            .send(request)
            .await
            .map_err(|_| format!("failed to load image from {safe_url:?}"))?;

        if response.status() == gpui::http_client::StatusCode::NOT_MODIFIED {
            return validators
                .map(|entry| entry.loaded.clone())
                .ok_or_else(|| format!("{safe_url:?} returned an unsolicited 304 response"));
        }

        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err(format!(
                    "image request for {safe_url:?} exceeded {MAX_REDIRECTS} redirects"
                ));
            }
            let location = response
                .headers()
                .get(gpui::http_client::http::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| {
                    format!("image redirect from {safe_url:?} has no valid Location header")
                })?;
            current = current
                .join(location)
                .map_err(|_| format!("image redirect from {safe_url:?} has an invalid target"))?;
            // Reject credentials and schemes before the redirected request is built.
            current = parse_image_url(current.as_str())?;
            current.set_fragment(None);
            continue;
        }

        if !response.status().is_success() {
            return Err(format!(
                "image request for {safe_url:?} returned {}",
                response.status()
            ));
        }

        if let Some(content_length) = response
            .headers()
            .get(gpui::http_client::http::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<usize>().ok())
        {
            ensure_size(content_length, &format!("response from {safe_url:?}"))?;
        }

        let mime_type = response
            .headers()
            .get(gpui::http_client::http::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(normalize_mime_type);
        if let Some(mime_type) = mime_type.as_deref() {
            supported_image_format(mime_type)?;
        }

        let etag = response
            .headers()
            .get(gpui::http_client::http::header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let last_modified = response
            .headers()
            .get(gpui::http_client::http::header::LAST_MODIFIED)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let bytes =
            read_limited(response.body_mut(), &format!("response from {safe_url:?}")).await?;
        let loaded = LoadedBytes { bytes, mime_type };
        url_cache().lock().unwrap().insert(
            url.to_string(),
            CachedUrl {
                loaded: loaded.clone(),
                effective_url: current.to_string(),
                etag,
                last_modified,
                last_used: 0,
            },
        );
        return Ok(loaded);
    }

    unreachable!("redirect loop returns or continues within its fixed bound")
}

async fn load_source(
    source: &ImageSource,
    client: Arc<dyn gpui::http_client::HttpClient>,
    policy: &ImageNetworkPolicy,
) -> Result<LoadedBytes, String> {
    match source {
        ImageSource::Path(path) => {
            #[cfg(target_family = "wasm")]
            {
                let _ = path;
                Err("path image sources are not available in browser builds".into())
            }
            #[cfg(not(target_family = "wasm"))]
            {
                if let Ok(metadata) = std::fs::metadata(path) {
                    ensure_size(metadata.len() as usize, &format!("file {path:?}"))?;
                }
                let bytes = std::fs::read(path)
                    .map_err(|error| format!("failed to read image file {path:?}: {error}"))?;
                ensure_size(bytes.len(), &format!("file {path:?}"))?;
                Ok(LoadedBytes {
                    bytes: bytes.into(),
                    mime_type: None,
                })
            }
        }
        ImageSource::Url(url) => load_url(url, client, policy).await,
        ImageSource::Data { mime_type, bytes } => Ok(LoadedBytes {
            bytes: bytes.clone(),
            mime_type: mime_type.clone(),
        }),
    }
}

type ImageLoadResult = Result<Arc<gpui::RenderImage>, gpui::ImageCacheError>;

async fn load_image(
    request: ImageRequest,
    client: Arc<dyn gpui::http_client::HttpClient>,
    svg_renderer: gpui::SvgRenderer,
    policy: ImageNetworkPolicy,
) -> ImageLoadResult {
    let mut loaded = load_source(&request.source, client, &policy)
        .await
        .map_err(|error| gpui::ImageCacheError::Other(Arc::new(anyhow::anyhow!(error))))?;
    let format = match loaded.mime_type.as_deref() {
        Some(mime_type) => supported_image_format(mime_type),
        None => sniff_image_format(&loaded.bytes),
    }
    .map_err(|error| gpui::ImageCacheError::Other(Arc::new(anyhow::anyhow!(error))))?;

    if let Some(color) = request.current_color {
        if format != gpui::ImageFormat::Svg {
            return Err(gpui::ImageCacheError::Other(Arc::new(anyhow::anyhow!(
                "tint=\"currentColor\" is only supported for SVG images"
            ))));
        }
        loaded.bytes = replace_current_color(&loaded.bytes, color)
            .map(Arc::from)
            .map_err(|error| gpui::ImageCacheError::Other(Arc::new(anyhow::anyhow!(error))))?;
    }

    gpui::Image::from_bytes(format, loaded.bytes.to_vec())
        .to_image_data(svg_renderer)
        .map_err(|error| gpui::ImageCacheError::Other(Arc::new(error)))
}

#[derive(Clone, Debug)]
pub(crate) struct CanvasImageSource {
    pub key: String,
    pub source: ImageSource,
}

impl PartialEq for CanvasImageSource {
    fn eq(&self, other: &Self) -> bool {
        self.key == other.key
    }
}

#[derive(Default)]
struct CanvasImageEntry {
    source: Option<ImageSource>,
    users: HashSet<u64>,
    observers: HashSet<u64>,
    result: Option<ImageLoadResult>,
    opacity_variants: HashMap<u8, Arc<gpui::RenderImage>>,
    loading: bool,
    reload_due: bool,
    retry_attempt: u32,
}

impl CanvasImageEntry {
    fn take_loaded_images(&mut self) -> Vec<Arc<gpui::RenderImage>> {
        let mut images: Vec<_> = self
            .opacity_variants
            .drain()
            .map(|(_, image)| image)
            .collect();
        if let Some(Ok(image)) = self.result.take() {
            images.push(image);
        }
        images
    }
}

fn render_image_with_opacity(image: &gpui::RenderImage, opacity: u8) -> Option<gpui::RenderImage> {
    let mut frames = Vec::with_capacity(image.frame_count());
    for frame_index in 0..image.frame_count() {
        let size = image.size(frame_index);
        let width = u32::try_from(size.width.0).ok()?;
        let height = u32::try_from(size.height.0).ok()?;
        let mut bytes = image.as_bytes(frame_index)?.to_vec();
        for pixel in bytes.chunks_exact_mut(4) {
            pixel[3] = ((u16::from(pixel[3]) * u16::from(opacity) + 127) / 255) as u8;
        }
        let buffer = image::RgbaImage::from_raw(width, height, bytes)?;
        frames.push(image::Frame::from_parts(
            buffer,
            0,
            0,
            image.delay(frame_index),
        ));
    }
    Some(gpui::RenderImage::new(frames))
}

#[derive(Clone, Default)]
struct CanvasImageTestStats {
    source_count: usize,
    loaded_count: usize,
    painted_ids: HashSet<gpui::ImageId>,
    atlas_ids: HashSet<gpui::ImageId>,
    released_atlas_tiles: usize,
}

struct CanvasAtlasResident {
    image: Arc<gpui::RenderImage>,
    last_painted: u64,
}

#[derive(Default)]
struct CanvasImageStore {
    entries: HashMap<String, CanvasImageEntry>,
    observer_keys: HashMap<u64, String>,
    atlas_residents: HashMap<gpui::ImageId, CanvasAtlasResident>,
    live_atlas_ids: HashMap<u64, HashSet<gpui::ImageId>>,
    atlas_clock: u64,
    revision: u64,
    test_stats: HashMap<u64, CanvasImageTestStats>,
}

impl CanvasImageStore {
    fn forget_atlas_resident(&mut self, image_id: gpui::ImageId) {
        if self.atlas_residents.remove(&image_id).is_none() {
            return;
        }
        for stats in self.test_stats.values_mut() {
            if stats.atlas_ids.remove(&image_id) {
                stats.released_atlas_tiles += 1;
            }
        }
    }

    fn remove_entry(&mut self, key: &str) -> Vec<Arc<gpui::RenderImage>> {
        let images = self
            .entries
            .remove(key)
            .map(|mut entry| entry.take_loaded_images())
            .unwrap_or_default();
        for image in &images {
            self.forget_atlas_resident(image.id);
        }
        images
    }

    fn take_atlas_evictions(&mut self) -> Vec<Arc<gpui::RenderImage>> {
        let mut evictions = Vec::new();
        while self.atlas_residents.len() > CANVAS_ATLAS_TILE_BUDGET {
            let candidate = self
                .atlas_residents
                .iter()
                .filter(|(image_id, _)| {
                    !self
                        .live_atlas_ids
                        .values()
                        .any(|live_ids| live_ids.contains(*image_id))
                })
                .min_by_key(|(_, resident)| resident.last_painted)
                .map(|(image_id, _)| *image_id);
            let Some(image_id) = candidate else {
                break;
            };
            let resident = self
                .atlas_residents
                .remove(&image_id)
                .expect("the selected canvas atlas resident must still exist");
            for stats in self.test_stats.values_mut() {
                if stats.atlas_ids.remove(&image_id) {
                    stats.released_atlas_tiles += 1;
                }
            }
            evictions.push(resident.image);
        }
        evictions
    }
}

/// Renderer-local image cache for retained canvas display lists.
///
/// Entries are keyed by the serialised source rather than a JS object handle,
/// so two canvases drawing the same URL/path/data source share one decode and
/// one `RenderImage`. Decoded images may outlive their canvas references for
/// observers and cheap reuse, while GPU residency is a separate 64-tile LRU.
/// Exact image variants referenced by a live display list are never eviction
/// candidates; a live set larger than the budget is allowed to exceed it.
#[derive(Clone, Default)]
pub(crate) struct SharedCanvasImageStore {
    state: Arc<Mutex<CanvasImageStore>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CanvasImageLoadState {
    Loading,
    Loaded { width: u32, height: u32 },
    Error { message: String },
}

impl SharedCanvasImageStore {
    pub(crate) fn revision(&self) -> u64 {
        self.state.lock().unwrap().revision
    }

    pub(crate) fn loaded_with_opacity(
        &self,
        key: &str,
        opacity: f32,
    ) -> Option<Arc<gpui::RenderImage>> {
        let opacity = (opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
        let mut state = self.state.lock().unwrap();
        let entry = state.entries.get_mut(key)?;
        let image = entry.result.as_ref()?.as_ref().ok()?.clone();
        if opacity == u8::MAX {
            return Some(image);
        }
        if let Some(variant) = entry.opacity_variants.get(&opacity) {
            return Some(variant.clone());
        }
        let variant = Arc::new(render_image_with_opacity(&image, opacity)?);
        entry.opacity_variants.insert(opacity, variant.clone());
        Some(variant)
    }

    pub(crate) fn observe(
        &self,
        observer_id: u64,
        source: CanvasImageSource,
        policy: ImageNetworkPolicy,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) {
        self.release_observer(observer_id, window);
        let should_load = {
            let mut state = self.state.lock().unwrap();
            state.observer_keys.insert(observer_id, source.key.clone());
            let entry = state.entries.entry(source.key.clone()).or_default();
            entry.source.get_or_insert(source.source.clone());
            entry.observers.insert(observer_id);
            if !entry.loading && entry.result.is_none() {
                entry.loading = true;
                true
            } else {
                false
            }
        };
        if should_load {
            self.start_load(source.key, source.source, policy, cx);
        }
    }

    pub(crate) fn observer_state(&self, observer_id: u64) -> Option<CanvasImageLoadState> {
        let state = self.state.lock().unwrap();
        let key = state.observer_keys.get(&observer_id)?;
        let entry = state.entries.get(key)?;
        match entry.result.as_ref() {
            Some(Ok(image)) => {
                let size = image.size(0);
                Some(CanvasImageLoadState::Loaded {
                    width: u32::try_from(size.width.0).unwrap_or_default(),
                    height: u32::try_from(size.height.0).unwrap_or_default(),
                })
            }
            Some(Err(error)) => Some(CanvasImageLoadState::Error {
                message: error.to_string(),
            }),
            None => Some(CanvasImageLoadState::Loading),
        }
    }

    pub(crate) fn release_observer(&self, observer_id: u64, window: &mut gpui::Window) {
        let release = {
            let mut state = self.state.lock().unwrap();
            let Some(key) = state.observer_keys.remove(&observer_id) else {
                return;
            };
            let empty = {
                let Some(entry) = state.entries.get_mut(&key) else {
                    return;
                };
                entry.observers.remove(&observer_id);
                entry.users.is_empty() && entry.observers.is_empty()
            };
            if !empty {
                return;
            }
            state.revision = state.revision.saturating_add(1);
            state.remove_entry(&key)
        };
        for image in release {
            let _ = window.drop_image(image);
        }
    }

    pub(crate) fn sync_element(
        &self,
        element_id: u64,
        sources: &[CanvasImageSource],
        policy: ImageNetworkPolicy,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) {
        let desired: HashMap<_, _> = sources
            .iter()
            .cloned()
            .map(|source| (source.key.clone(), source.source))
            .collect();
        let mut dropped = Vec::new();
        let mut load = Vec::new();

        {
            let mut state = self.state.lock().unwrap();
            let current: Vec<String> = state
                .entries
                .iter()
                .filter(|(_, entry)| entry.users.contains(&element_id))
                .map(|(key, _)| key.clone())
                .collect();

            for key in current {
                if desired.contains_key(&key) {
                    continue;
                }
                if let Some(entry) = state.entries.get_mut(&key) {
                    entry.users.remove(&element_id);
                }
                if state
                    .entries
                    .get(&key)
                    .is_some_and(|entry| entry.users.is_empty() && entry.observers.is_empty())
                {
                    dropped.extend(state.remove_entry(&key));
                    state.revision = state.revision.saturating_add(1);
                }
            }

            for (key, source) in &desired {
                let reload = {
                    let entry = state.entries.entry(key.clone()).or_default();
                    entry.source.get_or_insert_with(|| source.clone());
                    entry.users.insert(element_id);
                    if !entry.loading && (entry.result.is_none() || entry.reload_due) {
                        let images = entry.take_loaded_images();
                        entry.reload_due = false;
                        entry.loading = true;
                        Some((entry.source.clone().unwrap(), images))
                    } else {
                        None
                    }
                };
                if let Some((source, images)) = reload {
                    for image in &images {
                        state.forget_atlas_resident(image.id);
                    }
                    dropped.extend(images);
                    load.push((key.clone(), source));
                }
            }

            let loaded_count = desired
                .keys()
                .filter(|key| {
                    state
                        .entries
                        .get(*key)
                        .is_some_and(|entry| matches!(entry.result, Some(Ok(_))))
                })
                .count();
            let stats = state.test_stats.entry(element_id).or_default();
            stats.source_count = desired.len();
            stats.loaded_count = loaded_count;
            dropped.extend(state.take_atlas_evictions());
        }

        for image in dropped {
            let _ = window.drop_image(image);
        }
        for (key, source) in load {
            self.start_load(key, source, policy.clone(), cx);
        }
    }

    fn start_load(
        &self,
        key: String,
        source: ImageSource,
        policy: ImageNetworkPolicy,
        cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) {
        let client = policy.client(cx.http_client());
        let svg_renderer = cx.svg_renderer();
        let background = cx.background_executor().spawn(load_image(
            ImageRequest {
                source,
                current_color: None,
            },
            client,
            svg_renderer,
            policy,
        ));
        let store = self.clone();
        cx.spawn(async move |view, cx| {
            let result = background.await;
            let delay = {
                let mut state = store.state.lock().unwrap();
                let Some(entry) = state.entries.get_mut(&key) else {
                    return;
                };
                entry.loading = false;
                let delay = if result.is_err() {
                    let multiplier = 1u32 << entry.retry_attempt.min(5);
                    entry.retry_attempt = entry.retry_attempt.saturating_add(1);
                    (URL_FAILURE_RETRY_MIN * multiplier).min(URL_FAILURE_RETRY_MAX)
                } else {
                    entry.retry_attempt = 0;
                    URL_SUCCESS_TTL
                };
                entry.result = Some(result);
                let users = entry.users.iter().copied().collect::<Vec<_>>();
                let loaded = entry.result.as_ref().is_some_and(Result::is_ok);
                for user in users {
                    state.test_stats.entry(user).or_default().loaded_count = usize::from(loaded);
                }
                state.revision = state.revision.saturating_add(1);
                delay
            };
            let _ = view.update(cx, |_view, cx| cx.notify());
            cx.background_executor().timer(delay).await;
            {
                let mut state = store.state.lock().unwrap();
                if let Some(entry) = state.entries.get_mut(&key) {
                    entry.reload_due = true;
                }
            }
            let _ = view.update(cx, |_view, cx| cx.notify());
        })
        .detach();
    }

    pub(crate) fn prune_missing(
        &self,
        mut is_live: impl FnMut(u64) -> bool,
        window: &mut gpui::Window,
    ) {
        let mut releases = Vec::new();
        {
            let mut state = self.state.lock().unwrap();
            state.live_atlas_ids.retain(|id, _| is_live(*id));
            let keys = state.entries.keys().cloned().collect::<Vec<_>>();
            for key in keys {
                let (removed_users, empty) = {
                    let Some(entry) = state.entries.get_mut(&key) else {
                        continue;
                    };
                    let removed_users = entry
                        .users
                        .iter()
                        .copied()
                        .filter(|user| !is_live(*user))
                        .collect::<Vec<_>>();
                    for user in &removed_users {
                        entry.users.remove(user);
                    }
                    let empty = entry.users.is_empty() && entry.observers.is_empty();
                    (removed_users, empty)
                };
                for user in &removed_users {
                    state.test_stats.entry(*user).or_default().source_count = 0;
                    state.test_stats.entry(*user).or_default().loaded_count = 0;
                }
                if empty {
                    releases.extend(state.remove_entry(&key));
                    state.revision = state.revision.saturating_add(1);
                }
            }
            releases.extend(state.take_atlas_evictions());
        }
        for image in releases {
            let _ = window.drop_image(image);
        }
    }

    pub(crate) fn sync_live_images(
        &self,
        element_id: u64,
        image_ids: &[gpui::ImageId],
        window: &mut gpui::Window,
    ) {
        let evictions = {
            let mut state = self.state.lock().unwrap();
            if image_ids.is_empty() {
                state.live_atlas_ids.remove(&element_id);
            } else {
                state
                    .live_atlas_ids
                    .insert(element_id, image_ids.iter().copied().collect());
            }
            state.take_atlas_evictions()
        };
        for image in evictions {
            let _ = window.drop_image(image);
        }
    }

    pub(crate) fn record_painted(
        &self,
        element_id: u64,
        image: &Arc<gpui::RenderImage>,
        window: &mut gpui::Window,
    ) {
        let evictions = {
            let mut state = self.state.lock().unwrap();
            state.atlas_clock = state.atlas_clock.saturating_add(1);
            let last_painted = state.atlas_clock;
            state
                .atlas_residents
                .entry(image.id)
                .and_modify(|resident| resident.last_painted = last_painted)
                .or_insert_with(|| CanvasAtlasResident {
                    image: image.clone(),
                    last_painted,
                });
            let stats = state.test_stats.entry(element_id).or_default();
            stats.painted_ids.insert(image.id);
            #[cfg(any(test, feature = "test-support"))]
            stats.atlas_ids.insert(image.id);
            state.take_atlas_evictions()
        };
        for image in evictions {
            let _ = window.drop_image(image);
        }
    }

    pub(crate) fn test_state(&self, element_id: u64) -> Option<serde_json::Value> {
        let state = self.state.lock().unwrap();
        let stats = state.test_stats.get(&element_id)?;
        Some(serde_json::json!({
            "imageCount": stats.source_count,
            "loadedImageCount": stats.loaded_count,
            "paintedImageCount": stats.painted_ids.len(),
            "atlasTileCount": stats.atlas_ids.len(),
            "releasedAtlasTileCount": stats.released_atlas_tiles,
        }))
    }
}

pub struct ImgElement {
    source: Option<ImageSource>,
    source_error: Option<String>,
    object_fit: ImgObjectFit,
    tint_current_color: bool,
    last_request: Option<ImageRequest>,
    load_error: Arc<Mutex<Option<String>>>,
    load_result: Arc<Mutex<Option<ImageLoadResult>>>,
    load_task: Option<gpui::Task<()>>,
    reload_wake_task: Option<gpui::Task<()>>,
    completed_at: Option<Instant>,
    retry_attempt: u32,
}

impl Default for ImgElement {
    fn default() -> Self {
        Self {
            source: None,
            source_error: None,
            object_fit: ImgObjectFit::default(),
            tint_current_color: false,
            last_request: None,
            load_error: Arc::new(Mutex::new(None)),
            load_result: Arc::new(Mutex::new(None)),
            load_task: None,
            reload_wake_task: None,
            completed_at: None,
            retry_attempt: 0,
        }
    }
}

impl ImgElement {
    fn fallback(message: impl Into<gpui::SharedString>) -> gpui::Div {
        use gpui::prelude::*;

        gpui::div()
            .flex()
            .items_center()
            .justify_center()
            .bg(gpui::rgba(0x1f2230ff))
            .border(gpui::px(1.0))
            .border_color(gpui::rgba(0x5d6481ff))
            .text_color(gpui::rgba(0xa4accdff))
            .child(crate::text::chrome_text(message.into(), None))
    }

    fn reset_load(&mut self) {
        self.last_request = None;
        self.load_task = None;
        self.reload_wake_task = None;
        self.completed_at = None;
        self.retry_attempt = 0;
        self.load_result = Arc::new(Mutex::new(None));
        *self.load_error.lock().unwrap() = None;
    }

    fn start_load(
        &mut self,
        request: ImageRequest,
        policy: ImageNetworkPolicy,
        client: Arc<dyn gpui::http_client::HttpClient>,
        svg_renderer: gpui::SvgRenderer,
        cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) {
        self.load_task = None;
        self.reload_wake_task = None;
        self.completed_at = None;
        self.load_result = Arc::new(Mutex::new(None));
        *self.load_error.lock().unwrap() = None;

        let result = self.load_result.clone();
        let background =
            cx.background_executor()
                .spawn(load_image(request, client, svg_renderer, policy));
        self.load_task = Some(cx.spawn(async move |view, cx| {
            *result.lock().unwrap() = Some(background.await);
            let _ = view.update(cx, |_view, cx| cx.notify());
        }));
    }

    fn reload_delay(&self, request: &ImageRequest, result: &ImageLoadResult) -> Option<Duration> {
        if result.is_err() {
            let multiplier = 1u32 << self.retry_attempt.min(5);
            return Some((URL_FAILURE_RETRY_MIN * multiplier).min(URL_FAILURE_RETRY_MAX));
        }
        matches!(request.source, ImageSource::Path(_) | ImageSource::Url(_))
            .then_some(URL_SUCCESS_TTL)
    }

    fn schedule_reload(
        &mut self,
        delay: Duration,
        cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) {
        self.reload_wake_task = Some(cx.spawn(async move |view, cx| {
            cx.background_executor().timer(delay).await;
            let _ = view.update(cx, |_view, cx| cx.notify());
        }));
    }

    fn set_source(&mut self, value: serde_json::Value) {
        self.source = None;
        self.source_error = None;
        self.reset_load();

        if value.is_null() {
            return;
        }
        match ImageSource::parse(&value) {
            Ok(source) => self.source = Some(source),
            Err(error) => self.source_error = Some(error),
        }
    }
}

fn apply_image_accessibility<E>(ctx: &CustomRenderContext, mut el: E) -> E
where
    E: gpui::StatefulInteractiveElement,
{
    let native_disabled =
        crate::accessibility::is_native_disabled(ctx.retained_element) || ctx.accessibility_hidden;
    if !native_disabled {
        if let Some(handle) = ctx.focus_handle {
            el = el.track_focus(handle);
        }
    }
    crate::accessibility::apply(
        el,
        ctx.retained_element,
        ctx.event_callback,
        ctx.focus_handle,
        ctx.accessibility_hidden,
        None,
    )
}

/// GPUI's `Img` stores the role and ARIA properties applied through
/// `StatefulInteractiveElement`, but unlike `Div` it does not expose them from
/// `Element::a11y_role` and `Element::write_a11y_info`. AccessKit therefore
/// filters the image before it can read the authored name. Keep the real image
/// as the layout, paint, and interaction owner while a non-rendered div carries
/// the same accessibility projection for those two element hooks.
struct AccessibleImg {
    image: gpui::Stateful<gpui::Img>,
    accessibility: gpui::Stateful<gpui::Div>,
}

impl gpui::Element for AccessibleImg {
    type RequestLayoutState = <gpui::Stateful<gpui::Img> as gpui::Element>::RequestLayoutState;
    type PrepaintState = <gpui::Stateful<gpui::Img> as gpui::Element>::PrepaintState;

    fn id(&self) -> Option<gpui::ElementId> {
        gpui::Element::id(&self.image)
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        gpui::Element::source_location(&self.image)
    }

    fn a11y_role(&self) -> Option<gpui::Role> {
        gpui::Element::a11y_role(&self.accessibility)
    }

    fn write_a11y_info(&self, node: &mut gpui::accesskit::Node) {
        gpui::Element::write_a11y_info(&self.accessibility, node);
    }

    fn request_layout(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector_id: Option<&gpui::InspectorElementId>,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> (gpui::LayoutId, Self::RequestLayoutState) {
        gpui::Element::request_layout(&mut self.image, id, inspector_id, window, cx)
    }

    fn prepaint(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector_id: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        request_layout: &mut Self::RequestLayoutState,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> Self::PrepaintState {
        gpui::Element::prepaint(
            &mut self.image,
            id,
            inspector_id,
            bounds,
            request_layout,
            window,
            cx,
        )
    }

    fn paint(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector_id: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        request_layout: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        gpui::Element::paint(
            &mut self.image,
            id,
            inspector_id,
            bounds,
            request_layout,
            prepaint,
            window,
            cx,
        );
    }
}

impl gpui::InteractiveElement for AccessibleImg {
    fn interactivity(&mut self) -> &mut gpui::Interactivity {
        gpui::InteractiveElement::interactivity(&mut self.image)
    }
}

impl gpui::IntoElement for AccessibleImg {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl CustomElement for ImgElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        _window: &mut gpui::Window,
        cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        use gpui::prelude::*;

        if let Some(error) = self.source_error.as_deref() {
            let fallback = Self::fallback(format!("img: invalid src: {error}"))
                .id(gpui::SharedString::from(format!("__gpuix_img_{}", ctx.id)));
            let fallback = super::custom_surface(fallback, &ctx, cx);
            return apply_image_accessibility(&ctx, fallback).into_any_element();
        }

        let Some(source) = self.source.clone() else {
            let fallback = Self::fallback("img: no src")
                .id(gpui::SharedString::from(format!("__gpuix_img_{}", ctx.id)));
            let fallback = super::custom_surface(fallback, &ctx, cx);
            return apply_image_accessibility(&ctx, fallback).into_any_element();
        };

        let request = ImageRequest {
            source,
            current_color: self
                .tint_current_color
                .then(|| u32::from(ctx.current_color)),
        };
        if self.last_request.as_ref() != Some(&request) {
            self.reset_load();
            self.last_request = Some(request.clone());
        }

        let now = cx.background_executor().now();
        let completed = self.load_result.lock().unwrap().clone();
        if let Some(result) = completed.as_ref() {
            let completed_at = *self.completed_at.get_or_insert(now);
            if self.reload_wake_task.is_none() {
                if let Some(delay) = self.reload_delay(&request, result) {
                    self.schedule_reload(delay, cx);
                }
            }
            if self
                .reload_delay(&request, result)
                .is_some_and(|delay| now.duration_since(completed_at) >= delay)
            {
                if result.is_err() {
                    self.retry_attempt = self.retry_attempt.saturating_add(1);
                } else {
                    self.retry_attempt = 0;
                }
                self.start_load(
                    request.clone(),
                    ctx.image_network_policy.clone(),
                    ctx.image_network_policy.client(cx.http_client()),
                    cx.svg_renderer(),
                    cx,
                );
            }
        }
        if self.load_task.is_none() {
            self.start_load(
                request.clone(),
                ctx.image_network_policy.clone(),
                ctx.image_network_policy.client(cx.http_client()),
                cx.svg_renderer(),
                cx,
            );
        }

        // One GPUI identity for the image and for the accessibility projection
        // below: the projection is never laid out, painted, or hit-tested, so a
        // second id would name an element that nothing can address.
        let element_id = gpui::SharedString::from(format!("__gpuix_img_{}", ctx.id));
        let load_error = self.load_error.clone();
        let loader_error = load_error.clone();
        let load_result = self.load_result.clone();
        let source_label = request.source.label();
        let fallback_label = source_label.clone();
        let mut el = gpui::img(move |_window: &mut gpui::Window, _cx: &mut gpui::App| {
            let result = load_result.lock().unwrap().clone();
            if let Some(Err(error)) = result.as_ref() {
                let message = format!("img: failed to load {source_label}: {error}");
                let mut previous = loader_error.lock().unwrap();
                if previous.as_deref() != Some(&message) {
                    log::error!("{message}");
                    *previous = Some(message);
                }
            }
            result
        })
        .object_fit(self.object_fit.as_gpui())
        .with_fallback(move || {
            let message = load_error
                .lock()
                .unwrap()
                .clone()
                .unwrap_or_else(|| format!("img: loading {fallback_label}"));
            Self::fallback(message).into_any_element()
        })
        .id(element_id.clone());

        if let Some(style) = ctx.style {
            el = crate::renderer::apply_interactive_styles(el, style);
        }

        let el = apply_image_accessibility(&ctx, el);
        let el = super::wire_standard_events(el, &ctx, cx);
        let accessibility = apply_image_accessibility(&ctx, gpui::div().id(element_id));
        let el = AccessibleImg {
            image: el,
            accessibility,
        };
        crate::automation::track_own_bounds(el, ctx.id, ctx.paint_bounds_listener.clone())
            .into_any_element()
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        match key {
            "src" => self.set_source(value),
            "objectFit" => {
                self.object_fit = value
                    .as_str()
                    .map(ImgObjectFit::from_str)
                    .unwrap_or_default()
            }
            "tint" => {
                self.tint_current_color = value.as_str() == Some("currentColor");
                self.reset_load();
            }
            _ => {}
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["src", "objectFit", "tint"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &["click", "mouseEnter", "mouseLeave"]
    }

    fn test_state(&self) -> Option<serde_json::Value> {
        if let Some(error) = self.source_error.as_deref() {
            return Some(serde_json::json!({ "status": "error", "error": error }));
        }

        let status = match self.load_result.lock().unwrap().as_ref() {
            Some(Ok(_)) => serde_json::json!({ "status": "loaded" }),
            Some(Err(error)) => serde_json::json!({
                "status": "error",
                "error": format!("img: failed to load {}: {error}", self.last_request.as_ref()?.source.label()),
            }),
            None if self.source.is_some() => serde_json::json!({ "status": "loading" }),
            None => serde_json::json!({ "status": "idle" }),
        };
        Some(status)
    }

    fn destroy(&mut self) {
        self.reset_load();
    }
}

pub(crate) fn image_prop_problem(
    element_type: &str,
    key: &str,
    value: &serde_json::Value,
) -> Option<crate::style::StyleProblem> {
    if element_type != "img" || value.is_null() {
        return None;
    }

    let reason = match key {
        "src" => ImageSource::parse(value).err(),
        "tint" if value.as_str() != Some("currentColor") => {
            Some("expected \"currentColor\" or an omitted tint prop".into())
        }
        _ => None,
    }?;
    Some(crate::style::StyleProblem {
        property: key.to_string(),
        value: serde_json::to_string(value).unwrap_or_else(|_| format!("{value:?}")),
        reason,
    })
}

#[derive(Debug, Clone, Default)]
pub struct SvgElement {
    src: String,
    bytes: Option<Arc<[u8]>>,
    source: String,
}

impl SvgElement {
    fn load_src(&mut self, src: String) {
        self.bytes = svg_bytes(&src).map(Arc::from);
        self.src = src;
    }
}

fn svg_bytes(src: &str) -> Option<Vec<u8>> {
    if let Some(payload) = src.strip_prefix("data:") {
        let (meta, data) = payload.split_once(',')?;
        if !meta.starts_with("image/svg+xml") {
            return None;
        }
        return Some(percent_decode(data));
    }
    #[cfg(target_family = "wasm")]
    return None;
    #[cfg(not(target_family = "wasm"))]
    std::fs::read(src).ok()
}

fn percent_decode(input: &str) -> Vec<u8> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(
                std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""),
                16,
            ) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    out
}

impl CustomElement for SvgElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        _window: &mut gpui::Window,
        cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        use gpui::prelude::*;

        let bytes = if self.source.trim().is_empty() {
            self.bytes.as_deref()
        } else {
            Some(self.source.as_bytes())
        };
        let element_id = gpui::SharedString::from(format!("__gpuix_svg_{}", ctx.id));
        let Some(bytes) = bytes else {
            let empty = super::custom_surface(gpui::div().id(element_id), &ctx, cx);
            return empty.into_any_element();
        };

        let mut icon = gpui::svg()
            .data(bytes)
            .flex_none()
            .text_color(ctx.current_color)
            .id(element_id);
        if let Some(style) = ctx.style {
            icon = crate::renderer::apply_interactive_styles(icon, style);
        }
        let icon = super::wire_standard_events(icon, &ctx, cx);
        crate::automation::track_own_bounds(icon, ctx.id, ctx.paint_bounds_listener.clone())
            .into_any_element()
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        match key {
            "src" => self.load_src(value.as_str().unwrap_or_default().to_string()),
            "source" => self.source = value.as_str().unwrap_or_default().to_string(),
            _ => {}
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["src", "source"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &["click", "mouseEnter", "mouseLeave"]
    }

    fn destroy(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn canvas_image_opacity_scales_alpha_without_changing_bgra_channels() {
        let buffer = image::RgbaImage::from_raw(1, 1, vec![11, 22, 33, 200]).unwrap();
        let image = gpui::RenderImage::new(vec![image::Frame::from_parts(
            buffer,
            0,
            0,
            image::Delay::from_numer_denom_ms(17, 1),
        )]);

        let translucent = render_image_with_opacity(&image, 128).unwrap();
        assert_eq!(translucent.as_bytes(0), Some([11, 22, 33, 100].as_slice()));
        assert_eq!(translucent.size(0), image.size(0));
        assert_eq!(translucent.delay(0), image.delay(0));
    }

    #[test]
    fn parses_each_source_kind_and_rejects_invalid_or_oversized_data() {
        assert!(matches!(
            ImageSource::parse(&serde_json::json!("/tmp/a.png")),
            Ok(ImageSource::Path(path)) if path == "/tmp/a.png"
        ));
        assert!(matches!(
            ImageSource::parse(&serde_json::json!("https://example.com/a.webp")),
            Ok(ImageSource::Url(url)) if url == "https://example.com/a.webp"
        ));
        assert!(matches!(
            ImageSource::parse(&serde_json::json!({ "kind": "path", "path": "/tmp/a.png" })),
            Ok(ImageSource::Path(_))
        ));
        assert!(matches!(
            ImageSource::parse(
                &serde_json::json!({ "kind": "url", "url": "https://example.com/a.webp" })
            ),
            Ok(ImageSource::Url(_))
        ));
        assert!(matches!(
            ImageSource::parse(
                &serde_json::json!({ "kind": "data", "mimeType": "image/svg+xml", "bytes": [60, 115, 118, 103, 62] })
            ),
            Ok(ImageSource::Data { .. })
        ));
        assert!(matches!(
            ImageSource::parse(&serde_json::json!("data:image/png;base64,iVBORw0KGgo=")),
            Ok(ImageSource::Data { mime_type, bytes })
                if mime_type.as_deref() == Some("image/png") && bytes.as_ref() == b"\x89PNG\r\n\x1a\n"
        ));
        assert!(matches!(
            ImageSource::parse(&serde_json::json!("data:image/svg+xml,%3Csvg%2F%3E")),
            Ok(ImageSource::Data { mime_type, bytes })
                if mime_type.as_deref() == Some("image/svg+xml") && bytes.as_ref() == b"<svg/>"
        ));

        assert!(ImageSource::parse(&serde_json::json!("   "))
            .unwrap_err()
            .contains("must not be empty"));
        assert!(ImageSource::parse(&serde_json::json!({
            "kind": "data",
            "mimeType": "image/png",
            "bytes": vec![0; MAX_IMAGE_BYTES + 1],
        }))
        .unwrap_err()
        .contains("10 MiB"));
        assert!(ImageSource::parse(&serde_json::json!({
            "kind": "url",
            "url": "https://user:secret@example.com/icon.svg?token=secret",
        }))
        .unwrap_err()
        .contains("credentials"));
        assert!(
            ImageSource::parse(&serde_json::json!("data:image/png;base64,%%%"))
                .unwrap_err()
                .contains("data URL")
        );
    }

    #[test]
    fn follows_fetch_data_url_metadata_processing() {
        let (_, defaulted) = parse_data_url("data:;base64,iVBORw0KGgo=").unwrap();
        assert_eq!(defaulted, b"\x89PNG\r\n\x1a\n");

        let (_, non_terminal_marker) =
            parse_data_url("data:image/png;base64;charset=utf-8,iVBORw0KGgo=").unwrap();
        assert_eq!(non_terminal_marker, b"iVBORw0KGgo=");

        let (_, spaced_terminal_marker) =
            parse_data_url("data:image/png;   base64,iVBORw0KGgo=").unwrap();
        assert_eq!(spaced_terminal_marker, b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn forgiving_base64_matches_infra() {
        assert!(decode_forgiving_base64(b"Zg=").is_err());
        assert_eq!(decode_forgiving_base64(b"YR").unwrap(), b"a");
    }

    #[test]
    fn size_policy_accepts_the_limit_and_rejects_one_byte_over() {
        assert_eq!(ensure_size(MAX_IMAGE_BYTES, "fixture"), Ok(()));
        assert!(ensure_size(MAX_IMAGE_BYTES + 1, "fixture")
            .unwrap_err()
            .contains("maximum image size"));
    }

    #[test]
    fn url_cache_is_bounded_by_url_and_supplies_both_validators() {
        let mut cache = UrlCache::default();
        let loaded = LoadedBytes {
            bytes: Arc::<[u8]>::from(&b"<svg/>"[..]),
            mime_type: Some("image/svg+xml".into()),
        };
        cache.insert(
            "https://example.com/icon.svg".into(),
            CachedUrl {
                loaded: loaded.clone(),
                effective_url: "https://example.com/icon.svg".into(),
                etag: Some("\"v1\"".into()),
                last_modified: Some("Wed, 26 Aug 2026 10:00:00 GMT".into()),
                last_used: 0,
            },
        );

        let cached = cache.get("https://example.com/icon.svg").unwrap();
        let request = add_validator_headers(
            gpui::http_client::Builder::new().uri("https://example.com/icon.svg"),
            Some(&cached),
        )
        .body(())
        .unwrap();
        assert_eq!(
            request.headers()[gpui::http_client::http::header::IF_NONE_MATCH],
            "\"v1\""
        );
        assert_eq!(
            request.headers()[gpui::http_client::http::header::IF_MODIFIED_SINCE],
            "Wed, 26 Aug 2026 10:00:00 GMT"
        );
        assert!(cache.get("https://example.com/missing.svg").is_none());

        for index in 0..URL_CACHE_CAPACITY {
            cache.insert(
                format!("https://example.com/{index}.svg"),
                CachedUrl {
                    loaded: loaded.clone(),
                    effective_url: format!("https://example.com/{index}.svg"),
                    etag: None,
                    last_modified: None,
                    last_used: 0,
                },
            );
        }
        assert_eq!(cache.entries.len(), URL_CACHE_CAPACITY);
        assert!(cache.get("https://example.com/icon.svg").is_none());
        assert!(cache.get("https://example.com/31.svg").is_some());
    }

    #[test]
    fn current_color_substitution_preserves_authored_colours() {
        let svg = br##"<svg><style>.tinted { fill: currentColor } .preserved { fill: url(#currentColor) }</style><text>currentColor</text><defs><linearGradient id="currentColor"/></defs><rect fill="#ff0000"/><path class="tinted" fill="currentColor" style="stroke: CURRENTCOLOR"/><path class="preserved" fill="url(#currentColor)"/></svg>"##;
        let tinted = String::from_utf8(replace_current_color(svg, 0x336699ff).unwrap()).unwrap();
        assert!(tinted.contains("#ff0000"));
        assert_eq!(tinted.matches("#336699ff").count(), 3);
        assert!(tinted.contains("id=\"currentColor\""));
        assert!(tinted.contains(">currentColor</text>"));
        assert_eq!(tinted.matches("url(#currentColor)").count(), 2);
    }

    #[test]
    fn url_labels_redact_credentials_query_and_fragment() {
        let source = ImageSource::Url(
            "https://user:secret@example.com/icon.svg?token=secret#private".into(),
        );
        let label = source.label();
        assert_eq!(label, "URL \"https://example.com/icon.svg\"");
        assert!(!label.contains("user"));
        assert!(!label.contains("secret"));
    }

    #[test]
    fn destination_policy_blocks_private_and_metadata_ranges_at_each_boundary() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "::1",
            "fd00::1",
        ] {
            let error = validate_destination_ip(address.parse().unwrap(), false).unwrap_err();
            assert!(
                error.contains("allowPrivateNetworkImages"),
                "{address}: {error}"
            );
            assert!(validate_destination_ip(address.parse().unwrap(), true).is_ok());
        }

        for address in ["169.254.169.254", "100.100.100.200", "fe80::1"] {
            assert!(validate_destination_ip(address.parse().unwrap(), false).is_err());
            assert!(validate_destination_ip(address.parse().unwrap(), true).is_err());
        }
        assert!(validate_destination_ip("93.184.216.34".parse().unwrap(), false).is_ok());
        assert!(validate_destination_ip(
            "2606:2800:220:1:248:1893:25c8:1946".parse().unwrap(),
            false
        )
        .is_ok());
    }

    #[test]
    fn redirects_are_bounded_and_each_literal_target_is_revalidated() {
        let policy = ImageNetworkPolicy::default();
        let requests = Arc::new(AtomicUsize::new(0));
        let requests_for_client = requests.clone();
        let metadata_client = gpui::http_client::FakeHttpClient::create(move |_| {
            requests_for_client.fetch_add(1, Ordering::Relaxed);
            async move {
                Ok(gpui::http_client::Response::builder()
                    .status(302)
                    .header(
                        gpui::http_client::http::header::LOCATION,
                        "http://169.254.169.254/latest/meta-data",
                    )
                    .body(gpui::http_client::AsyncBody::default())?)
            }
        });
        let error = gpui::block_on(load_url(
            "https://redirect.example/icon.png",
            metadata_client,
            &policy,
        ))
        .unwrap_err();
        assert!(error.contains("never allowed"));
        assert_eq!(requests.load(Ordering::Relaxed), 1);

        let requests = Arc::new(AtomicUsize::new(0));
        let requests_for_client = requests.clone();
        let looping_client = gpui::http_client::FakeHttpClient::create(move |_| {
            requests_for_client.fetch_add(1, Ordering::Relaxed);
            async move {
                Ok(gpui::http_client::Response::builder()
                    .status(302)
                    .header(gpui::http_client::http::header::LOCATION, "/again")
                    .body(gpui::http_client::AsyncBody::default())?)
            }
        });
        let error = gpui::block_on(load_url(
            "https://loop.example/start",
            looping_client,
            &policy,
        ))
        .unwrap_err();
        assert!(error.contains("exceeded 5 redirects"));
        assert_eq!(requests.load(Ordering::Relaxed), MAX_REDIRECTS + 1);
    }

    #[test]
    fn private_literal_requests_need_opt_in_and_every_request_has_a_total_timeout() {
        let policy = ImageNetworkPolicy::default();
        let denied_client = gpui::http_client::FakeHttpClient::create(|_| async move {
            panic!("a denied literal target must not reach the HTTP client")
        });
        let error = gpui::block_on(load_url(
            "http://127.0.0.1/image.png",
            denied_client,
            &policy,
        ))
        .unwrap_err();
        assert!(error.contains("allowPrivateNetworkImages"));

        policy.set_allow_private(true);
        let allowed_client = gpui::http_client::FakeHttpClient::create(|request| async move {
            let timeout = request
                .extensions()
                .get::<gpui::http_client::RequestTimeout>()
                .expect("image request has a total timeout");
            assert!(timeout.0 <= IMAGE_REQUEST_TIMEOUT);
            assert!(timeout.0 > IMAGE_REQUEST_TIMEOUT - Duration::from_secs(1));
            Ok(gpui::http_client::Response::builder()
                .status(200)
                .header(gpui::http_client::http::header::CONTENT_TYPE, "image/png")
                .body(gpui::http_client::AsyncBody::default())?)
        });
        assert!(gpui::block_on(load_url(
            "http://127.0.0.1/image.png",
            allowed_client,
            &policy,
        ))
        .is_ok());
    }

    #[test]
    fn url_status_mime_and_size_errors_are_actionable() {
        let policy = ImageNetworkPolicy::default();
        let status_client = gpui::http_client::FakeHttpClient::create(|_| async move {
            Ok(gpui::http_client::Response::builder()
                .status(404)
                .body(gpui::http_client::AsyncBody::from("not here"))?)
        });
        let status_error = gpui::block_on(load_url(
            "https://status.example/image.png?token=secret",
            status_client,
            &policy,
        ))
        .unwrap_err();
        assert!(status_error.contains("404"));
        assert!(!status_error.contains("not here"));
        assert!(!status_error.contains("token"));
        assert!(!status_error.contains("secret"));

        let network_client = gpui::http_client::FakeHttpClient::create(|_| async move {
            Err(anyhow::anyhow!(
                "request failed for https://network.example/image.png?token=secret"
            ))
        });
        let network_error = gpui::block_on(load_url(
            "https://network.example/image.png?token=secret",
            network_client,
            &policy,
        ))
        .unwrap_err();
        assert!(!network_error.contains("token"));
        assert!(!network_error.contains("secret"));

        let mime_client = gpui::http_client::FakeHttpClient::create(|_| async move {
            Ok(gpui::http_client::Response::builder()
                .status(200)
                .header(gpui::http_client::http::header::CONTENT_TYPE, "text/plain")
                .body(gpui::http_client::AsyncBody::from("not an image"))?)
        });
        let mime_error = gpui::block_on(load_url(
            "https://mime.example/image.png",
            mime_client,
            &policy,
        ))
        .unwrap_err();
        assert!(mime_error.contains("unsupported MIME type"));
        assert!(mime_error.contains("text/plain"));

        let size_client = gpui::http_client::FakeHttpClient::create(|_| async move {
            Ok(gpui::http_client::Response::builder()
                .status(200)
                .header(gpui::http_client::http::header::CONTENT_TYPE, "image/png")
                .header(
                    gpui::http_client::http::header::CONTENT_LENGTH,
                    MAX_IMAGE_BYTES + 1,
                )
                .body(gpui::http_client::AsyncBody::default())?)
        });
        let size_error = gpui::block_on(load_url(
            "https://size.example/image.png",
            size_client,
            &policy,
        ))
        .unwrap_err();
        assert!(size_error.contains("10 MiB"));
        assert!(size_error.contains("maximum image size"));
    }
}
