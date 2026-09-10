---
'@gpuix/react': minor
---

Handler props are now typed with the specific synthetic event each kind delivers — `onClick` etc. take `GpuixMouseEvent`, `onWheel` takes `GpuixWheelEvent`, `onKeyDown`/`onKeyUp` take `GpuixKeyboardEvent`, `onFocus`/`onBlur` take `GpuixFocusEvent`, `onScroll` takes `GpuixScrollEvent`, `onChange` takes `GpuixChangeEvent`, and the custom-element events take `GpuixElementEvent`. `GpuixSyntheticEvent` is now the union of these, still exported under the same name.

This is a type-only change: the runtime object is unchanged, and every existing handler typed `(event: GpuixSyntheticEvent) => void` still compiles. Code that read a kind-specific member (e.g. `event.x`, `event.key`) off a value typed as the union now needs to narrow on `event.type` first, or read `event.nativeEvent`.
