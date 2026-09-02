# Platform accessibility smoke checks

The automated suite snapshots GPUI's real AccessKit tree and injects actions
through GPUI's production routing. It cannot prove that a platform adapter or a
screen reader announces the result correctly. Run these checks on the release
native addon after `cd packages/native && bun run build`.

Start the shared fixture from the repository root:

```bash
cd examples
bun run accessibility
```

Keep the window open while running the check for that OS. A passing manual
result includes the OS version, assistive technology and version, each observed
role/state/value, and whether every requested action changed the visible status.

## macOS: Accessibility Inspector and VoiceOver

1. Open Xcode > Open Developer Tool > Accessibility Inspector.
2. Select `GPUIX Accessibility Smoke` with the target picker, then inspect the
   four controls. Confirm the heading level, button, checkbox state and
   description, spin-button value/range, and link role.
3. Press Command-F5 to start VoiceOver. If macOS uses the function-row media
   keys, press Fn-Command-F5.
4. Press Control-Option-Right Arrow to move through the window. Confirm
   VoiceOver announces `GPUIX accessibility smoke` as a level-1 heading, then
   the Save button, Include byproducts checkbox and state, Machine count value,
   and Open recipe library link.
5. On Save, Include byproducts, and Open recipe library, press
   Control-Option-Space. Confirm the visible status changes exactly once for
   each activation and the checkbox's announced state changes.
6. On Machine count, press Control-Option-Shift-Down Arrow to interact if
   requested by VoiceOver, then Control-Option-Up Arrow and
   Control-Option-Down Arrow. Confirm the announced value and visible count
   increment and decrement once.

7. Live regions, with VoiceOver still running and focus left where it is. Both
   example regions mount already carrying text, so **expect each to be spoken
   once when the window appears** — the hidden alert assertively, the visible
   status politely. That is the mount-time divergence from the browser
   documented in the README, not a defect:
   1. Activate Save, then Include byproducts. Confirm VoiceOver speaks each new
      status line without the cursor moving to it.
   2. Increment Machine count while VoiceOver is mid-utterance. Confirm the
      visually hidden `Machine count: N` alert interrupts, while the visible
      `role="status"` line waits its turn.
   3. Activate Save twice in a row. Confirm the second activation is **silent**:
      the status text did not change, and GPUIX announces on a changed string
      rather than on a mutation. This divergence is documented in the README;
      do not "fix" it here.
   4. Confirm the visually hidden alert is spoken at all, since it paints
      nothing and reaches VoiceOver only through the accessibility tree.

This VoiceOver pass is required before claiming that the semantics are
announced correctly on macOS; a green build only proves that they are wired.

## Windows: Accessibility Insights and Narrator

1. Open Accessibility Insights for Windows and choose Live Inspect.
2. Target `GPUIX Accessibility Smoke`. Confirm the same heading, button,
   checkbox, spin-button, and link control types, names, states, and value range.
3. Press Control-Windows-Enter to start Narrator, then use Caps Lock-Right Arrow
   to scan the controls.
4. Press Caps Lock-Enter on the button, checkbox, and link. Confirm each visible
   status changes once and the checkbox state is announced.
5. On Machine count, use Narrator's announced increment/decrement commands and
   confirm the visible and announced value moves by one in each direction.

## Linux: Accerciser and Orca

1. Start the fixture from a graphical session with the fontconfig runtime flag:

   ```bash
   cd examples
   RUST_FONTCONFIG_DLOPEN=1 bun run accessibility
   ```

2. Open Accerciser, select `GPUIX Accessibility Smoke`, and inspect the AT-SPI
   tree. Confirm the same roles, names, description, checked state, heading
   level, and numeric value/range.
3. Start Orca with `orca`, use Orca-Right Arrow to scan the controls, and confirm
   the roles, state, and value are announced.
4. Use Orca's Activate command on the button, checkbox, and link; confirm each
   visible status changes once. Invoke increment and decrement on Machine count
   and confirm the visible and announced value moves by one each way.
