import type { ImageSource, ImgProps, StyleDesc } from "../types/host.js"

const validStyle = {
  display: "grid",
  alignItems: "baseline",
  width: "50%",
  minWidth: "auto",
  background: "oklch(67.3% 0.182 276.935)",
  outlineColor: "rebeccapurple",
  letterSpacing: 0.25,
  textTransform: "uppercase",
  textWrap: "wrap",
  hoverWithin: {
    borderColor: "#7c86ff",
  },
  focusVisible: {
    outlineColor: "rgba(124, 134, 255, 0.9)",
    outlineWidth: 2,
  },
  transition: {
    properties: ["opacity", "backgroundColor", "borderRadius"],
    durationMs: 140,
    easing: "ease",
  },
  gridTemplateColumns: [
    { type: "minmax", min: { type: "px", value: 120 }, max: { type: "fr", value: 1 } },
    { type: "repeat", count: 2, tracks: [{ type: "auto" }] },
  ],
} satisfies StyleDesc

const pathImage: ImageSource = { kind: "path", path: "/tmp/avatar.png" }
const sourceProps: ImgProps[] = [
  { src: "https://example.com/avatar.png" },
  { src: pathImage },
  { src: { kind: "data", mimeType: "image/png", bytes: new Uint8Array() } },
]

void validStyle
void sourceProps

const invalidDisplay: StyleDesc = {
  // @ts-expect-error StyleDesc accepts only the native display modes.
  display: "block",
}

const invalidDimension: StyleDesc = {
  // @ts-expect-error Native dimensions do not accept CSS inheritance keywords.
  width: "inherit",
}

const invalidColor: StyleDesc = {
  // @ts-expect-error Colour values are always strings, including runtime-validated ones.
  background: 42,
}

const invalidTextWrap: StyleDesc = {
  // @ts-expect-error GPUI has no balanced text wrapping mode.
  textWrap: "balance",
}

const invalidHoverStyle: StyleDesc = {
  hoverWithin: {
    // @ts-expect-error Nested styles use the same native display union.
    display: "contents",
  },
}

const invalidTransitionProperty: StyleDesc = {
  transition: {
    // @ts-expect-error Only natively interpolated style fields are accepted.
    properties: ["display"],
    durationMs: 140,
  },
}

const missingTransitionDuration: StyleDesc = {
  // @ts-expect-error A transition always declares its duration explicitly.
  transition: { properties: ["opacity"] },
}

const nestedTransition: StyleDesc = {
  hover: {
    // @ts-expect-error State refinements inherit the base transition declaration.
    transition: { properties: ["opacity"], durationMs: 140 },
  },
}

const invalidGrid: StyleDesc = {
  gridTemplateColumns: [
    {
      type: "minmax",
      min: {
        // @ts-expect-error Fractional tracks are invalid minmax lower bounds.
        type: "fr",
        value: 1,
      },
      max: { type: "fr", value: 1 },
    },
  ],
}

const invalidImage: ImgProps = {
  src: {
    kind: "data",
    // @ts-expect-error ImageSource only accepts the native decoder MIME types.
    mimeType: "image/avif",
    bytes: [],
  },
}

void invalidDisplay
void invalidDimension
void invalidColor
void invalidTextWrap
void invalidHoverStyle
void invalidTransitionProperty
void missingTransitionDuration
void nestedTransition
void invalidGrid
void invalidImage
