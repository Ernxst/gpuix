/// Image custom elements for raster images, full-colour SVG documents, and
/// tintable SVG icons.
///
/// `<img>` deliberately accepts a discriminated source instead of guessing
/// whether a string is a path or URL. Every source becomes bounded bytes before
/// GPUI decodes it. `<svg>` remains the lightweight monochrome icon element.
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex, OnceLock};

use futures::AsyncReadExt as _;
use gpui::http_client::HttpRequestExt as _;
use serde::Deserialize;

use super::{CustomElement, CustomElementFactory, CustomRenderContext};

pub(crate) const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const URL_CACHE_CAPACITY: usize = 32;

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
enum ImageSource {
    Path(String),
    Url(String),
    Data { mime_type: String, bytes: Arc<[u8]> },
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
    fn parse(value: &serde_json::Value) -> Result<Self, String> {
        let source: WireImageSource = serde_json::from_value(value.clone()).map_err(|error| {
            format!(
                "expected {{ kind: \"path\", path }}, {{ kind: \"url\", url }}, or {{ kind: \"data\", mimeType, bytes }}: {error}"
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
                let parsed = gpui::http_client::Url::parse(&url)
                    .map_err(|error| format!("invalid URL: {error}"))?;
                if !matches!(parsed.scheme(), "http" | "https") {
                    return Err(format!(
                        "unsupported URL scheme {:?}; expected http or https",
                        parsed.scheme()
                    ));
                }
                Ok(Self::Url(url))
            }
            WireImageSource::Data { mime_type, bytes } => {
                let mime_type = normalize_mime_type(&mime_type);
                supported_image_format(&mime_type)?;
                ensure_size(bytes.len(), "data source")?;
                Ok(Self::Data {
                    mime_type,
                    bytes: bytes.into(),
                })
            }
        }
    }

    fn label(&self) -> String {
        match self {
            Self::Path(path) => format!("path {path:?}"),
            Self::Url(url) => format!("URL {url:?}"),
            Self::Data { mime_type, bytes } => {
                format!("{mime_type} data ({} bytes)", bytes.len())
            }
        }
    }
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
    let needle = b"currentcolor";
    let source_bytes = source.as_bytes();
    let replacement = format!("#{color:08x}");
    let mut output = Vec::with_capacity(source_bytes.len());
    let mut index = 0;

    while index < source_bytes.len() {
        if source_bytes[index..].len() >= needle.len()
            && source_bytes[index..index + needle.len()].eq_ignore_ascii_case(needle)
        {
            output.extend_from_slice(replacement.as_bytes());
            index += needle.len();
        } else {
            output.push(source_bytes[index]);
            index += 1;
        }
    }

    Ok(output)
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
        .map_err(|error| format!("failed to read {source}: {error}"))?;
    ensure_size(bytes.len(), source)?;
    Ok(bytes.into())
}

async fn load_url(
    url: &str,
    client: Arc<dyn gpui::http_client::HttpClient>,
) -> Result<LoadedBytes, String> {
    let cached = url_cache().lock().unwrap().get(url);
    let request = add_validator_headers(
        gpui::http_client::Builder::new()
            .uri(url)
            .follow_redirects(gpui::http_client::RedirectPolicy::FollowAll),
        cached.as_ref(),
    )
    .body(().into())
    .map_err(|error| format!("failed to build image request for {url:?}: {error}"))?;

    let mut response = client
        .send(request)
        .await
        .map_err(|error| format!("failed to load image from {url:?}: {error}"))?;

    if response.status() == gpui::http_client::StatusCode::NOT_MODIFIED {
        return cached
            .map(|entry| entry.loaded)
            .ok_or_else(|| format!("{url:?} returned 304 without a cached image"));
    }

    if !response.status().is_success() {
        let status = response.status();
        let body = read_limited(response.body_mut(), &format!("error response from {url:?}"))
            .await
            .unwrap_or_default();
        let first_line = String::from_utf8_lossy(&body)
            .lines()
            .next()
            .unwrap_or_default()
            .trim()
            .chars()
            .take(256)
            .collect::<String>();
        return Err(format!(
            "image request for {url:?} returned {status}{}",
            if first_line.is_empty() {
                String::new()
            } else {
                format!(": {first_line}")
            }
        ));
    }

    if let Some(content_length) = response
        .headers()
        .get(gpui::http_client::http::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
    {
        ensure_size(content_length, &format!("response from {url:?}"))?;
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
    let bytes = read_limited(response.body_mut(), &format!("response from {url:?}")).await?;
    let loaded = LoadedBytes { bytes, mime_type };
    url_cache().lock().unwrap().insert(
        url.to_string(),
        CachedUrl {
            loaded: loaded.clone(),
            etag,
            last_modified,
            last_used: 0,
        },
    );
    Ok(loaded)
}

async fn load_source(
    source: &ImageSource,
    client: Arc<dyn gpui::http_client::HttpClient>,
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
        ImageSource::Url(url) => load_url(url, client).await,
        ImageSource::Data { mime_type, bytes } => Ok(LoadedBytes {
            bytes: bytes.clone(),
            mime_type: Some(mime_type.clone()),
        }),
    }
}

enum ImageAsset {}

impl gpui::Asset for ImageAsset {
    type Source = ImageRequest;
    type Output = Result<Arc<gpui::RenderImage>, gpui::ImageCacheError>;

    fn load(
        request: Self::Source,
        cx: &mut gpui::App,
    ) -> impl std::future::Future<Output = Self::Output> + Send + 'static {
        let client = cx.http_client();
        let svg_renderer = cx.svg_renderer();
        async move {
            let mut loaded = load_source(&request.source, client)
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
                    .map_err(|error| {
                        gpui::ImageCacheError::Other(Arc::new(anyhow::anyhow!(error)))
                    })?;
            }

            gpui::Image::from_bytes(format, loaded.bytes.to_vec())
                .to_image_data(svg_renderer)
                .map_err(|error| gpui::ImageCacheError::Other(Arc::new(error)))
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ImgElement {
    source: Option<ImageSource>,
    source_error: Option<String>,
    object_fit: ImgObjectFit,
    tint_current_color: bool,
    last_request: Option<ImageRequest>,
    load_error: Arc<Mutex<Option<String>>>,
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

    fn set_source(&mut self, value: serde_json::Value) {
        self.source = None;
        self.source_error = None;
        self.last_request = None;
        *self.load_error.lock().unwrap() = None;

        if value.is_null() {
            return;
        }
        match ImageSource::parse(&value) {
            Ok(source) => self.source = Some(source),
            Err(error) => self.source_error = Some(error),
        }
    }
}

impl CustomElement for ImgElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        _window: &mut gpui::Window,
        _cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        use gpui::prelude::*;

        if let Some(error) = self.source_error.as_deref() {
            let mut fallback = Self::fallback(format!("img: invalid src: {error}"));
            if let Some(style) = ctx.style {
                fallback = crate::renderer::apply_styles(fallback, style);
            }
            return fallback.into_any_element();
        }

        let Some(source) = self.source.clone() else {
            let mut fallback = Self::fallback("img: no src");
            if let Some(style) = ctx.style {
                fallback = crate::renderer::apply_styles(fallback, style);
            }
            return fallback.into_any_element();
        };

        let request = ImageRequest {
            source,
            current_color: self
                .tint_current_color
                .then(|| u32::from(ctx.current_color)),
        };
        if self.last_request.as_ref() != Some(&request) {
            self.last_request = Some(request.clone());
            *self.load_error.lock().unwrap() = None;
        }

        let load_error = self.load_error.clone();
        let loader_error = load_error.clone();
        let source_label = request.source.label();
        let fallback_label = source_label.clone();
        let mut el = gpui::img(move |window: &mut gpui::Window, cx: &mut gpui::App| {
            let result = window.use_asset::<ImageAsset>(&request, cx);
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
        });

        if let Some(style) = ctx.style {
            el = crate::renderer::apply_styles(el, style);
        }

        el.into_any_element()
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
                self.last_request = None;
                *self.load_error.lock().unwrap() = None;
            }
            _ => {}
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["src", "objectFit", "tint"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &[]
    }

    fn destroy(&mut self) {}
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
        _cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        use gpui::prelude::*;

        let bytes = if self.source.trim().is_empty() {
            self.bytes.as_deref()
        } else {
            Some(self.source.as_bytes())
        };
        let Some(bytes) = bytes else {
            let mut empty = gpui::div();
            if let Some(style) = ctx.style {
                empty = crate::renderer::apply_styles(empty, style);
            }
            return empty.into_any_element();
        };

        let mut icon = gpui::svg()
            .data(bytes)
            .flex_none()
            .text_color(ctx.current_color);
        if let Some(style) = ctx.style {
            icon = crate::renderer::apply_styles(icon, style);
        }
        icon.into_any_element()
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
        &[]
    }

