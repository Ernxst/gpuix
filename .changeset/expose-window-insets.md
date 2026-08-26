---
'@gpuix/native': minor
'@gpuix/react': minor
---

Expose system and software-keyboard geometry through `getWindowInsets()` and the reactive `useWindowInsets()` hook, so a composer can stay above the iOS keyboard instead of hiding behind it.

```tsx
const { keyboardTop, keyboardVisible, ime } = useWindowInsets()

return (
  <div style={{ paddingBottom: ime.bottom }}>
    {keyboardVisible ? `Keyboard starts at ${keyboardTop}px` : 'Keyboard closed'}
  </div>
)
```

**Values are pull-based, not event-driven.** Safari fires `visualViewport` events in bursts while the keyboard animates, and iOS is documented to report stale values on some of them. The hook samples every **100 ms** instead and only rerenders when the numbers actually change, so an animating keyboard cannot flood React with renders.

```tsx
useWindowInsets()                      // 100ms, the default
useWindowInsets({ intervalMs: 250 })   // slower
useWindowInsets({ intervalMs: false }) // read once, never poll
```

The reported geometry comes from GPUI's own `WindowInsets`, so the same hook works when a platform reports real safe areas rather than browser viewport math:

| Field | Meaning |
| --- | --- |
| `ime` | Edges covered by the software keyboard |
| `safeArea` | Edges covered by notches, status bars, home indicators |
| `effective` | Per-edge max of the two, the region content should avoid |
| `keyboardTop` | Y coordinate where the keyboard starts |
| `keyboardVisible` | `ime.bottom > 0` |
| `visibleHeight` | Window height minus the effective top and bottom |

Pinch zoom shrinks `visualViewport.height` exactly like a keyboard does, so the browser implementation scales the height back into layout space before subtracting. A zoomed page no longer reports a phantom keyboard.

The Wasm chat example uses `ime.bottom` to keep its composer and workspace footer above the keyboard.
