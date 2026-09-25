# Testing GPU-IX apps

Tests render into a real native window placed offscreen, through Metal on macOS and DirectX on Windows (`packages/native/src/test_renderer.rs`). Linux has no test renderer. Paths below are relative to the GPU-IX repository; `testing.ts` is `packages/react/src/testing.ts`.

## Contents

- Traps
- Entry points and setup
- `render()` and `createTestRoot()`
- Window reuse and reset
- Queries and `TestElement`
- `userEvent` and native input
- `act()`
- Clocks, `waitFor` and `asyncTaskMode`
- Reduced motion in tests
- Matchers
- `toMatchScreenshot`
- Assert numbers, not pixels
- Automation client
- Open issues

## Traps

- **No native test runs inside an agent sandbox.** The renderer needs the window server and Metal device, which the macOS sandbox hides. Ask for an unsandboxed run the first time. A suite guarded with `isNativeTestRendererAvailable() ? describe : describe.skip` skips instead of failing when the renderer cannot load, so read the skipped count before calling a run green.
- **Build `dist` before running Vitest directly.** Package subpaths resolve to `packages/react/dist`; `bun run test` builds first, `vitest run` does not (#641).
- **There is no global `screen`, `waitFor`, `userEvent`, `within` or `fireEvent`.** They are fields of the object `render()` or `createTestRoot()` returns: `const screen = render(<App />)`, then `screen.getByRole(…)`, `await screen.userEvent.click(…)`, `await screen.waitFor(…)`.
- **`createTestRoot` comes from `@gpuix/react/testing`**, not from `@gpuix/react`.
- **`render()` shares one window per test file; `createTestRoot()` opens a new window per call.** `cleanup()` only takes down the `render()` tree. Call `unmount()` on every `createTestRoot()` root, which also closes its window.
- **A second `render()` in the same test replaces the first tree.** A window holds one React container.
- **Changing `render()` options between calls reopens the window.** An omitted option and the same option passed at its default value count as different. `onSelectionChange` is neither compared nor re-applied, so a reused window keeps the first callback. Keep one options object per file, or put suite defaults in `configureTestWindow`, which also closes the shared window when called.
- **Under `render()`, a top-level `height: "100%"` or `flexGrow: 1` gets no height.** The node mounts inside an auto-height `container`. Give the tree an explicit height, or use `createTestRoot()`, which mounts the node as the window root.
- **Nothing advances on its own.** There are three clocks (see Clocks). `requestAnimationFrame` callbacks run only on `renderer.advanceAsyncClock(ms)`. `waitFor` and `findBy*` do not advance the motion clock.
- **The motion clock runs on wall time unless paused**, so a plain assertion can catch a style transition mid-flight. Pause and step it (`renderer.clockPause()`, `renderer.clockFastForward(ms)`), or use `toMatchScreenshot`, which settles animations by default.
- **Reduced motion is off in test windows whatever the OS says.** Call `renderer.setReducedMotion(true)` to test the reduced path; `render()` resets it to `false` before every test.
- **`toBeVisible()` means "painted a box last frame".** `opacity: 0` passes. A culled virtual-list row fails, the same as `display: none`.
- **Unpainted elements throw.** `getBoundingClientRect()` and every `userEvent` pointer helper throw on an element that painted nothing, such as a culled row. Neither returns zeros.
- **`userEvent.keyboard(element, keys)` takes GPUI keystroke syntax**: space-separated, `"cmd-enter"`, `"shift-tab"`. user-event's `{Shift>}` syntax is not accepted.
- **Goldens are exact and have no platform suffix by default.** A macOS golden fails on Windows. Add the platform with `configureScreenshots({ resolveScreenshotPath })`.
- **Keep test trees small.** Render and Tab cost grow with the tree: at 250 rows about 65 ms per render and 118 ms per Tab, against 1–2 ms for a small tree (#663).

## Entry points and setup

| Import | Contents |
|---|---|
| `@gpuix/react/testing` | Framework-free: `render`, `createTestRoot`, `cleanup`, `act`, `TestRenderer`, `configureTestWindow`, `configuredTestWindow`, `resetSharedWindowForNextFile`, `disposeSharedWindow`, `isNativeTestRendererAvailable`, `textContent`, `rendererOf`, `describeElement`, `accessibleNameOf`, `computedRoleOf`, `matchesComputedRole`, `recordCanvasCommands`, `canvasGoldenPath`, `expectCanvasMatchesBrowser`. It never imports Vitest. |
| `@gpuix/react/testing/vitest` | Everything above, plus `expect.extend(gpuixMatchers)`, `afterEach(cleanup)`, and a per-file teardown that restores the `configureTestWindow`/`configureScreenshots` values in effect when the file started and calls `resetSharedWindowForNextFile()` (`testing-vitest.ts`). |
| `@gpuix/react/testing/matchers` | `gpuixMatchers`, `configureScreenshots`, `configuredScreenshots` and the matcher types (`testing-expect.ts`). |
| `@gpuix/react/automation` | The Playwright-like `App`/`Locator` client (see Automation client). |

Vitest setup is one line, in `setupFiles` or at the top of a test file:

```ts
import "@gpuix/react/testing/vitest"
```

- The optional `vitest` peer range is `^5.0.0`.
- Use the `forks` pool. Native state is thread-local and every call must come from the JS main thread (`test_renderer.rs`).
- Under `isolate: false`, list `@gpuix/react/testing/vitest` directly in `setupFiles`. Importing it from your own setup file registers the per-file hooks once only.
- Suite-wide geometry goes in a setup file: `configureTestWindow({ width, height, scaleFactor })`. Each call replaces the previous defaults wholesale. The default window is 1280×800 logical pixels at scale factor 2, never the host display's geometry.

Other runners wire it by hand: import from `@gpuix/react/testing`, register `afterEach(cleanup)`, call `resetSharedWindowForNextFile()` at each file's teardown (or `disposeSharedWindow()` to close the window), and `expect.extend(gpuixMatchers)`. No Bun test in the repository exercises this, and `toMatchScreenshot` reads Vitest's test context, so expect it to fail under other runners.

## `render()` and `createTestRoot()`

`createTestRoot(options)` returns `{ root, renderer, render(node), unmount(), within(el), userEvent, waitFor }` and the six query families. Its `render` commits inside `act` and flushes a frame.

`render(node, options)` returns the same plus `rerender`, `container` and `baseElement`, in vitest-browser-react's shape. Effects have run when it returns. The tree mounts as `baseElement` (100%×100%) > `container` (width 100%, auto height) > your node. `unmount()` empties `container` and keeps the window.

| Option | Meaning |
|---|---|
| `width`, `height`, `scaleFactor` | Offscreen window geometry. An invalid scale factor throws. |
| `asyncTaskMode` | `"eager"` (default) or `"manual"`; see Clocks. |
| `allowPrivateNetworkImages` | Allow loopback and private-address image URLs. |
| `strictStyles` | Strict style diagnostics; defaults to the runtime policy. |
| `onSelectionChange` | Window text-selection callback; set by the call that opens the window. |

## Window reuse and reset

`render()` keeps one window per module instance, which under Vitest's default `isolate: true` is one per test file (`testing-render.test.tsx` › "shares one window across sequential render() calls in a file"), and under `isolate: false` one per worker. A new window opens when the options differ (`onSelectionChange` by identity; geometry after `configureTestWindow` defaults are applied), or after the root died on an uncaught render error. The first window in a process costs roughly 250–700 ms and each later one about 150 ms.

Between tests, `cleanup()` renders `null` and resets the window size, the pointer (moved to (-1, -1)), focus and window activation, the text selection, the motion clock (set to 0 and resumed), reduced motion (`false`), `allowPrivateNetworkImages`, `strictStyles`, and queued native events.

Not reset between tests in one file: application menus and their key equivalents, the debug frame overlay's mode and statistics, a held or captured pointer, an OS file drag, pending animation frames, WebGPU devices and their resources, the in-memory clipboard and scripted picker results. `resetSharedWindowForNextFile()`, which the Vitest entry's per-file teardown calls, resets all of them and keeps the window for the next file (`testing-window-reuse.test.tsx`). CPU throttling is process-wide and never reset.

## Queries and `TestElement`

Families: `ByText`, `ByTestId`, `ByRole`, `ByLabelText`, `ByPlaceholderText`, `ByDisplayValue`, each with `get`, `query`, `getAll`, `queryAll`, `find` and `findAll`. There is no `ByAltText` or `ByTitle`.

| Family | Matches |
|---|---|
| `ByText` | Retained `<text>` content: own text plus direct children's; the innermost match wins. `<code>`, `<diff>` and `<markdown>` paint their text natively, so read them with `renderer.getPaintedText()`. |
| `ByTestId` | `data-testid`. |
| `ByRole` | Computed AccessKit role, accessible name and `level`. `hidden: true` throws. |
| `ByLabelText` | The `ariaLabel` prop only; `<label htmlFor>` and `title` are not consulted. |
| `ByPlaceholderText`, `ByDisplayValue` | The declared `placeholder`/`value` prop, not the live editor buffer. |

Text matching follows Testing Library: trimmed, whitespace-collapsed, exact; `{ exact: false }`, regular expressions, predicates and `normalizer` also work. `findBy*(matcher, options, waitForOptions)` is `waitFor(() => getBy*(…))`.

A `TestElement` has `id`, `type`, `style` (declared, not resolved), `text`, `events`, `children`, `parentElement`, `getBoundingClientRect()` (painted border box in logical pixels), `dataTestId`, `authorId`, `customProps` and `semantics`. Read hover, focus and other state styles with `renderer.getResolvedStyle(id)`.

## `userEvent` and native input

`userEvent` methods return promises: `click`, `dblClick` and `hover` (at the centre of the painted bounds, through GPUI hit-testing), `unhover` (moves the pointer outside the element, or to (-1, -1)), `type(el, text)` (focuses, then types keystroke by keystroke), `clear(el)` (`cmd-a` on macOS, `ctrl-a` elsewhere, then `backspace`), `tab({ shift })`, and `keyboard(el, keys)`. There is no `setup()`, `pointer()`, `selectOptions`, `upload` or `paste`. Each keystroke is committed before the next, so `"tab a"` types `a` into the element that took focus. Keyboard input draws only when a key changed something: a Tab draws once, to report the focus move, and a key nothing handles draws nothing.

Lower-level `TestRenderer` methods: `nativeSimulateClick(x, y, button?, modifiers?, clickCount?)`, `nativeSimulateKeystrokes(elementId, keys)`, `simulateKeystrokes(keys)` (to the focused element), `nativeSimulateMouseDown`/`MouseMove`/`MouseUp`, `nativeSimulateScrollWheel`, the `nativeSimulateFileDrop*` family, `dragSelect`, `simulateResize` and `setClipboardText`. Each dispatches inside its own `act` scope.

## `act()`

`act` is Testing Library's `act` over this renderer. A synchronous scope commits and flushes effects before returning. `render`, `rerender`, `unmount`, `userEvent` and the `nativeSimulate*` methods already run inside `act`; wrap only updates that start another way, such as a ref call or a manually driven interval.

## Clocks, `waitFor` and `asyncTaskMode`

| Clock | Advanced by | Drives |
|---|---|---|
| Async tasks and frames | `renderer.advanceAsyncClock(ms)` | Native async tasks, `requestAnimationFrame` callbacks (60 Hz cadence), GPUI timers. |
| GPUI timers | `renderer.advanceTime(ms)` | Caret blink, drag autoscroll, list edge scroll. Does not draw a frame or move JS `setTimeout`. |
| Motion | `clockPause()`, `clockSet(ms)`, `clockFastForward(ms)`, `clockResume()` | Style transitions and `motion` animations. Wall time unless paused. |

`waitFor(callback, { timeout = 1000, interval = 50 })` sleeps `interval` ms of wall time, then advances the async and timer clocks by `interval`, flushes, and retries. The clocks therefore advance about as fast as wall time: a 2000 ms GPUI timer is never reached inside the default timeout. Advance the clock directly instead.

`asyncTaskMode: "eager"` drains native async tasks after every renderer call. `"manual"` drains them only on `advanceAsyncClock`, and the repaint waits for `drawPendingFrame()`; use it to observe intermediate frames such as an image's `loading` state.

## Reduced motion in tests

The live renderer follows the OS Reduce Motion setting; test windows start with it off. `renderer.setReducedMotion(enabled)` sets it for a test. Live-window tests can simulate the platform setting with `renderer.testSetPlatformReducedMotion(bool)` (`examples/reduced-motion.test.tsx`).

## Matchers

Every matcher re-resolves its element; a removed element fails the assertion instead of throwing.

| Matcher | Asserts |
|---|---|
| `toBeInTheDocument()` | The element still resolves. |
| `toBeVisible()` | It painted bounds last frame (not CSS visibility). |
| `toBeInViewport({ ratio? })` | The painted box is inside the window, clipped by clipping ancestors. |
| `toBeDisabled()`, `toBeEnabled()` | `disabled` or `ariaDisabled` on the element itself; not inherited. |
| `toBeChecked()`, `toBePartiallyChecked()` | Computed AccessKit checked state; needs a checkable role. |
| `toBeEmptyDOMElement()` | No children and no own text. |
| `toHaveFocus()` | Holds window focus. |
| `toHaveTextContent(m, opts?)` | Own and descendant text; a bare string is a substring match; `''` throws. |
| `toHaveValue(string)` | Live editor value for `input`/`textarea`, otherwise the prop. Strings only. |
| `toHaveDisplayValue(m)` | The same value; a bare string is exact. |
| `toHaveAccessibleName(m?)`, `toHaveAccessibleDescription(m?)` | Computed name or description. |
| `toHaveRole(role)` | Computed role, explicit or implicit. |
| `toHaveAttribute(name, value?)` | Retained attribute with `getAttribute` semantics; `class` and `autofocus` throw. |
| `await toMatchScreenshot(name?, opts?)` | Golden comparison. |

Not provided: `toHaveClass`, `toHaveStyle`, `toContainElement`, `toContainHTML`, `toBeRequired`, `toBeInvalid`, `toHaveFormValues`. For styles use `renderer.getResolvedStyle(id)`.

## `toMatchScreenshot`

Await it; `.not.toMatchScreenshot` throws. It needs Vitest's test context.

- **Receiver**: a `render()` result or `TestRenderer` captures the window; a `TestElement` crops to its border box. Automation `Locator`s are not accepted.
- **Golden path**: `<root>/<test dir>/__screenshots__/<test file>/<name>.png`. Unnamed calls are named `"<test name> <n>"`.
- **Mismatch output**: `__diff_output__/<name>-actual.png`, `-diff.png`, `-reference.png` beside the goldens. Gitignore them.
- **Updates**: a missing golden is written and the assertion fails (review it and rerun); in CI (`--update=none`) a missing golden fails; `vitest --update` overwrites and passes.
- **Tolerance** (`comparatorOptions`): `tolerance` (per-channel delta 0–255, default 0), `differingPixelBudget` (fraction of pixels allowed past it, default 0), `maxChannelDelta` (default 255).
- **Animations**: the default `animations: "disabled"` pauses the motion clock and steps frames until no animation is active (up to 10 s of clock time), then captures and resumes. `"allow"` captures the current frame.
- **Cost**: an element capture decodes the whole window PNG in JavaScript, 120–161 ms per assertion at 2560×1600 (#662).

`renderer.captureScreenshot(path)` is a raw capture with no settling or comparison.

## Assert numbers, not pixels

For stateful surfaces, render the state into a readout (`<text data-testid="readout">{`x=${x} zoom=${z}`}</text>`) and assert its text; keep screenshots for review (`examples/timeline.test.tsx`). Native-painted content has its own readers: `getPaintedText()` for `<code>`, `<diff>` and `<markdown>`; `dragSelect(x1, y1, x2, y2)` for selection; `getPaintedHighlights()` for highlight quads; `getImageLoadState(id)` and `getElementBounds(id)` for images.

## Automation client

`@gpuix/react/automation` drives an app through one `App`/`Locator` API, whichever way it connects:

| Host | Connect |
|---|---|
| In-process test | `await connectTest(root.renderer)` |
| Live app as a child process | `await launch({ command, args, cwd, env })`; speaks the protocol over stdio. |
| Live app, its own side | Automatic when `process.stdin` is not a TTY. Protocol lines carry a `data:` prefix, so ordinary `console.log` output is safe. |
| Browser build | `globalThis.gpuix`, installed shortly after `render()` (asynchronously). |

Launch a live app without stealing focus by passing `env: { GPUIX_BACKGROUND: "1" }` and having the app call `render(<App />, { focus: process.env.GPUIX_BACKGROUND !== "1" })`. If the child exits, every call rejects with `AutomationError` code `"Closed"`, carrying `{ exitCode, signal, stderr }`.

- **Locators**: `getByTestId`, `getByText` (own text plus direct children's, innermost first), `getByLabelText` (`ariaLabel`), `getByPlaceholderText`, `getByDisplayValue`, `getByType`, chainable. **There is no `getByRole`.** Actions: `click`, `dblclick`, `hover`, `wheel` (platform deltas: down is negative), `dragTo`, `dragBy`, `fill`, `press(key)`; reads: `textContent`, `bounds`, `center`, `element`, `all`, `count`; `waitFor({ timeoutMs = 5000 })` polls wall time until one node matches and advances no clock.
- **`App`**: the same locator roots, `mouse.move|down|up|click|wheel|drag`, `clock.pause|set|fastForward|resume` (motion clock only), `screenshot({ path })`, `captureFrames(dir, timesMs)` (leaves the motion clock paused), `call(method, params)`, `close()`.
- The protocol has no role query, no async or timer clock control, no window resize and no menu action (`automation/protocol.ts`).

## Open issues

| Issue | Gap |
|---|---|
| #641 | Direct `vitest run` without a built `dist` fails to resolve modules. |
| #662 | Element screenshots decode the whole window in JavaScript. |
| #663 | Render and Tab cost grow sharply with tree size. |
