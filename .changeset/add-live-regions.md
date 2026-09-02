---
"@gpuix/native": minor
"@gpuix/react": minor
---

Adds live regions, so a screen reader announces a text change without focus moving to it.

`ariaLive` takes `"off"`, `"polite"`, or `"assertive"` and accepts the DOM spelling `aria-live`. `ariaAtomic` / `aria-atomic` asks assistive technology to present the whole region rather than only the part that changed. Both need an explicit supported `role`: GPUI contributes no accessibility node without one, so a role-less `ariaLive` is reported as ignored — with the roles to use — rather than being given an invented one.

Five roles carry WAI-ARIA's implicit politeness, so the usual cases need no `ariaLive` at all: `alert` is assertive and atomic, `status` is polite and atomic, `log` is polite and non-atomic, and `marquee` and `timer` are `off`. An authored value overrides the implicit one, as in the DOM. Politeness inherits down the accessibility tree, so the region carries it while the painted text inside it is what changes.

A `visuallyHidden` live region — the `sr-only` announcement pattern — now writes its flattened text to both the node's label and its value. The projection is one node with no child to speak for it, and the platforms disagree about which property they announce: macOS reads the value, Windows and AT-SPI read the name. Ordinary `visuallyHidden` nodes keep exactly the name they had.

AccessKit ships the whole live-region model and all three platform adapters implement it; the gap was GPUI never exposing it. The vendored fork gains `aria_live` / `aria_atomic` builders on `StatefulInteractiveElement`, the matching `AriaProperties` fields and `write_a11y_info` writes, and `live` / `live_atomic` in the debug accessibility tree, which is what `getAccessibilityTree()` asserts against.

Announcements come from AccessKit diffing consecutive frames rather than from a mutation record, so four behaviours differ from a browser and are documented in the README: a live region that mounts already containing text is announced at every politeness (browsers do that only for `role="alert"`); setting the same string twice in a row is silent; several changes inside one React commit announce once with the final text; and a live region scrolled out of a clipping ancestor stops announcing. `aria-busy` and `aria-relevant` have no AccessKit equivalent and remain unsupported. Verified on macOS with VoiceOver via `docs/accessibility-smoke.md`, which gains a live-region pass; Windows and Linux use the same AccessKit properties but are unverified here.

Fixes #271
