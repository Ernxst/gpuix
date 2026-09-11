import type { CSSProperties } from "react"
import type { ImageSource, ImgProps, MotionTransition, Props, StyleDesc } from "../types/host.js"
// `SharedStyle` is imported through the public barrel, not `../types/host.js`
// directly, so this exercises the export `@gpuix/react` consumers actually see.
import type { SharedStyle } from "../index.js"

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
  interpolateSize: "allow-keywords",
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

const intrinsicAndViewportLengths = {
  width: "max-content",
  minWidth: "min-content",
  maxWidth: "fit-content",
  height: "100vh",
  minHeight: "calc(50vh - 10px)",
  maxHeight: "12.5vw",
  hover: {
    width: "fit-content(240px)",
  },
} satisfies StyleDesc

void intrinsicAndViewportLengths

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

const invalidInterpolateSize: StyleDesc = {
  // @ts-expect-error interpolateSize takes CSS's two keywords, kebab-cased.
  interpolateSize: "allowKeywords",
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

const validTransitionShorthand: StyleDesc = {
  transition: "background-color 120ms ease-out, border-radius 0.2s 40ms linear",
}

const validTransitionShorthandThreeItems: StyleDesc = {
  transition: "width 120ms, opacity 160ms ease-out 60ms, border-radius 0.2s 40ms linear",
}

void validTransitionShorthandThreeItems

const invalidTransitionShorthand: StyleDesc = {
  // @ts-expect-error The native transition surface does not interpolate transform.
  transition: "transform 1s",
}

const invalidLaterTransitionProperty: StyleDesc = {
  // @ts-expect-error Every shorthand item must name a natively interpolated property.
  transition: "width 1s, transform 1s",
}

const invalidCamelCaseTransitionProperty: StyleDesc = {
  // @ts-expect-error Shorthand properties use kebab-case CSS names.
  transition: "width 1s, borderRadius 1s",
}

void invalidLaterTransitionProperty
void invalidCamelCaseTransitionProperty

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

const invalidGridFitContentMin: StyleDesc = {
  gridTemplateColumns: [
    {
      type: "minmax",
      min: {
        // @ts-expect-error fit-content is not a valid minmax lower bound.
        type: "fit-content",
        limit: { type: "px", value: 100 },
      },
      max: { type: "fr", value: 1 },
    },
  ],
}

const invalidGridFitContentMax: StyleDesc = {
  gridTemplateColumns: [
    {
      type: "minmax",
      min: { type: "px", value: 0 },
      max: {
        // @ts-expect-error fit-content is not a valid minmax upper bound.
        type: "fit-content",
        limit: { type: "px", value: 100 },
      },
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
void invalidInterpolateSize
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
void validTransitionShorthand
void invalidTransitionShorthand
void validSpringTransition
void validMotionSpring
void unknownSpringType
void nestedTransition
void nestedHoverGroup
void removedElementHoverGroup
void invalidGrid
void invalidGridFitContentMin
void invalidGridFitContentMax
void invalidImage

// `SharedStyle` is exactly the mapped type consumers used to be told to write
// by hand: mutually assignable in both directions.
type HandWrittenSharedStyle = {
  [Property in keyof CSSProperties & keyof StyleDesc]?: Exclude<
    CSSProperties[Property],
    undefined
  > &
    Exclude<StyleDesc[Property], undefined>
}

declare const exportedShared: SharedStyle
declare const handWrittenShared: HandWrittenSharedStyle

const sharedAssignsToHandWritten: HandWrittenSharedStyle = exportedShared
const handWrittenAssignsToShared: SharedStyle = handWrittenShared

void sharedAssignsToHandWritten
void handWrittenAssignsToShared

const invalidSharedStyle: SharedStyle = {
  // @ts-expect-error `focusVisible` is native-only and excluded from the shared surface.
  focusVisible: { opacity: 1 },
}

void invalidSharedStyle
