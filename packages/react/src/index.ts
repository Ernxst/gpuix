// GPUIX React - React bindings for GPUI
/**
 * Native ARIA roles translated to AccessKit.
 *
 * Consumers may declaration-merge web-only roles into this interface when a
 * shared React tree targets both GPUIX and the DOM.
 */
export interface AccessibilityRoleRegistry {
  alert: true
  alertdialog: true
  application: true
  article: true
  banner: true
  blockquote: true
  button: true
  caption: true
  cell: true
  checkbox: true
  code: true
  columnheader: true
  combobox: true
  comment: true
  complementary: true
  contentinfo: true
  definition: true
  deletion: true
  dialog: true
  document: true
  emphasis: true
  feed: true
  figure: true
  form: true
  generic: true
  grid: true
  gridcell: true
  group: true
  heading: true
  img: true
  insertion: true
  link: true
  list: true
  listbox: true
  listitem: true
  log: true
  main: true
  mark: true
  marquee: true
  math: true
  menu: true
  menubar: true
  menuitem: true
  menuitemcheckbox: true
  menuitemradio: true
  meter: true
  navigation: true
  none: true
  note: true
  option: true
  paragraph: true
  presentation: true
  progressbar: true
  radio: true
  radiogroup: true
  region: true
  row: true
  rowgroup: true
  rowheader: true
  scrollbar: true
  search: true
  searchbox: true
  sectionfooter: true
  sectionheader: true
  separator: true
  slider: true
  spinbutton: true
  status: true
  strong: true
  suggestion: true
  switch: true
  tab: true
  table: true
  tablist: true
  tabpanel: true
  term: true
  textbox: true
  time: true
  timer: true
  toolbar: true
  tooltip: true
  tree: true
  treegrid: true
  treeitem: true
  "graphics-document": true
  "graphics-object": true
  "graphics-symbol": true
  "doc-abstract": true
  "doc-acknowledgments": true
  "doc-afterword": true
  "doc-appendix": true
  "doc-backlink": true
  "doc-biblioentry": true
  "doc-bibliography": true
  "doc-biblioref": true
  "doc-chapter": true
  "doc-colophon": true
  "doc-conclusion": true
  "doc-cover": true
  "doc-credit": true
  "doc-credits": true
  "doc-dedication": true
  "doc-endnote": true
  "doc-endnotes": true
  "doc-epigraph": true
  "doc-epilogue": true
  "doc-errata": true
  "doc-example": true
  "doc-footnote": true
  "doc-foreword": true
  "doc-glossary": true
  "doc-glossref": true
  "doc-index": true
  "doc-introduction": true
  "doc-noteref": true
  "doc-notice": true
  "doc-pagebreak": true
  "doc-pagefooter": true
  "doc-pageheader": true
  "doc-pagelist": true
  "doc-part": true
  "doc-preface": true
  "doc-prologue": true
  "doc-pullquote": true
  "doc-qna": true
  "doc-subtitle": true
  "doc-tip": true
  "doc-toc": true
}

export type AccessibilityRole = keyof AccessibilityRoleRegistry & string

export { createRoot, flushSync } from "./reconciler/index.js"
export { __applyCanvasCommands } from "./canvas/commands.js"
export { createImageBitmap, Image } from "./canvas/image.js"
export {
  createRenderer,
  enableAutomation,
  render,
  resetRender,
  startFrameLoop,
} from "./reconciler/renderer.js"
export { cancelAnimationFrame, requestAnimationFrame } from "./frame-clock.js"
export type { FrameRequestCallback } from "./frame-clock.js"
export { GpuixContext, useGpuix, useGpuixRequired } from "./hooks/use-gpuix.js"
export { useWindowInsets, useWindowSize } from "./hooks/use-window-size.js"
export { findRanges, useTextSearch } from "./hooks/use-text-search.js"
export type {
  FindRangesOptions,
  TextSearch,
  TextSearchOptions,
} from "./hooks/use-text-search.js"
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./components/select.js"
export type {
  SelectContentProps,
  SelectItemProps,
  SelectItemState,
  SelectProps,
  SelectTriggerProps,
  SelectTriggerState,
  SelectValueProps,
} from "./components/select.js"
export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
} from "./components/combobox.js"
export type {
  ComboboxInputProps,
  ComboboxItemProps,
  ComboboxItemState,
  ComboboxListProps,
  ComboboxProps,
  ComboboxTriggerProps,
  ComboboxValueProps,
} from "./components/combobox.js"
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/tooltip.js"
export type {
  TooltipContentProps,
  TooltipProps,
  TooltipProviderProps,
  TooltipTriggerProps,
} from "./components/tooltip.js"
export { motion } from "./components/index.js"
export type {
  Root,
  FrameLoop,
  FrameLoopOptions,
  MenuActionEvent,
  RenderOptions,
} from "./reconciler/renderer.js"
export type {
  WindowInsets,
  WindowInsetsOptions,
  WindowSize,
} from "./hooks/use-window-size.js"

// Re-export types
export type { MotionDivProps } from "./components/index.js"
export type {
  AccessibilityAction,
  CanvasProps,
  CanvasPublicInstance,
  CursorValue,
  DebugFrameOverlayMode,
  DebugFrameOverlayStats,
  BackgroundValue,
  GridTemplate,
  GridTrack,
  GridTrackMax,
  GridTrackMin,
  GridTrackMinmax,
  GridTrackNonRepeat,
  GridTrackSizing,
  ImageMimeType,
  ImageSource,
  InputPublicInstance,
  SelectionDirection,
  LinearGradient,
  LinearGradientStop,
  EdgeInsets,
  ElementBounds,
  HighlightMatch,
  HighlightSpec,
  MotionEase,
  MotionProps,
  MotionSpringEase,
  MotionStyle,
  MotionTransition,
  NativeStateStyle,
  NativeStateStyleKey,
  NativeRenderer,
  PublicInstance,
  StyleTransition,
  RendererCapabilities,
  UnsupportedCapabilityError,
  StyleDiagnostic,
  NativeWindowInsets,
  StyleDesc,
  StyleSpringTransition,
  TransitionProperty,
  StyleTweenTransition,
} from "./types/host.js"
export { handleGpuixEvent } from "./reconciler/event-registry.js"
export type {
  GpuixEventDispatchResult,
  GpuixEventPhase,
  GpuixSyntheticEvent,
} from "./reconciler/synthetic-event.js"
export {
  applyMacCpuThrottleFromEnv,
  MAC_CPU_THROTTLES,
  readMacCpuThrottle,
} from "./cpu-throttle.js"
export type { MacCpuThrottle } from "./cpu-throttle.js"
export type {
  EventPayload,
  EventModifiers,
  MenuItemSpec,
  MenuSpec,
  WindowOptions,
  WindowSize as NativeWindowSize,
} from "@gpuix/native"

export { GpuixRenderer } from "@gpuix/native"
