import type { ImageSource, ImgProps, StyleDesc } from "../types/host.js"

const validStyle = {
  display: "grid",
  alignItems: "baseline",
  width: "50%",
  minWidth: "auto",
  maxWidth: "clamp(240px, 70%, 960px)",
  height: "calc(100% - 4ch)",
  lineHeight: "1.4",
  whiteSpace: "pre",
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
  // @ts-expect-error Native dimensions do not accept CSS inheritance keywords or unsupported units.
  width: "12em",
}

const invalidCalc: StyleDesc = {
  // @ts-expect-error calc values are made from the native length atoms.
  width: "calc(100% - 2rem)",
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
void invalidCalc
void invalidColor
void invalidTextWrap
void invalidHoverStyle
void invalidGrid
void invalidImage
