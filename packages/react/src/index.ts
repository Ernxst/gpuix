// GPUIX React - React bindings for GPUI
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
  AccessibilityRole,
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
  LinearGradient,
  LinearGradientStop,
  EdgeInsets,
  ElementBounds,
  HighlightMatch,
  HighlightSpec,
  MotionEase,
  MotionProps,
  MotionStyle,
  MotionTransition,
  NativeRenderer,
  PublicInstance,
  StyleTransition,
  RendererCapabilities,
  UnsupportedCapabilityError,
  StyleDiagnostic,
  NativeWindowInsets,
  StyleDesc,
  TransitionProperty,
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
