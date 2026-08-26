#![deny(clippy::all)]

mod automation;
mod color;
mod custom_elements;
mod diff;
mod element_tree;
mod markdown;
mod motion;
mod pointer;
mod renderer;
mod retained_tree;
mod style;
mod syntax;
mod text;
mod theme;

#[cfg(all(feature = "test-support", target_os = "macos"))]
mod test_renderer;

pub use element_tree::*;
pub use renderer::*;
pub use style::*;
