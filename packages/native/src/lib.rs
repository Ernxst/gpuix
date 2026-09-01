#![deny(clippy::all)]

#[cfg(all(
    not(all(target_arch = "wasm32", target_os = "unknown")),
    not(all(
        feature = "test-support",
        any(target_os = "macos", target_os = "windows")
    ))
))]
use napi::bindgen_prelude::*;
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use napi_derive::napi;

mod accessibility;
#[cfg(target_os = "macos")]
mod app_menu;
mod automation;
mod canvas;
mod color;
mod custom_elements;
mod diff;
mod element_tree;
mod markdown;
mod motion;
mod pointer;
mod renderer;
// The data model is public so `examples/bench_serde.rs` measures the real
// types instead of a copy that silently drifts from them.
pub mod retained_tree;
pub mod style;
mod syntax;
mod text;
mod theme;

#[cfg(all(
    feature = "test-support",
    any(target_os = "macos", target_os = "windows")
))]
mod test_renderer;

pub use element_tree::*;
pub use renderer::*;
pub use style::*;

#[cfg(any(
    test,
    not(all(
        feature = "test-support",
        any(target_os = "macos", target_os = "windows")
    ))
))]
const TEST_GPUIX_RENDERER_UNAVAILABLE: &str =
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        // The platform supports it, so the only way to get here is a build that
        // turned the default `test-support` feature off.
        concat!(
            "TestGpuixRenderer is unavailable: this @gpuix/native was built without the ",
            "test-support feature. Rebuild with default features to get the GPU test renderer. ",
            "GpuixRenderer is unaffected."
        )
    } else {
        concat!(
            "TestGpuixRenderer is macOS and Windows only. ",
            "Linux builds have no test-support because wgpu cannot read a rendered image back yet. ",
            "GpuixRenderer still works on Linux."
        )
    };

/// True only when this binary compiled the real GPU test renderer.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[napi]
pub fn has_test_gpuix_renderer() -> bool {
    cfg!(all(
        feature = "test-support",
        any(target_os = "macos", target_os = "windows")
    ))
}

#[cfg(all(
    not(all(target_arch = "wasm32", target_os = "unknown")),
    not(all(
        feature = "test-support",
        any(target_os = "macos", target_os = "windows")
    ))
))]
#[napi]
pub struct TestGpuixRenderer;

#[cfg(all(
    not(all(target_arch = "wasm32", target_os = "unknown")),
    not(all(
        feature = "test-support",
        any(target_os = "macos", target_os = "windows")
    ))
))]
#[napi]
impl TestGpuixRenderer {
    #[napi(constructor)]
    pub fn new(_width: Option<f64>, _height: Option<f64>) -> Result<Self> {
        Err(Error::from_reason(TEST_GPUIX_RENDERER_UNAVAILABLE))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_message_explains_this_build() {
        assert!(TEST_GPUIX_RENDERER_UNAVAILABLE.contains("TestGpuixRenderer"));
        if cfg!(any(target_os = "macos", target_os = "windows")) {
            assert!(TEST_GPUIX_RENDERER_UNAVAILABLE.contains("without the test-support feature"));
            assert!(TEST_GPUIX_RENDERER_UNAVAILABLE.contains("Rebuild with default features"));
            assert!(!TEST_GPUIX_RENDERER_UNAVAILABLE.contains("Linux"));
        } else {
            assert!(TEST_GPUIX_RENDERER_UNAVAILABLE.contains("macOS and Windows only"));
            assert!(TEST_GPUIX_RENDERER_UNAVAILABLE.contains(
                "Linux builds have no test-support because wgpu cannot read a rendered image back yet"
            ));
            assert!(TEST_GPUIX_RENDERER_UNAVAILABLE.contains("GpuixRenderer still works on Linux"));
        }
    }

    #[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
    #[test]
    fn has_test_gpuix_renderer_matches_real_impl() {
        assert_eq!(
            has_test_gpuix_renderer(),
            cfg!(all(
                feature = "test-support",
                any(target_os = "macos", target_os = "windows")
            ))
        );
    }

    #[cfg(all(
        not(all(target_arch = "wasm32", target_os = "unknown")),
        not(all(
            feature = "test-support",
            any(target_os = "macos", target_os = "windows")
        ))
    ))]
    #[test]
    fn stub_constructor_explains_why() {
        match TestGpuixRenderer::new(None, None) {
            Ok(_) => panic!("stub constructor must fail"),
            Err(err) => assert!(
                err.to_string().contains(TEST_GPUIX_RENDERER_UNAVAILABLE),
                "{err}"
            ),
        }
    }
}
