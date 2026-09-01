import type {
  ImageSource,
  ImgProps,
  MotionTransition,
  Props,
  StyleDesc,
} from "../types/host.js"

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
  hoverGroup: "destination-row",
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
  // @ts-expect-error Native dimensions do not accept CSS inheritance keywords or unsupported units.
  width: "12em",
}

const invalidCalc: StyleDesc = {
  // @ts-expect-error calc values are made from the native length atoms.
  width: "calc(100% - 2rem)",
}

const invalidBareDimensionString: StyleDesc = {
  // @ts-expect-error Bare strings are not JSON numeric length values.
  width: "12",
}

const invalidCalcWithoutOperator: StyleDesc = {
  // @ts-expect-error calc() always has exactly one binary operator.
  width: "calc(24ch)",
}

const invalidUnspacedCalc: StyleDesc = {
  // @ts-expect-error calc operators use the canonical spaced grammar.
  width: "calc(100%-4ch)",
}

const invalidNestedCalc: StyleDesc = {
  // @ts-expect-error The native grammar accepts one binary calc level only.
  width: "calc(calc(100% - 4ch) + 2px)",
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

const validSpringTransition: StyleDesc = {
  transition: {
    properties: ["width", "opacity"],
    easing: { type: "spring", stiffness: 400, damping: 28, mass: 0.9, velocity: 12 },
  },
}

const validMotionSpring: MotionTransition = {
  duration: 0,
  ease: { type: "spring", stiffness: 400, damping: 28, mass: 0.9, velocity: 12 },
}

const unknownSpringType: MotionTransition = {
  // @ts-expect-error Tagged spring easings reject unknown type values.
  ease: { type: "bounce" },
}

const nestedTransition: StyleDesc = {
  hover: {
    // @ts-expect-error State refinements inherit the base transition declaration.
    transition: { properties: ["opacity"], durationMs: 140 },
  },
}

const nestedHoverGroup: StyleDesc = {
  hover: {
    // @ts-expect-error A hover group marks the base element, not a state refinement.
    hoverGroup: "nested-group",
  },
}

const removedElementHoverGroup: Props = {
  // @ts-expect-error hoverGroup moved into the style descriptor.
  hoverGroup: "legacy-element-prop",
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
void invalidBareDimensionString
void invalidCalcWithoutOperator
void invalidUnspacedCalc
void invalidNestedCalc
void invalidColor
void invalidTextWrap
void invalidHoverStyle
void invalidTransitionProperty
void missingTransitionDuration
void validSpringTransition
void validMotionSpring
void unknownSpringType
void nestedTransition
void nestedHoverGroup
void removedElementHoverGroup
void invalidGrid
void invalidImage
