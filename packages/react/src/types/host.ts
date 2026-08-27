import type { EventPayload, MenuSpec } from "@gpuix/native"
import type { GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"

/**
 * CSS-compatible lengths accepted by the native layout parser. The grammar is
 * intentionally a literal union so unsupported units fail at the call site.
 * Keep this aligned with `DimensionValue::deserialize` in
 * `packages/native/src/style.rs`.
 */
type LengthAtom = `${number}px` | `${number}%` | `${number}ch`
type CalcExpression = `${LengthAtom} + ${LengthAtom}` | `${LengthAtom} - ${LengthAtom}`
export type DimensionValue =
  | number
  | "auto"
  | LengthAtom
  | `calc(${CalcExpression})`
  | `clamp(${LengthAtom}, ${LengthAtom}, ${LengthAtom})`

/** A line-height is either an absolute length or a unitless font-size multiplier. */
export type LineHeightValue = number | `${number}px` | `${number}`

type CssColorFunctionName =
  | "rgb"
  | "rgba"
  | "hsl"
  | "hsla"
  | "hwb"
  | "hwba"
  | "hsv"
  | "hsva"
  | "lab"
  | "lch"
  | "oklab"
  | "oklch"

type CssColorFunction =
  | CssColorFunctionName
  | Uppercase<CssColorFunctionName>
  | Capitalize<CssColorFunctionName>

/** CSS Color 4 named colours accepted by csscolorparser 0.8.3. */
export type CssNamedColor =
  | "aliceblue"
  | "antiquewhite"
  | "aqua"
  | "aquamarine"
  | "azure"
  | "beige"
  | "bisque"
  | "black"
  | "blanchedalmond"
  | "blue"
  | "blueviolet"
  | "brown"
  | "burlywood"
  | "cadetblue"
  | "chartreuse"
  | "chocolate"
  | "coral"
  | "cornflowerblue"
  | "cornsilk"
  | "crimson"
  | "cyan"
  | "darkblue"
  | "darkcyan"
  | "darkgoldenrod"
  | "darkgray"
  | "darkgreen"
  | "darkgrey"
  | "darkkhaki"
  | "darkmagenta"
  | "darkolivegreen"
  | "darkorange"
  | "darkorchid"
  | "darkred"
  | "darksalmon"
  | "darkseagreen"
  | "darkslateblue"
  | "darkslategray"
  | "darkslategrey"
  | "darkturquoise"
  | "darkviolet"
  | "deeppink"
  | "deepskyblue"
  | "dimgray"
  | "dimgrey"
  | "dodgerblue"
  | "firebrick"
  | "floralwhite"
  | "forestgreen"
  | "fuchsia"
  | "gainsboro"
  | "ghostwhite"
  | "gold"
  | "goldenrod"
  | "gray"
  | "green"
  | "greenyellow"
  | "grey"
  | "honeydew"
  | "hotpink"
  | "indianred"
  | "indigo"
  | "ivory"
  | "khaki"
  | "lavender"
  | "lavenderblush"
  | "lawngreen"
  | "lemonchiffon"
  | "lightblue"
  | "lightcoral"
  | "lightcyan"
  | "lightgoldenrodyellow"
  | "lightgray"
  | "lightgreen"
  | "lightgrey"
  | "lightpink"
  | "lightsalmon"
  | "lightseagreen"
  | "lightskyblue"
  | "lightslategray"
  | "lightslategrey"
  | "lightsteelblue"
  | "lightyellow"
  | "lime"
  | "limegreen"
  | "linen"
  | "magenta"
  | "maroon"
  | "mediumaquamarine"
  | "mediumblue"
  | "mediumorchid"
  | "mediumpurple"
  | "mediumseagreen"
  | "mediumslateblue"
  | "mediumspringgreen"
  | "mediumturquoise"
  | "mediumvioletred"
  | "midnightblue"
  | "mintcream"
  | "mistyrose"
  | "moccasin"
  | "navajowhite"
  | "navy"
  | "oldlace"
  | "olive"
  | "olivedrab"
  | "orange"
  | "orangered"
  | "orchid"
  | "palegoldenrod"
  | "palegreen"
  | "paleturquoise"
  | "palevioletred"
  | "papayawhip"
  | "peachpuff"
  | "peru"
  | "pink"
  | "plum"
  | "powderblue"
  | "purple"
  | "rebeccapurple"
  | "red"
  | "rosybrown"
  | "royalblue"
  | "saddlebrown"
  | "salmon"
  | "sandybrown"
  | "seagreen"
  | "seashell"
  | "sienna"
  | "silver"
  | "skyblue"
  | "slateblue"
  | "slategray"
  | "slategrey"
  | "snow"
  | "springgreen"
  | "steelblue"
  | "tan"
  | "teal"
  | "thistle"
  | "tomato"
  | "turquoise"
  | "violet"
  | "wheat"
  | "white"
  | "whitesmoke"
  | "yellow"
  | "yellowgreen"

/**
 * A colour authoring envelope for StyleDesc. The native csscolorparser 0.8.3
 * parser remains authoritative for hex digit counts, function arguments,
 * relative colours, and case-insensitive named colours.
 */
export type GpuixColor =
  | `#${string}`
  | `${CssColorFunction}(${string})`
  | CssNamedColor
  | "transparent"
  // Preserve dynamically-computed colours for the loud runtime diagnostics.
  | (string & {})

/** The native renderer supports CSS linear gradients as background strings. */
export type CssLinearGradient = `linear-gradient(${string})`

export type FontWeight =
  | number
  | `${number}`
  | "thin"
  | "extralight"
  | "extra-light"
  | "light"
  | "normal"
  | "medium"
  | "semibold"
  | "semi-bold"
  | "bold"
  | "extrabold"
  | "extra-bold"
  | "black"

export type Display = "flex" | "grid"
export type Visibility = "visible" | "hidden"
export type FlexDirection = "row" | "column"
export type FlexWrap = "nowrap" | "wrap" | "wrap-reverse"
export type AlignItems = "start" | "flex-start" | "center" | "end" | "flex-end" | "baseline" | "stretch"
export type AlignContent =
  | "normal"
  | "start"
  | "flex-start"
  | "center"
  | "end"
  | "flex-end"
  | "between"
  | "space-between"
  | "around"
  | "space-around"
  | "evenly"
  | "space-evenly"
  | "stretch"
export type JustifyContent = Exclude<AlignContent, "normal" | "stretch">
export type Position = "relative" | "absolute"
export type Overflow = "visible" | "hidden" | "scroll"
export type Cursor = "default" | "pointer"

export interface MotionStyle {
  width?: number
  height?: number
  opacity?: number
  top?: number
  right?: number
  bottom?: number
  left?: number
  borderRadius?: number
}

export type MotionEase =
  | "linear"
  | "ease"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | [number, number, number, number]

export interface MotionTransition {
  /** Duration in seconds. */
  duration?: number
  /** Delay in seconds. */
  delay?: number
  ease?: MotionEase
}

export interface MotionProps {
  initial?: MotionStyle | false
  animate: MotionStyle
  transition?: MotionTransition
}

export type TransitionProperty =
  | "opacity"
  | "backgroundColor"
  | "color"
  | "borderColor"
  | "outlineColor"
  | "width"
  | "height"
  | "minWidth"
  | "minHeight"
  | "maxWidth"
  | "maxHeight"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "borderRadius"
  | "borderTopLeftRadius"
  | "borderTopRightRadius"
  | "borderBottomLeftRadius"
  | "borderBottomRightRadius"

export interface StyleTransition {
  properties: TransitionProperty[]
  durationMs: number
  delayMs?: number
  easing?: MotionEase
}

/**
 * CSS `cursor` keywords GPUI can paint. An unlisted keyword is ignored, like
 * every other invalid style value.
 */
export type CursorValue =
  | "default"
  | "auto"
  | "pointer"
  | "text"
  | "vertical-text"
  | "crosshair"
  | "grab"
  | "grabbing"
  | "move"
  | "all-scroll"
  | "col-resize"
  | "row-resize"
  | "ew-resize"
  | "ns-resize"
  | "nwse-resize"
  | "nesw-resize"
  | "n-resize"
  | "e-resize"
  | "s-resize"
  | "w-resize"
  | "ne-resize"
  | "nw-resize"
  | "se-resize"
  | "sw-resize"
  | "not-allowed"
  | "no-drop"
  | "alias"
  | "copy"
  | "context-menu"

export interface BoxShadow {
  offsetX: number
  offsetY: number
  blurRadius: number
  spreadRadius: number
  color: GpuixColor
}

export interface LinearGradientStop {
  color: GpuixColor
  /** Position from 0 through 1. */
  position: number
}

export interface LinearGradient {
  type: "linearGradient"
  /** CSS angle in degrees: 0 points up, 90 points right. */
  angle: number
  stops: LinearGradientStop[]
  colorSpace?: "srgb" | "oklab"
}

export type BackgroundValue = GpuixColor | CssLinearGradient | LinearGradient

export type GridTrackSizing =
  | { type: "px"; value: number }
  | { type: "fr"; value: number }
  | { type: "auto" }
  | { type: "min-content" }
  | { type: "max-content" }

export type GridTrackMin = Exclude<GridTrackSizing, { type: "fr" }>
export type GridTrackMax = GridTrackSizing

export type GridTrackMinmax = {
  type: "minmax"
  min: GridTrackMin
  max: GridTrackMax
}

export type GridTrackNonRepeat = GridTrackSizing | GridTrackMinmax

/** A serializable CSS Grid track function. Integer templates remain supported as `repeat(n, 1fr)`. */
export type GridTrack =
  | GridTrackNonRepeat
  | { type: "repeat"; count: number; tracks: GridTrackNonRepeat[] }

export type GridTemplate = number | GridTrack[]

type NativeStateStyleKey =
  | "transition"
  | "hover"
  | "hoverWithin"
  | "active"
  | "focus"
  | "focusVisible"
type NativeStateStyle = Omit<StyleDesc, NativeStateStyleKey>

export interface StyleDesc {
  display?: Display
  visibility?: Visibility
  flexDirection?: FlexDirection
  flexWrap?: FlexWrap
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number
  alignItems?: AlignItems
  alignSelf?: AlignItems
  alignContent?: AlignContent
  justifyContent?: JustifyContent
  gap?: number
  rowGap?: number
  columnGap?: number
  gridTemplateColumns?: GridTemplate
  gridTemplateRows?: GridTemplate
  gridColumnMin?: "zero" | "min-content" | "max-content"
  gridRowMin?: "zero" | "min-content" | "max-content"

  width?: DimensionValue
  height?: DimensionValue
  minWidth?: DimensionValue
  minHeight?: DimensionValue
  maxWidth?: DimensionValue
  maxHeight?: DimensionValue

  padding?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number

  margin?: number
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number

  position?: Position
  top?: number
  right?: number
  bottom?: number
  left?: number

  background?: BackgroundValue
  backgroundColor?: GpuixColor
  color?: GpuixColor
  opacity?: number

  borderWidth?: number
  borderTopWidth?: number
  borderRightWidth?: number
  borderBottomWidth?: number
  borderLeftWidth?: number
  borderColor?: GpuixColor
  borderRadius?: number
  borderTopLeftRadius?: number
  borderTopRightRadius?: number
  borderBottomLeftRadius?: number
  borderBottomRightRadius?: number
  boxShadow?: BoxShadow
  outlineColor?: GpuixColor
  outlineWidth?: number
  outlineOffset?: number

  fontSize?: number
  fontFamily?: string
  fontWeight?: FontWeight
  letterSpacing?: number
  textDecoration?: "underline" | "line-through"
  textTransform?: "none" | "uppercase" | "lowercase"
  textAlign?: "left" | "start" | "center" | "right"
  lineHeight?: LineHeightValue
  whiteSpace?: "normal" | "nowrap" | "pre"
  textWrap?: "wrap" | "nowrap"
  textOverflow?: "ellipsis" | "ellipsis-start"
  lineClamp?: number

  overflow?: Overflow
  overflowX?: Overflow
  overflowY?: Overflow

  cursor?: CursorValue
  /** `"auto"` blocks hits behind this element **and its wheel**. `"none"` never
   *  blocks. Unset blocks clicks when the element paints a fill or is
   *  positioned, but lets the wheel reach the ancestor scroller, like HTML. */
  pointerEvents?: "auto" | "none"

  /** "none" opts this element and its subtree out of text selection.
   *  Inherited like the CSS property, so a toolbar can disable it once. */
  userSelect?: "text" | "none" | "auto"
  /** Selection wash colour for this subtree. Defaults to the theme accent at 35%. */
  selectionColor?: GpuixColor

  /** Native, interruptible interpolation for the named properties. */
  transition?: StyleTransition

  // Native state styles — applied by GPUI without a JS round trip.
  // Nesting is one level deep: a state style cannot contain another state style.
  hover?: NativeStateStyle
  /** Applies while the nearest ancestor with `hoverGroup` is hovered. */
  hoverWithin?: NativeStateStyle
  active?: NativeStateStyle
  focus?: NativeStateStyle
  focusVisible?: NativeStateStyle
}

// Element types supported by GPUIX
export type ElementType =
  | "div"
  | "text"
  | "main"
  | "header"
  | "footer"
  | "nav"
  | "section"
  | "article"
  | "aside"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "p"
  | "span"
  | "strong"
  | "em"
  | "ul"
  | "ol"
  | "li"
  | "a"
  | "button"
  | "kbd"
  | "img"
  | "svg"
  | "canvas"
  | "input"
  | "textarea"
  | "anchored"
  | "code"
  | "diff"
  | "markdown"
  | "virtual-list"

// ── Theme ────────────────────────────────────────────────────────────

/** Colours for one syntax capture class each. Every field is a CSS colour. */
export interface SyntaxTheme {
  comment?: string
  keyword?: string
  string?: string
  stringSpecial?: string
  escape?: string
  number?: string
  boolean?: string
  typeName?: string
  typeBuiltin?: string
  constructor?: string
  function?: string
  functionBuiltin?: string
  macroName?: string
  property?: string
  constant?: string
  variable?: string
  variableSpecial?: string
  parameter?: string
  operator?: string
  punctuation?: string
  tag?: string
  attribute?: string
  label?: string
  invalid?: string
}

/**
 * Every number that decides layout in the native text components.
 *
 * These live in the theme, not in Rust constants, so tuning a row height or a
 * heading scale is a React re-render and needs no native rebuild.
 */
export interface GpuixMetrics {
  // Code blocks. Shared by <code> and the markdown fenced block.
  codeTextSize?: number
  codeLineHeight?: number
  codeGutterDigitWidth?: number
  codeGutterPaddingRight?: number
  codeGutterMinWidth?: number

  // Diffs
  diffTextSize?: number
  diffLineHeight?: number
  diffFileHeaderHeight?: number
  diffHunkHeaderHeight?: number
  diffNoticeHeight?: number
  diffBodyBottomPad?: number
  diffGutterWidth?: number
  diffMarkerWidth?: number
  diffAccentBarWidth?: number
  diffRowPaddingX?: number

  // Markdown
  mdTextSize?: number
  mdLineHeight?: number
  mdBlockGap?: number
  /** `[h1, h2, h3, h4to6]`. A shorter array leaves the rest at their defaults. */
  mdHeadingSizes?: number[]
  mdHeadingLineHeights?: number[]
  mdTableCellPadding?: number
  mdTableMinColumnWidth?: number
  mdTableMinColumnContent?: number
  mdInlineCodeRadius?: number
  /**
   * The fenced-block card. `<code>` paints no card, so these are
   * markdown-only: style a `<code>` block with its own `style` prop instead.
   */
  mdCodePaddingX?: number
  mdCodePaddingY?: number
  mdCodeRadius?: number
  mdCodeHeaderPaddingY?: number
  mdCodeHeaderTextSize?: number
}

/**
 * Theme tokens for the native text components. Every field is optional and
 * layers on top of the built-in dark theme (or light, via `appearance`).
 */
export interface GpuixTheme {
  appearance?: "dark" | "light"
  bg?: string
  border?: string
  text?: string
  textMuted?: string
  textFaint?: string
  textDim?: string
  accent?: string
  caret?: string
  codeText?: string
  codeWash?: string
  diffAdd?: string
  diffDel?: string
  diffHunkBg?: string
  fontSans?: string
  fontMono?: string
  syntax?: SyntaxTheme
  metrics?: GpuixMetrics
}

/** One `highlight` entry. See `Props.highlight`. */
export interface HighlightSpec {
  /**
   * Substring to match. Case-insensitive unless `caseSensitive` is set.
   *
   * A match never crosses a line, exactly like browser find. It DOES cross the
   * several host nodes React makes for one interpolated line, so
   * `<text>Hello {name}!</text>` matches `Hello Tommy`.
   */
  query?: string
  caseSensitive?: boolean
  /** Only match when neither neighbour is alphanumeric or `_`. */
  wholeWord?: boolean
  /**
   * Explicit `[start, end)` pairs in UTF-16 code units, the units `indexOf` and
   * `RegExp.exec` return. They index the declaring subtree's text, with a
   * newline between lines.
   *
   * A pair that splits a surrogate pair is rejected, not snapped. Native text
   * (`<code>`, `<markdown>`, `<diff>`) is not part of that text; use `query`.
   */
  ranges?: Array<[number, number]>
  /** Any CSS colour. Defaults to the theme accent at 30% alpha. */
  color?: string
  /** Colour for the match at `activeIndex`. Defaults to accent at 65%. */
  activeColor?: string
  /** Index of the match to highlight differently, for a find-bar cursor. */
  activeIndex?: number
  /**
   * How many MATCHES come before this subtree in your document, so `activeIndex`
   * is compared against `matchIndexOffset + n` for the nth match here.
   *
   * It is a match count, not a row index. Rows hold different numbers of
   * matches, so a row index cannot stand in for it.
   *
   * Only needed for virtualized content: a `<virtual-list>` mounts a window of
   * its rows, so native can only number what that window contains. Sum
   * `findRanges` over the rows before `windowStart`. Defaults to 0.
   *
   * A negative or fractional value is refused and the whole spec is dropped,
   * because a bad offset silently marks the wrong match.
   */
  matchIndexOffset?: number
  /** Corner radius of the wash. Defaults to 2. */
  radius?: number
}

/** One highlight wash painted in the last frame. Test-facing. */
export interface HighlightMatch {
  elementId: number
  /** Index of the run within that element. 0 for a plain `<text>`. */
  sub: number
  /** The run's full string, so `text.slice(start, end)` is the match. */
  text: string
  start: number
  end: number
  active: boolean
  /** One box per visual row, so a soft-wrapped match has two. */
  rects: Array<{ x: number; y: number; width: number; height: number }>
}

// Props passed to elements.
// Element IDs are auto-generated numeric IDs (not user-settable).
// Use React refs to get an element's ID: ref.current.id
export interface Props {
  // `key` must live here, not in `JSX.IntrinsicAttributes`. TypeScript 5 ignores
  // that member for intrinsic elements, and React's DOM types work only because
  // `DetailedHTMLProps` already carries `key`. Without this field every
  // `<div key={...} />` inside a `.map()` fails to typecheck.
  key?: React.Key | null
  style?: StyleDesc
  children?: React.ReactNode
  ref?: React.Ref<PublicInstance>

  /** Author-defined identity preserved for shared DOM/native JSX and native diagnostics. */
  id?: string
  /** Inert author metadata preserved for automation and event host handles. */
  [key: `data-${string}`]: string | number | boolean | undefined

  /** Establishes a native hover group for descendant `style.hoverWithin` states. */
  hoverGroup?: string

  // ── Mouse events ───────────────────────────────────────────────
  /** Primary button only, like the DOM. Use `onAuxClick` for the others. */
  onClick?: (event: GpuixSyntheticEvent) => void
  onClickCapture?: (event: GpuixSyntheticEvent) => void
  /** Non-primary click, like the DOM `auxclick`. */
  onAuxClick?: (event: GpuixSyntheticEvent) => void
  onAuxClickCapture?: (event: GpuixSyntheticEvent) => void
  onMouseDown?: (event: GpuixSyntheticEvent) => void
  onMouseDownCapture?: (event: GpuixSyntheticEvent) => void
  onMouseUp?: (event: GpuixSyntheticEvent) => void
  onMouseUpCapture?: (event: GpuixSyntheticEvent) => void
  onMouseEnter?: (event: GpuixSyntheticEvent) => void
  onMouseLeave?: (event: GpuixSyntheticEvent) => void
  onMouseMove?: (event: GpuixSyntheticEvent) => void
  onMouseMoveCapture?: (event: GpuixSyntheticEvent) => void
  /** Fires when user clicks OUTSIDE this element. Use for "click outside to close". */
  onMouseDownOutside?: (event: GpuixSyntheticEvent) => void

  // ── Keyboard events (need focus: autoFocus, or a click on the element) ──
  onKeyDown?: (event: GpuixSyntheticEvent) => void
  onKeyDownCapture?: (event: GpuixSyntheticEvent) => void
  onKeyUp?: (event: GpuixSyntheticEvent) => void
  onKeyUpCapture?: (event: GpuixSyntheticEvent) => void

  // ── Focus events ───────────────────────────────────────────────
  onFocus?: (event: GpuixSyntheticEvent) => void
  onFocusCapture?: (event: GpuixSyntheticEvent) => void
  onBlur?: (event: GpuixSyntheticEvent) => void
  onBlurCapture?: (event: GpuixSyntheticEvent) => void

  // ── Scroll events ──────────────────────────────────────────────
  onScroll?: (event: GpuixSyntheticEvent) => void
  onScrollCapture?: (event: GpuixSyntheticEvent) => void

  // ── Text editor events ─────────────────────────────────────────
  onChange?: (event: GpuixSyntheticEvent) => void
  onChangeCapture?: (event: GpuixSyntheticEvent) => void
  onSubmit?: (event: GpuixSyntheticEvent) => void
  onSubmitCapture?: (event: GpuixSyntheticEvent) => void

  // ── Native component events ─────────────────────────────────────
  onToggleFile?: (event: GpuixSyntheticEvent) => void
  onShowMore?: (event: GpuixSyntheticEvent) => void
  onLineClick?: (event: GpuixSyntheticEvent) => void
  onLinkClick?: (event: GpuixSyntheticEvent) => void
  onVisibleRange?: (event: GpuixSyntheticEvent) => void
  /** Match count changed for this element's `highlight`. See `matchCount`. */
  onHighlight?: (event: GpuixSyntheticEvent) => void

  // ── Highlight ──────────────────────────────────────────────────
  /**
   * Paint a background wash behind matched or explicitly given text ranges.
   *
   * Scoped by position: on the root it searches the window, on a container it
   * searches that container. The nearest declaration wins, so a nested
   * `highlight` replaces an ancestor's for its own subtree.
   */
  highlight?: HighlightSpec | HighlightSpec[] | null

  // ── Focus props ────────────────────────────────────────────────
  /** Take keyboard focus when the element first mounts. Required for `<input>`:
   *  without it, or a click, the field never receives key events. */
  autoFocus?: boolean
  /** Native GPUI tab order. Use 0 for normal keyboard focus. */
  tabIndex?: number
  /** Stable locator id for automation. */
  testId?: string
  /** Internal native animation description used by motion components. */
  motion?: MotionProps
}

// Props for native text editor elements.
export interface InputProps extends Props {
  /** External editor value. Native edits apply immediately and report through onChange. */
  value?: string
  placeholder?: string
  readOnly?: boolean
  theme?: GpuixTheme
}

export interface TextareaProps extends InputProps {
  minRows?: number
  maxRows?: number
}

/** A variable-height list that builds only rows near its viewport. */
export interface VirtualListProps {
  style?: StyleDesc
  children?: React.ReactNode
  ref?: React.Ref<PublicInstance>
  alignment?: "top" | "bottom"
  followTail?: boolean
  overdraw?: number
  /** Defaults to 48 px. Pass `null` to opt out of estimating unvisited rows. */
  estimatedItemHeight?: number | null
  /** Logical row count. When set, `children` is only the mounted window. */
  itemCount?: number
  /** Logical index of `children[0]`. Ignored when `itemCount` is unset. */
  windowStart?: number
  onVisibleRange?: (event: GpuixSyntheticEvent) => void
}

export type ImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "image/svg+xml"

/** An unambiguous, serialisable source for native image rendering. */
export type ImageSource =
  | { kind: "path"; path: string }
  | { kind: "url"; url: string }
  | {
      kind: "data"
      mimeType: ImageMimeType
      bytes: ArrayBuffer | Uint8Array | readonly number[]
    }

// Props for native <img> rendering.
export interface ImgProps extends Props {
  /**
   * An explicit source, or DOM-compatible sugar: `http(s)://` strings are URL
   * sources and every other string is a filesystem path.
   */
  src?: ImageSource | string
  objectFit?: "fill" | "contain" | "cover" | "scaleDown" | "none"
  /** For SVG only: resolve authored `currentColor` references from inherited style.color. */
  tint?: "currentColor"
  alt?: string
}

// Props for monochrome SVGs tinted by style.color.
export interface SvgProps extends Props {
  /** Desktop local path. Use source for portable browser rendering. */
  src?: string
  /** Raw SVG markup rendered directly by GPUI. */
  source?: string
}

/**
 * Props for the <code> custom element — a syntax-highlighted code block.
 *
 * It paints **no surface of its own**: no fill, border, radius, padding or
 * language header. `style` is the surface, and `fontFamily`, `fontSize`,
 * `fontWeight`, `lineHeight` and `color` there beat the theme. Wrap it, or
 * style it, to get a card.
 *
 * Rows are a fixed height, so `fontSize` alone scales that height by the
 * theme's ratio. Lines never wrap and the block is its own horizontal
 * scroller, so `whiteSpace` and `overflowX` do nothing.
 */
export interface CodeProps extends Props {
  /** The source to display. Rendered one div per line at an exact line height. */
  code?: string
  /** Language alias such as "ts", "rust", "bash". Beats `path` for detection. */
  language?: string
  /** File path, used for extension-based language detection. */
  path?: string
  showLineNumbers?: boolean
  theme?: GpuixTheme
}

// Props for the <diff> custom element — a unified diff viewer.
export interface DiffProps extends Props {
  /** A unified git patch (the output of `git diff`). */
  patch?: string
  /** Highlight the words that changed inside paired +/- lines. */
  wordDiff?: boolean
  /** File paths rendered as a header only. Collapsed bodies cost one row. */
  collapsedPaths?: string[]
  /**
    * Use the virtualized `list()` scroller. Off by default so a parent
    * list can be the only scroll container. Requires a bounded height.
   */
  scroll?: boolean
  /** Paint this many line rows, then a Show more row. */
  maxLines?: number
  theme?: GpuixTheme
  /** Fires when a file header is clicked. `event.value` is the file path. */
  onToggleFile?: (event: GpuixSyntheticEvent) => void
  /** Fires when Show more is clicked. `event.value` is the hidden line count. */
  onShowMore?: (event: GpuixSyntheticEvent) => void
  /** Fires when a diff line is clicked. `event.value` is the line text,
   *  `event.oldLine` / `event.newLine` are its line numbers. */
  onLineClick?: (event: GpuixSyntheticEvent) => void
}

// Props for the <markdown> custom element.
export interface MarkdownProps extends Props {
  /** GitHub-flavoured markdown. Tables, strikethrough and task lists are on. */
  source?: string
  theme?: GpuixTheme
  /** Fires when a block containing links is clicked. `event.value` is the URL. */
  onLinkClick?: (event: GpuixSyntheticEvent) => void
}

// Props for the <anchored> custom element.
export interface AnchoredProps extends Props {
  position?: { x: number; y: number }
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  gap?: number
  anchor?:
    | "topLeft"
    | "topCenter"
    | "topRight"
    | "rightCenter"
    | "bottomRight"
    | "bottomCenter"
    | "bottomLeft"
    | "leftCenter"
  offset?: { x: number; y: number }
  fit?: "switch" | "snap"
  snapMargin?: number
  deferred?: boolean
  priority?: number
  occlude?: boolean
}

/** Canvas bitmap coordinates. Layout can independently resize the element. */
export interface CanvasProps extends Props {
  ref?: React.Ref<CanvasPublicInstance>
  width?: number
  height?: number
}

/// Interface for the renderer that receives mutations from the reconciler.
/// Implemented by the real napi GpuixRenderer and by TestRenderer (which
/// delegates to native TestGpuixRenderer for tests).
export interface NativeRenderer {
  createElement(id: number, elementType: string): void
  destroyElement(id: number): Array<number>
  appendChild(parentId: number, childId: number): void
  removeChild(parentId: number, childId: number): void
  insertBefore(parentId: number, childId: number, beforeId: number): void
  setStyle(id: number, styleJson: string | object): void
  setText(id: number, content: string): void
  setEventListener(id: number, eventType: string, hasHandler: boolean): void
  setRoot(id: number): void
  commitMutations(): void
  /** Replace a retained canvas display list without a React commit. */
  applyCanvasCommands?(
    id: number,
    ops: Uint32Array,
    operands: Float64Array,
    strings: readonly string[]
  ): void
  /** Stable platform and renderer feature read. Legacy probes remain available. */
  capabilities?(): RendererCapabilities
  /** Drop a buffered commit after JS-side contract validation fails. */
  discardMutations?(): void
  setCustomProp(id: number, key: string, valueJson: string | object | number | boolean | null): void
  /** Apply a batch of mutations in a single FFI call. Returns destroyed IDs. */
  applyBatch?(json: string): Array<number>
  setStrictStyles?(enabled: boolean): void
  /** Opt in to loopback/private URL images. Link-local and metadata ranges stay blocked. */
  setAllowPrivateNetworkImages?(enabled: boolean): void
  /** Capture a frame in a capability-advertised image format. */
  captureScreenshot?(path: string): void
  drainStyleDiagnostics?(): StyleDiagnostic[]

  // ── Application lifecycle ──────────────────────────────────────
  setMenus?(menus: MenuSpec[]): void
  quit?(): void
  requiresTick?(): boolean
  tick?(): boolean
  /** Install a coalesced native frame source. Returns false when timers must drive ticks. */
  setFrameRequestHandler?(handler: (() => void) | null): boolean
  /** Queue one callback on GPUI's next display-paced frame without dirtying the window. */
  requestFrame?(handler: (timestamp: number) => void): void
  /** Pump idle platform work without releasing a pending display-link frame token. */
  tickIdle?(): boolean
  /** Internal hook used by injected renderers to deliver non-element events. */
  setApplicationEventHandler?(handler: ((event: EventPayload) => void) | null): void

  // ── Focus API ──────────────────────────────────────────────────
  focusElement?(elementId: number): void
  blur?(): void

  // ── Pointer capture API ────────────────────────────────────────
  setPointerCapture?(elementId: number): void
  releasePointerCapture?(elementId: number): void

  // ── Scroll API ─────────────────────────────────────────────────
  /** Set the scroll offset of a scrollable element (overflow: "scroll").
   *  x and y are negative pixel values (scroll down = more negative y). */
  scrollTo?(elementId: number, x: number, y: number): void
  /** Scroll a child into view by its index in the children list. */
  scrollToItem?(elementId: number, index: number): void
  /** Get the current scroll offset [x, y] or null if element is not scrollable. */
  getScrollOffset?(elementId: number): Array<number> | null

  // ── Selection API ──────────────────────────────────────────────
  /** The current text selection joined in document order, or null. */
  getSelectedText?(): string | null
  /** Drop the current selection. */
  clearSelection?(): void

  // ── Highlight API ──────────────────────────────────────────────
  /** Every highlight wash painted in the last frame, in paint order.
   *  A quad never appears in getPaintedText(), so this is how `highlight`
   *  is asserted without a screenshot. */
  getPaintedHighlights?(): HighlightMatch[]

  /**
   * Read one element's current layout bounds. This is a rendered-state read
   * boundary: implementations draw/flush the committed tree before returning
   * the last-painted bounds, so it is safe to call after a React commit.
   */
  getElementBounds?(elementId: number): readonly number[] | null

  // ── Window API ─────────────────────────────────────────────────
  /** Whether the native window is active and receiving key events. */
  isActive?(): boolean
  /** Request foreground activation when `capabilities().window.activate` is true. */
  activateWindow?(): void
  /** Reads the live logical window dimensions and device-pixel scale factor. */
  getWindowSize?(): { width: number; height: number; scaleFactor: number }
  /** Internal transport for renderer-global native window events. */
  setWindowEventHandler?(handler: ((event: EventPayload) => void) | null): void
  getWindowInsets?(): NativeWindowInsets
  setWindowTitle?(title: string): void
  setDebugFrameOverlay?(mode: DebugFrameOverlayMode): string
  getDebugFrameOverlay?(): string
  cycleDebugFrameOverlay?(): string
  resetDebugFrameOverlayStats?(): void
  getDebugFrameOverlayStats?(): DebugFrameOverlayStats
}

export interface StyleDiagnostic {
  message: string
  elementId: number
  elementType: string
  /** The author's `id` attribute, when the affected element has one. */
  authorId?: string
  /** The standard `data-testid` attribute, when the affected element has one. */
  dataTestId?: string
  testId?: string
  property: string
  value: string
}

export type DebugFrameOverlayMode = "hidden" | "minimal" | "full"

export interface UnsupportedCapabilityError extends Error {
  name: "UnsupportedCapabilityError"
  code: "ERR_GPUX_UNSUPPORTED_CAPABILITY"
  capability: string
}

/** Features offered by one renderer instance on its current platform. */
export interface RendererCapabilities {
  platform: "macos" | "windows" | "linux" | "freebsd" | "browser" | "unknown"
  frameClock: {
    /** The source actively driving frames now, not a platform default. */
    kind: "display-link" | "timer" | "raf" | "manual"
    requiresTick: boolean
    /** `setFrameRequestHandler()` can select an external frame source. */
    externalFrame: boolean
  }
  window: {
    activation: boolean
    activate: boolean
    resize: boolean
    multiple: boolean
  }
  images: {
    privateNetwork: boolean
  }
  automation: {
    click: boolean
    hover: boolean
    drag: boolean
    scrollWheel: boolean
    keyboard: "native" | "browser"
    screenshot: boolean
    screenshotFormats: Array<"png">
    clock: boolean
    tree: boolean
  }
}

export interface EdgeInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface NativeWindowInsets {
  safeArea: EdgeInsets
  ime: EdgeInsets
  effective: EdgeInsets
}

export interface DebugFrameOverlayStats {
  currentMs?: number
  p90Ms?: number
  p99Ms?: number
  maxMs?: number
  frames: number
  samples: number
}

export type EventHandlerMap = Map<
  number,
  Map<string, (event: GpuixSyntheticEvent) => void>
>

export interface ElementIdAllocator {
  nextElementId: number
}

// One React root. Event handlers stay on this object so two live roots
// can both use id 1. Ids come from an allocator that lives with the
// NativeRenderer, so a remount on the same renderer cannot reuse them.
export interface Container {
  renderer: NativeRenderer
  ids: ElementIdAllocator
  eventHandlers: EventHandlerMap
  eventTargets: Map<number, Instance>
  /** The last hover target path reported by native hit testing. */
  hoverPath: Instance[]
  preventedKeyboardActivations: Map<number, string>
  strictStyles: boolean
}

/** Bounds in logical window coordinates, relative to the window's content origin. */
export interface ElementBounds {
  x: number
  y: number
  width: number
  height: number
}

// Public instance exposed via refs. Type-specific interfaces deepen this seam
// without putting browser-only methods on every native element.
export interface PublicInstance {
  id: number
  type: ElementType
  props: Props
  setPointerCapture(): void
  releasePointerCapture(): void
  parentId: number | null
  getAttribute(name: string): string | null
  /**
   * Returns the current layout bounds in logical window coordinates, relative
   * to the window's content origin. This forces the committed tree through a
   * rendered-state read before returning; it is not a cached React layout.
   * Returns null when the element has no painted bounds.
   */
  getBounds(): ElementBounds | null
}

export interface CanvasPublicInstance extends PublicInstance {
  type: "canvas"
  getContext(
    contextId: "2d",
    options?: CanvasRenderingContext2DSettings
  ): CanvasRenderingContext2D
  getContext(contextId: string, options?: unknown): CanvasRenderingContext2D | null
}

// Internal host instance. The real element state lives in Rust's RetainedTree.
export interface Instance extends PublicInstance {
  getContext?: CanvasPublicInstance["getContext"]
  __applyCanvasCommands(
    ops: Uint32Array,
    operands: Float64Array,
    strings: readonly string[]
  ): void
}

// Text instance for raw text nodes
export interface TextInstance {
  id: number
  text: string
  parentId: number | null
}

// Host context passed down the tree
export interface HostContext {
  isInsideText: boolean
}
