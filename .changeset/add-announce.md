---
"@gpuix/react": minor
---

Add an imperative `announce(message, options?)` for screen-reader messages
that have no element of their own. It speaks through a hidden `role="status"`
(default) or `role="alert"` (`{ politeness: "assertive" }`) live region,
alternating between two regions per politeness so the same message announced
twice in a row is spoken twice.

The regions are plain native elements outside the React tree — one pair per
politeness, per window — attached beneath whichever root most recently
rendered. They are rebuilt automatically after that root remounts.

Fixes #319
