---
'@gpuix/react': minor
---

`render()` gains `errorOverlay`, on by default outside production: instead of quitting when an owned renderer's root dies from an uncaught render error, the process hits an uncaught exception or unhandled rejection, or an event handler throws, it unmounts the dead tree and shows a full-window "Runtime error" panel with the message, a scrollable stack, and a Reload button, keeping the window open. Reload re-mounts the last node and options `render()` was given; a subsequent `render()` call (what `bun --hot` does after the source is fixed) replaces the overlay root and clears it. An injected `renderer` keeps today's behavior: `errorOverlay` is ignored, since the embedder owns that lifecycle.

Fixes #357
