---
"@gpuix/native": patch
---

Writing an editor's value now cancels the edits it was still waiting for React
to answer. Each edit an `<input>` reports is remembered so the `value` prop
coming back can be recognised as that same edit returning rather than a fresh
instruction. A write — an imperative `ref.value`, or the controlled-state
restore — replaces the text those edits described, so they can no longer be in
flight; leaving them queued made a later prop that happened to equal one of them
look like a round trip, and the value the application asked for never reached
the editor.
