---
'@gpuix/native': patch
---

Fix touch scrolling, long-press selection, and keyboard focus in the iOS browser build.

Touch pans were mapped to mouse drags, so a swipe selected text instead of scrolling. The canvas also uses `touch-action: none`, so the browser cannot scroll itself. Touch pans now emit **scroll wheel** events. Taps do not start text selection. A **long press** followed by a drag still selects.

Text inputs now request the software keyboard during their tap handler. This avoids reading the previous frame's focus, so tapping the composer opens the keyboard and tapping other content closes it. Cancelled and secondary touches no longer leave selection or scroll gestures active.

A pan no longer ends with a zero scroll delta. `<virtual-list>` derives its offset from the scroll top of the last painted frame, so a trailing zero replaced the gesture's delta and snapped the list back whenever the finger lifted in the same frame as its last move.

```ts
// swipe the transcript: it scrolls
// tap the composer: the keyboard stays
// long-press then drag: text selects
```