    fn destroy(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_each_source_kind_and_rejects_ambiguous_or_oversized_data() {
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

        assert!(ImageSource::parse(&serde_json::json!("/tmp/a.png"))
            .unwrap_err()
            .contains("expected"));
        assert!(ImageSource::parse(&serde_json::json!({
            "kind": "data",
            "mimeType": "image/png",
            "bytes": vec![0; MAX_IMAGE_BYTES + 1],
        }))
        .unwrap_err()
        .contains("10 MiB"));
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
        let svg = br##"<svg><rect fill="#ff0000"/><path fill="currentColor"/></svg>"##;
        let tinted = String::from_utf8(replace_current_color(svg, 0x336699ff).unwrap()).unwrap();
        assert!(tinted.contains("#ff0000"));
        assert!(tinted.contains("#336699ff"));
        assert!(!tinted.to_ascii_lowercase().contains("currentcolor"));
    }

    #[test]
    fn url_status_mime_and_size_errors_are_actionable() {
        let status_client = gpui::http_client::FakeHttpClient::create(|_| async move {
            Ok(gpui::http_client::Response::builder()
                .status(404)
                .body(gpui::http_client::AsyncBody::from("not here"))?)
        });
        let status_error =
            gpui::block_on(load_url("https://status.example/image.png", status_client))
                .unwrap_err();
        assert!(status_error.contains("404"));
        assert!(status_error.contains("not here"));

        let mime_client = gpui::http_client::FakeHttpClient::create(|_| async move {
            Ok(gpui::http_client::Response::builder()
                .status(200)
                .header(gpui::http_client::http::header::CONTENT_TYPE, "text/plain")
                .body(gpui::http_client::AsyncBody::from("not an image"))?)
        });
        let mime_error =
            gpui::block_on(load_url("https://mime.example/image.png", mime_client)).unwrap_err();
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
        let size_error =
            gpui::block_on(load_url("https://size.example/image.png", size_client)).unwrap_err();
        assert!(size_error.contains("10 MiB"));
        assert!(size_error.contains("maximum image size"));
    }
}
