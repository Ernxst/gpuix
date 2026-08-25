# GPUIX

React bindings for [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui) - Zed's GPU-accelerated UI framework.

Build native GPU-accelerated desktop apps with React and TypeScript. Your components render directly to the GPU via Metal, DirectX, or Vulkan. No Electron, no web views.

![A Waku-style app built with GPUIX](docs/images/chat-app.png)

Everything above is GPUIX: the sidebar, the scrolling list, the composer,
and native `<markdown>`. Start it with **`bun --hot`** so a save remounts React
on the same window:

```bash
cd examples && bun --hot chat.tsx
```

## Examples

| Example | Run | What it shows |
|---|---|---|
| **chat** | `bun --hot chat.tsx` | A Waku-style app: transparent titlebar, animated sidebar, message list, composer, `<markdown>` |
| **native-text** | `bun --hot native-text.tsx` | The three native text components with a tab switcher |
| **counter** | `bun --hot counter.tsx` | The smallest possible app: state, events, hover |
| **menus** | `bun --hot menus.tsx` | Application menus, JS menu actions, explicit quit, and graceful termination |
| **diff** | `bun --hot diff.tsx` | A diff viewer composed from `<div>` and `<text>` in JS, for comparison |
| **web** | `bun run web` from the repository root | The ChatGPT example rendered in a browser canvas with WebGPU |

All of them live in [`examples/`](./examples) and use hardcoded data.

Or download a standalone **chat** build from the [GitHub release](https://github.com/remorses/gpuix/releases). Files are named `example-chat-<target>`. No Bun or Rust install is required.

```bash
chmod +x example-chat-aarch64-apple-darwin
./example-chat-aarch64-apple-darwin
```

macOS may block the unsigned binary the first time. Right-click the file, choose **Open**, and confirm. Windows: download `example-chat-x86_64-pc-windows-msvc.exe` and double-click it.

The web example bundles the same React app and reconciler as the desktop chat
example. wasm-bindgen exposes the mutation interface to the existing retained
tree and `GpuixView`, which run through GPUI's browser platform. Browser event
callbacks are not supported yet.

The web build needs nightly Rust and the matching wasm-bindgen CLI:

```bash
rustup toolchain install nightly --component rust-src --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127 --locked
bun run web
```

The generated Wasm uses shared memory. Production servers must include these
headers on the page, JavaScript, and Wasm responses:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The chat example puts a virtualized `<diff>` and a GFM table inside an assistant
turn, inside a scrolling transcript:

![A diff and a markdown table inside a chat turn](docs/images/chat-diff.png)

Markdown, code and a virtualized diff in one frame:

![Markdown, code and diff rendered together](docs/images/showcase.png)

## Architecture

GPUIX bridges React to GPUI using a **mutation-based protocol**. Desktop apps use napi-rs; browser apps load the same Rust renderer through wasm-bindgen. React's reconciler sends individual DOM-like mutations (`createElement`, `appendChild`, `setStyle`, etc.) directly to Rust, with no JSON tree serialization. Rust maintains a retained element tree that GPUI reads each frame.

```
┌─────────────────────────────────────────────────────────────────┐
│  React (JavaScript)                                             │
│                                                                 │
│  function App() {                                               │
│    const [count, setCount] = useState(0)                        │
│    return (                                                     │
│      <div style={{ display: 'flex', gap: 8 }}>                  │
│        <div onClick={() => setCount(c => c + 1)}>               │
│          Count: {count}                                         │
│        </div>                                                   │
│      </div>                                                     │
│    )                                                            │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                    │ napi desktop / wasm-bindgen browser
                    │ createElement(1, "div")
                    │ appendChild(0, 1)
                    │ setStyle(1, "{...}")
                    │ commitMutations()
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Rust host bridge                                               │
│                                                                 │
│  RetainedTree ── stores elements, styles, event flags           │
│       │                                                         │
│       ▼  each GPUI frame                                        │
│  GpuixView::render() → build_element() → GPUI elements         │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  GPUI                                                           │
│                                                                 │
│  Metal, DirectX, Vulkan, or browser WebGPU / WebGL2              │
│  Flexbox layout via Taffy                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Why This Works

GPUI is an **immediate-mode** UI framework — it rebuilds the entire element tree every frame. Instead of fighting this, GPUIX embraces it:

1. React reconciler detects a state change and calls host mutations (`createElement`, `setStyle`, `appendChild`, etc.)
2. Each mutation updates a **RetainedTree** on the Rust side — a HashMap of element nodes with styles, children, and event flags
3. On each GPUI frame, `GpuixView::render()` walks the RetainedTree and calls `build_element()` to produce ephemeral GPUI elements
4. GPUI lays them out (Taffy flexbox) and renders to the GPU
5. Only **changed elements** cross the FFI boundary — React's reconciler diffs the virtual tree and sends minimal mutations

This is the same protocol React uses for the DOM (`createElement`, `appendChild`, `removeChild`, `commitUpdate`), but targeting a GPU renderer instead of a browser.

## Mutation API

The host surface between JS and Rust is the `NativeRenderer` interface. Desktop uses napi calls and the browser uses wasm-bindgen methods:

```ts
interface NativeRenderer {
  createElement(id: number, elementType: string): void
  destroyElement(id: number): Array<number>
  appendChild(parentId: number, childId: number): void
  removeChild(parentId: number, childId: number): void
  insertBefore(parentId: number, childId: number, beforeId: number): void
  setStyle(id: number, styleJson: string): void
  setText(id: number, content: string): void
  setEventListener(id: number, eventType: string, hasHandler: boolean): void
  setRoot(id: number): void
  commitMutations(): void
}
```

Element IDs are plain numbers generated by an incrementing counter in JS. React may abandon work in concurrent render mode, so GPUIX keeps new host nodes in JS until React places the accepted subtree during commit. Only then are its mutations added to the batch. `commitMutations()` flushes that accepted commit and marks the Rust view dirty for the next frame.

## Event Flow

On desktop, events travel from GPUI back to React through a `ThreadsafeFunction` callback. Browser event callbacks are not connected yet.

```
User clicks element id=3
       │
       ▼
GPUI fires on_click on the element
       │
       ▼
Rust closure calls emit_event_full(callback, 3, "click", {x, y, ...})
       │
       ▼
ThreadsafeFunction queues EventPayload on Node.js event loop
       │
       ▼
JS event registry: eventHandlers.get(3)?.get("click")?.(payload)
       │
       ▼
React handler runs: onClick={() => setCount(c => c + 1)}
       │
       ▼
State update triggers re-render → reconciler sends mutations back to Rust
```

Event handlers are stored in a JS-side registry keyed by `(elementId, eventType)`. Rust only knows **whether** an element has a listener (via `setEventListener`), not the closure itself — the actual handler lives in JS.

## Packages

- **`@gpuix/native`** — Rust bindings to GPUI. It publishes napi-rs desktop binaries and a wasm-bindgen browser build, both backed by `GpuixRenderer`, `RetainedTree`, `build_element()`, and `apply_styles()`.
- **`@gpuix/react`** — React reconciler, event registry, and TypeScript types. Implements the `react-reconciler` host config using the mutation API.

## Building

### Prerequisites

1. Rust toolchain
2. Node.js 18+
3. Xcode with Metal Toolchain (macOS)

```bash
# Install Metal Toolchain if needed
xcodebuild -downloadComponent MetalToolchain

# Install dependencies
bun install

# Check out the pinned GPUI fork
git submodule update --init --recursive

# Build native package
cd packages/native
bun run build

# Build React package
cd ../react
bun run build

# Run example (use tmux for long-running sessions)
cd ../../examples
bun --hot counter.tsx
```

## Usage

```tsx
import React, { useState } from 'react'
import { render } from '@gpuix/react'

function App() {
  const [count, setCount] = useState(0)
  return (
    <div style={{ display: 'flex', gap: 8, padding: 16 }}>
      <div
        style={{ backgroundColor: '#3b82f6', borderRadius: 8, padding: 12, cursor: 'pointer' }}
        onClick={() => setCount(c => c + 1)}
      >
        <div style={{ color: '#ffffff' }}>Count: {count}</div>
      </div>
    </div>
  )
}

render(<App />, {
  title: 'My App',
  width: 800,
  height: 600,
  titlebarTransparent: true,
  windowBackground: 'blurred',
  trafficLightX: 16,
  trafficLightY: 17,
})
```

`render()` creates the native window, mounts React, and starts the frame loop.
The red traffic-light button terminates the renderer, unmounts React, runs
`onTerminated` cleanup, and then exits the process.

| Option | Values | Purpose |
|---|---|---|
| `titlebarTransparent` | boolean | Hide the native titlebar so the app draws chrome under the traffic lights |
| `windowBackground` | `"opaque"` (default), `"transparent"`, `"blurred"` | Window fill. `"blurred"` is the macOS vibrancy backdrop |
| `trafficLightX` / `trafficLightY` | pixels | Traffic-light origin. Waku uses `(16, 17)` |
| `transparent` | boolean | Same as `windowBackground: "transparent"` when that option is unset |
Call it again after a save and it remounts the tree on the same window.

Use **`render()`**, not `createRenderer()`, in the app entry. `bun --hot`
re-runs the whole file on save. `createRenderer()` plus `init()` would then
build a second host. `render()` is idempotent: the first call owns the window,
later calls only remount React.

`createRenderer()`, `createRoot()`, and `startFrameLoop()` stay public for
tests and custom hosts. Pass `{ renderer }` into `render()` when you already
have one.

## Application menus and termination

Every desktop app gets a minimal application menu with **Quit** and Cmd+Q. Pass
`menus: []` to opt out, or replace it with a cross-platform menu tree. A menu
action's stable `id` reaches `onMenuAction` exactly once:

```tsx
render(<App />, {
  title: 'My App',
  menus: [
    {
      name: 'My App',
      items: [
        { kind: 'action', id: 'preferences', label: 'Preferences…', keyEquivalent: 'cmd-,' },
        { kind: 'separator' },
        { kind: 'system', label: 'Services', systemMenu: 'services' },
        { kind: 'separator' },
        { kind: 'action', label: 'Quit My App', role: 'quit', keyEquivalent: 'cmd-q' },
      ],
    },
  ],
  onMenuAction: ({ id }) => console.log('menu action', id),
  onTerminated: async () => {
    await closeServer()
  },
})
```

`kind` is `"action"`, `"separator"`, `"submenu"`, or `"system"`. Action
items support `checked`, `disabled`, `keyEquivalent`, and the native editing
roles `cut`, `copy`, `paste`, `selectAll`, `undo`, and `redo` through
`osAction`. Submenus carry their own `label` and `items`.

Call `renderer.setMenus(menus)` to replace the tree after launch, and
`renderer.quit()` to use GPUI's graceful platform quit path without a menu.
Menu Quit, explicit quit, and last-window close all stop the frame loop and run
`onTerminated` once. The renderer waits for that cleanup before exiting; a
cleanup or unmount failure exits with status 1 instead of leaving the process
or native window alive.

The frame loop contains individual native tick failures and reschedules. Three
consecutive failures are treated as unrecoverable: GPUIX quits the native app
instead of leaving a mapped window without an AppKit pump. `render()` also
guards uncaught exceptions and unhandled rejections, unmounts React, quits the
window synchronously, runs `onTerminated`, and then exits with status 1.

Run the human menu check on macOS:

```bash
cd examples
bun --hot menus.tsx
```

Enter fullscreen, choose **Actions → Fire JavaScript Action**, confirm the
window and terminal log update once, then press Cmd+Q. The terminal should print
`termination cleanup finished` and return to the shell.

## Debug frame overlay

GPUI paints frame-time stats into the window after layout. The overlay is not
a React element. A React FPS label would update every frame and cause more work.

```tsx
render(<App />, { title: 'My App', debugFrameOverlay: 'full' })
```

| Mode | What you see |
|---|---|
| `hidden` | nothing (default) |
| `minimal` | last draw time, e.g. `8.3 MS` |
| `full` | `CUR`, `1%`, `10%`, `MAX`, `FRAMES` |

Or call the renderer:

```ts
renderer.setDebugFrameOverlay('full')
renderer.cycleDebugFrameOverlay()
renderer.resetDebugFrameOverlayStats()
renderer.getDebugFrameOverlay() // 'hidden' | 'minimal' | 'full'
renderer.getDebugFrameOverlayStats()
// { currentMs, p90Ms, p99Ms, maxMs, frames, samples }
```

`p90Ms` is the overlay **10%** line. `p99Ms` is the **1%** line. Those are the slow tail.

The overlay shows **draw time**, not FPS. `8.3 MS` is about 120 Hz.

The chat example has a regression test for this: `examples/chat.perf.test.tsx`. It times mount, wheel draw, and sidebar clicks. It asserts p95, not every frame.

The default example suite excludes this hardware-timing test so shared CI runner variance does not fail functional checks. Run it explicitly on the target Mac:

On macOS, `THROTTLE=utility` restarts the process under `taskpolicy -c utility`. That pins work to E-cores. It is an **M1/M2 Air CPU** proxy, not Chrome 6x. GPU and RAM stay fast. `THROTTLE=background` is slower.

```bash
cd examples
THROTTLE=utility bun run test:perf
THROTTLE=utility bun --hot chat.tsx
```

## Hot reload

### 1. End the file with `render()`

```tsx
import { render } from '@gpuix/react'

function App() {
  return <div style={{ padding: 16 }}>hello</div>
}

render(<App />, { title: 'My App', width: 800, height: 600 })
```

Do **not** call `createRenderer()` or `init()` in this file. `bun --hot` re-runs
the whole entry on save. A second `init()` would open a second window.

### 2. Start the app with `bun --hot`

Prefer **`bun --hot`** over a plain `bun` or `tsx` run. Without `--hot`, a
save starts a second process. With it, `render()` remounts React on the same
window.

```bash
bun --hot app.tsx
cd examples && bun --hot chat.tsx
```

### 3. Save the file

```
save .tsx  ►  bun re-evaluates the entry  ►  render() remounts React
                     │
                     ▼
              GpuixRenderer, window, GPU stay
```

The first `render()` creates the native host and stores it on `globalThis`.
Each save unmounts the React tree and mounts a new one on that same host.

**Stays:** window, GPU device, native `.node` addon, GPUI scroll physics.

**Resets:** `useState`, focus, React event handlers.

This is a remount, not React Refresh. Keeping hook state needs Bun to inject
`$RefreshReg$` during `--hot`. That transform exists on
`bun build --react-fast-refresh` only. Tracked in
[oven-sh/bun#40179](https://github.com/oven-sh/bun/issues/40179).

Native `.node` edits still need a rebuild. See [Developing the Rust side](#developing-the-rust-side).

On **macOS**, `startFrameLoop` calls `renderer.tick()` at a fixed rate (~125fps by
default). This pumps AppKit on the process main thread without blocking Node. Pass
`{ frameMs }` to change the rate, and call `.stop()` on the returned handle to end it.
One thrown tick is reported and retried; repeated failures quit instead of
abandoning the native window.

On **Windows and Linux**, GPUI runs its normal blocking native event loop on one
dedicated Rust UI thread. Node sends in-process commands to that thread, so
`startFrameLoop` returns a no-op handle and does not create a JavaScript timer.
All platforms use GPUI's native platform, window, renderer, input, scroll,
clipboard, keyboard, and IME implementations. The embedded macOS run-loop
extension comes from the pinned GPUIX fork. Windows runtime validation is pending.

> [!IMPORTANT]
> On macOS, never drive `tick()` from a `setImmediate` loop. That spins at tens of thousands of
> ticks per second and burns **73% CPU on a completely idle app**, versus **1%** when
> paced.

## Native animations

Use **`motion.div`** to animate from an initial style to a target style. React
sends the target once. Rust calculates intermediate values and requests GPUI
frames until the transition finishes, without a React render or N-API call for
each frame.

### Animate a target

```tsx
import { motion } from '@gpuix/react'

function WelcomeCard() {
  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 320, opacity: 1 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{ overflow: 'hidden' }}
    >
      <text style={{ color: '#ffffff' }}>Welcome</text>
    </motion.div>
  )
}
```

Set **`initial={false}`** when the element must mount at its first `animate`
target. Later `animate` changes still transition normally. If a target changes
while motion is active, the next transition starts from the current visible
value, so reversing an animation does not jump.

### Targets and timing

Motion currently accepts these **numeric targets**:

| Target | Range or unit |
|---|---|
| `width`, `height` | pixels, zero or greater |
| `top`, `right`, `bottom`, `left` | pixels |
| `opacity` | `0` through `1` |
| `borderRadius` | pixels, zero or greater |

The **transition** uses seconds, like Motion for React:

| Option | Default | Values |
|---|---:|---|
| `duration` | `0.3` | Non-negative seconds |
| `delay` | `0` | Non-negative seconds |
| `ease` | `"easeOut"` | `"linear"`, `"ease"`, `"easeIn"`, `"easeOut"`, `"easeInOut"`, or `[x1, y1, x2, y2]` |

Springs, keyframes, variants, exit transitions, and shared layout animations
are not available yet.

### Animate a sidebar

Animate an **outer clipping container** and keep the inner sidebar at a fixed
width. This reveals or hides the content without reflowing its text on every
frame.

```tsx
import { motion } from '@gpuix/react'
import type { ReactNode } from 'react'

function SidebarFrame({
  collapsed,
  children,
}: {
  collapsed: boolean
  children: ReactNode
}) {
  const sidebarWidth = 252
  const dividerWidth = 1

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 0 : sidebarWidth + dividerWidth }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ width: sidebarWidth, height: '100%', flexShrink: 0 }}>
        {children}
      </div>
      <div style={{ width: dividerWidth, height: '100%', flexShrink: 0 }} />
    </motion.div>
  )
}
```

The **chat example** uses this pattern. The sidebar remains mounted while its
outer width moves between `253` and `0` pixels.

### Capture exact frames

The [automation API](#automation) can freeze the native motion clock and render
specific timestamps. This avoids timer sleeps and gives CI the same frames on
every run.

```tsx
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot } from '@gpuix/react/testing'
import { ChatApp } from './chat'

const { render, renderer } = createTestRoot()
render(<ChatApp />)
const app = await connectTest(renderer)

const startedAt = await app.clock.pause()
await app.getByTestId('sidebar-collapse').click()

await app.captureFrames('review/sidebar', [
  startedAt,
  startedAt + 50,
  startedAt + 100,
  startedAt + 150,
  startedAt + 200,
])

await app.clock.resume()
```

## Scrolling

Containers with `overflow: "scroll"` become natively scrollable. GPUI handles scroll physics, clipping, and offset persistence automatically.

Plain scroll containers still build every child. Use `<virtual-list>` below when the collection can grow large.

> [!IMPORTANT]
> **Nested scrolling is not supported.** One parent may scroll. An inner
> `overflow: "scroll"`, `<virtual-list>`, or `<diff>` must not. GPUI gives both
> hitboxes the same wheel event, so the inner list steals the gesture.
>
> Keep long inner content in that parent. Collapse it behind an **expandable**
> (preview plus Show more) instead of giving the child its own viewport.
>
> Horizontal overflow is the exception. `overflowX: "scroll"` on a wide child
> (a code row, a table) does not steal the vertical wheel. GPUIX lays that
> scroller out as a flex viewport with `minWidth: 0`. The wide child must not
> shrink: set `flexShrink: 0` or a definite width. Swipe on **X** to pan.
> A vertical wheel stays on the parent.

```tsx
function Expandable({
  preview,
  children,
}: {
  preview: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {open ? children : preview}
      {!open && <div onClick={() => setOpen(true)}>Show more</div>}
    </div>
  )
}
```

```tsx
function ScrollableList() {
  return (
    <div style={{ height: 300, overflow: 'scroll' }}>
      {items.map((item, i) => (
        <div key={i} style={{ height: 60, padding: 12 }}>
          {item.name}
        </div>
      ))}
    </div>
  )
}
```

Per-axis scrolling: use `overflowX: "scroll"` or `overflowY: "scroll"`.

For programmatic scroll control, use a React ref to get the element's numeric ID, then call the renderer's scroll methods:

```tsx
function ProgrammaticScroll() {
  const listRef = useRef<any>(null)

  const jumpToBottom = () => {
    if (listRef.current) {
      renderer.scrollTo(listRef.current.id, 0, -999)
    }
  }

  return (
    <>
      <div ref={listRef} style={{ height: 200, overflow: 'scroll' }}>
        {items.map((item, i) => <div key={i}>{item}</div>)}
      </div>
      <div onClick={jumpToBottom}>Jump to bottom</div>
    </>
  )
}

// Available scroll methods on the renderer:
renderer.scrollTo(elementId, x, y)        // set offset directly
renderer.scrollToItem(elementId, index)   // scroll child into view
renderer.getScrollOffset(elementId)       // returns [x, y] or null
```

## Virtual lists

Use `VirtualList` for **long, variable-height collections** such as message lists. It mounts only the active React window while native GPUI builds, lays out, and paints rows near the viewport.

```tsx
import { VirtualList } from '@gpuix/react'

function MessageList({ messages }: { messages: Message[] }) {
  return (
    <VirtualList
      itemCount={messages.length}
      alignment="bottom"
      followTail
      estimatedItemHeight={180}
      style={{ flexGrow: 1, minHeight: 0 }}
      renderItem={(index) => (
        <Message key={messages[index].id} message={messages[index]} />
      )}
    />
  )
}
```

The list needs a **bounded height** or bounded flex space. `renderItem` must return one host root for each row; that root can contain any GPUIX host or custom element.

| Prop | Default | Purpose |
|---|---:|---|
| `alignment` | `"top"` | Use `"bottom"` for chat-style initial positioning |
| `followTail` | `false` | Follow appended rows until the user scrolls away |
| `overdraw` | `240` | Extra pixels mounted and built outside the viewport |
| `estimatedItemHeight` | `48` | Gives unmeasured rows an initial height estimate |

### How virtualization works

`VirtualList` keeps the logical count in native state while React and Rust retain only the mounted window. The lower-level `<virtual-list>` host still accepts a complete keyed child list and defers only GPUI element construction, layout, and paint.

```text
React Fiber + Rust RetainedTree    mounted row window
                 │
                 ▼
          GPUI ListState          full row count and measured height cache
                 │
                 ▼ visible indexes plus overdraw
          cx.processor            re-enters GpuixView after root render
                 │
                 ▼
          fresh BuildCtx          builds only the requested React subtree
                 │
                 ▼
       GPUI layout and paint      visible rows only
```

GPUI measures a row when it enters the viewport. `estimatedItemHeight` gives unseen rows an approximate height so the scrollbar is useful before every row has been visited. The measured height replaces the estimate automatically.

When a retained descendant changes, GPUIX marks its direct row for remeasurement. Appending, removing, or reordering keyed rows keeps measurements for rows whose IDs did not change.

### Row boundaries

`VirtualList.renderItem` must return one host root with a stable key. At the lower level, each **immediate child** of `<virtual-list>` is one virtual row:

```tsx
<virtual-list style={{ height: 500 }}>
  {messages.map((message) => (
    <div key={message.id} style={{ paddingBottom: 24 }}>
      <Message message={message} />
    </div>
  ))}
</virtual-list>
```

In development, a direct host list with one immediate child fails unless
`itemCount={1}` makes that one-row intent explicit. A wrapper around an entire
collection is one row and defeats virtualization. Prefer `VirtualList` with
`itemCount` and `renderItem` for windowed data.

Direct host usage also defaults `estimatedItemHeight` to `48`. Pass
`estimatedItemHeight={null}` only when content-discovery sizing is intentional;
unvisited rows then contribute no estimate to the initial scroll extent.

A row can contain nested `<div>`, `<text>`, `<markdown>`, `<code>`, `<diff>`, `<input>`, and `<textarea>` elements. Focusable rows stay active when they move offscreen, so keyboard input and native editor state are preserved. Those children must not scroll. Nested scrolling is not supported; see [Scrolling](#scrolling).

### Chat tail behavior

Combine `alignment="bottom"` and `followTail` for a chat thread:

```tsx
<VirtualList
  itemCount={turns.length}
  alignment="bottom"
  followTail
  estimatedItemHeight={220}
  style={{ flexGrow: 1, minHeight: 0 }}
  renderItem={(index) => (
    <ChatTurn key={turns[index].id} turn={turns[index]} />
  )}
/>
```

The list follows new rows while the user is at the bottom. Scrolling upward pauses tail following. Returning to the bottom enables it again. A streaming final row is remeasured as its content grows.

### Programmatic scrolling

Use a ref to call the same renderer scroll methods as a plain scroll container:

```tsx
function Results({ rows }: { rows: Result[] }) {
  const renderer = useGpuixRequired()
  const listRef = useRef<{ id: number } | null>(null)

  const reveal = (index: number) => {
    if (listRef.current) {
      renderer.scrollToItem?.(listRef.current.id, index)
    }
  }

  return (
    <>
      <VirtualList
        ref={listRef}
        itemCount={rows.length}
        style={{ height: 400 }}
        renderItem={(index) => (
          <ResultRow key={rows[index].id} row={rows[index]} />
        )}
      />
      <div onClick={() => reveal(rows.length - 1)}>Reveal latest</div>
    </>
  )
}
```

`scrollTo`, `scrollToItem`, and `getScrollOffset` all support virtual lists.

### Performance model

| Work | Plain scroll container | `<virtual-list>` children | `VirtualList` + `itemCount` |
|---|---|---|---|
| React Fiber nodes | All rows | All rows | Visible window |
| Rust retained nodes | All rows | All rows | Visible window |
| GPUI row construction | All rows | Visible rows plus overdraw | Visible rows plus overdraw |
| Layout and paint | All rows | Visible rows plus overdraw | Visible rows plus overdraw |
| Height metadata | None | One lightweight entry per row | One lightweight entry per logical row |

`VirtualList` with `itemCount` and `renderItem` mounts only the visible window. Use that for long transcripts. A 10,000-row `turns.map` still creates every React child. Collections with millions of rows still need application-level paging or a data-owning native element.

### Keep scroll fast

A wheel event notifies the window view. GPUI then rebuilds the **visible**
rows and Taffy lays them out again. Draw time is the cost of those rows, not
the length of the list.

Put a long list on `<virtual-list>`. Keep `overdraw` near one extra
viewport. Put fat content in one native node (`<markdown>`, `<code>`, `<diff>`),
not a tree of React spans.

The host `<virtual-list>` still retains every React child. Pass `itemCount`
and `renderItem` through `VirtualList` so mount only creates the window.

```tsx
import { VirtualList } from '@gpuix/react'

const Transcript = memo(function Transcript({ turns }: { turns: Turn[] }) {
  return (
    <VirtualList
      itemCount={turns.length}
      estimatedItemHeight={220}
      style={{ flexGrow: 1, minHeight: 0 }}
      renderItem={(index) => <ChatTurn key={turns[index].id} turn={turns[index]} />}
    />
  )
})

function ChatApp() {
  const [collapsed, setCollapsed] = useState(false)
  const [turns, setTurns] = useState(initialTurns)
  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: '100%' }}>
      <Sidebar collapsed={collapsed} onCollapse={() => setCollapsed(true)} />
      <Transcript turns={turns} />
      <Composer onSend={(text) => setTurns((current) => [...current, { text }])} />
    </div>
  )
}
```

`turns` is a new array only when a message arrives. Sidebar and draft updates
leave that reference alone, so `memo` skips the map. The chat example uses
this pattern.

`overflowX: "scroll"` on a wide child must not steal the vertical wheel.
GPUIX sets `restrict_scroll_to_axis` on that path. Native
`overflow_x_scroll()` must call the same method.

Turn on `debugFrameOverlay: 'full'` while you scroll. The overlay is **draw
time**. `8.3 MS` is about 120 Hz.

## Text input

`<input>` and `<textarea>` use GPUI's platform input handler. They support a
native caret, text selection, IME composition, clipboard actions, undo/redo,
grapheme-safe deletion and mouse positioning.

```tsx
<textarea
  value={draft}
  placeholder="Ask anything"
  minRows={1}
  maxRows={8}
  onChange={(event) => setDraft(event.value ?? '')}
  onSubmit={send}
/>
```

`Enter` emits `onSubmit`. In a `<textarea>`, `Shift+Enter` inserts a newline.
The editor updates natively first, then reports the complete value to React.
`value` changes can replace the native content, but keeping the same prop value
does not reject an edit like a browser-controlled input.

The focused caret stays solid during edits and then blinks every 500ms while
idle. It stops scheduling repaint frames on blur or while the window is
inactive. Override its colour through the shared native theme:

```tsx
<input theme={{ caret: '#22c55e' }} />
```

## Focus and keyboard navigation

Focus is a **native GPUI concept**. GPUIX connects stable React element IDs to
persistent `gpui::FocusHandle` values, so focus survives React rerenders:

```text
React <div tabIndex={0}>
            │
            ▼
Retained element ID ► persistent gpui::FocusHandle ► keyboard/action dispatch
            ▲
            │
      React rerenders
```

Inputs and textareas join the normal tab order automatically. Add `tabIndex` to
a `div` when it should receive keyboard focus:

```tsx
<div
  tabIndex={0}
  onFocus={() => setActive(true)}
  onBlur={() => setActive(false)}
  onKeyDown={(event) => {
    if (event.key === 'enter') submit()
  }}
>
  Submit
</div>
```

| Prop | Behavior |
|---|---|
| `tabIndex={0}` | Joins the normal Tab order |
| `tabIndex={n}` | Uses `n` as its GPUI tab-order index |
| `tabIndex={-1}` | Skipped by Tab, but focusable by click or renderer API |
| `autoFocus` | Takes focus once, when its native focus handle is created |

`Tab` calls GPUI's `window.focus_next()`. `Shift+Tab` calls
`window.focus_prev()`. This navigation stays in Rust and does not make a
JavaScript round trip.

Use a ref for imperative focus:

```tsx
const buttonRef = useRef<{ id: number }>(null)

function focusButton() {
  if (buttonRef.current) renderer.focusElement(buttonRef.current.id)
}

<div ref={buttonRef} tabIndex={-1}>Focused on demand</div>
```

Adding `onKeyDown`, `onKeyUp`, `onFocus`, or `onBlur` creates a persistent focus
handle. Add `tabIndex` as well when the element must be reachable with Tab.
Removing `tabIndex` removes the element from the tab order.

## Headless controls

The built-in controls are **unstyled primitives**, not a fixed component
library. Use them like Radix primitives in shadcn: import a primitive namespace,
wrap and style it in a local file, then import those local components throughout
the app.

```text
@gpuix/react/select ► components/ui/select.tsx ► application screens
  native behavior       local styles/variants       product-specific use
```

Each primitive has a dedicated namespace entry point:

| Import | Main parts |
|---|---|
| `@gpuix/react/select` | `Root`, `Trigger`, `Value`, `Content`, `Item` |
| `@gpuix/react/combobox` | `Root`, `Input`, `Content`, `List`, `Item`, `Empty` |
| `@gpuix/react/tooltip` | `Provider`, `Root`, `Trigger`, `Content` |

### Build a local Select

Create `components/ui/select.tsx`. This file is application code, so it can be
copied and changed without waiting for GPUIX to add a theme option:

```tsx
import * as React from 'react'
import * as SelectPrimitive from '@gpuix/react/select'

export const Select = SelectPrimitive.Root
export const SelectValue = SelectPrimitive.Value
export const SelectGroup = SelectPrimitive.Group

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  SelectPrimitive.SelectTriggerProps
>(({ style, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    {...props}
    style={(state) => ({
      width: 220,
      height: 36,
      padding: 8,
      backgroundColor: state.open ? '#334155' : '#1e293b',
      borderRadius: 8,
      ...(typeof style === 'function' ? style(state) : style),
    })}
  />
))

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  SelectPrimitive.SelectContentProps
>(({ style, ...props }, ref) => (
  <SelectPrimitive.Content
    ref={ref}
    sideOffset={6}
    {...props}
    style={{
      width: 220,
      maxHeight: 240,
      overflowY: 'scroll',
      padding: 4,
      backgroundColor: '#0f172a',
      borderRadius: 8,
      ...style,
    }}
  />
))

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  SelectPrimitive.SelectItemProps
>(({ style, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    {...props}
    style={(state) => ({
      padding: 8,
      opacity: state.disabled ? 0.4 : 1,
      backgroundColor: state.highlighted
        ? '#334155'
        : state.selected
          ? '#1e3a5f'
          : '#0f172a',
      ...(typeof style === 'function' ? style(state) : style),
    })}
  />
))
```

Use the styled local file with the familiar shadcn shape:

```tsx
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select'

<Select value={model} onValueChange={setModel}>
  <SelectTrigger>
    <SelectValue placeholder="Select a model" />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectItem value="sonnet">Sonnet</SelectItem>
      <SelectItem value="opus">Opus</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>
```

The trigger participates in normal tab navigation. Opening the Select focuses
its content. `Up`, `Down`, `Ctrl+P`, `Ctrl+N`, `Enter`, and `Escape` control the
menu. Closing it restores focus to the trigger. Disabled items are skipped.

### Style Combobox and Tooltip the same way

Start their local files from namespace imports too:

```tsx
// components/ui/combobox.tsx
import * as ComboboxPrimitive from '@gpuix/react/combobox'

// components/ui/tooltip.tsx
import * as TooltipPrimitive from '@gpuix/react/tooltip'
```

The application still uses compound components, not one large configuration
object:

```tsx
<ComboboxPrimitive.Root items={['Next.js', 'SvelteKit', 'Astro']}>
  <ComboboxPrimitive.Input style={{ width: 220, height: 36, padding: 8 }} />
  <ComboboxPrimitive.Content style={{ width: 220 }}>
    <ComboboxPrimitive.Empty>No frameworks found.</ComboboxPrimitive.Empty>
    <ComboboxPrimitive.List>
      {(item) => (
        <ComboboxPrimitive.Item key={item} value={item}>
          {item}
        </ComboboxPrimitive.Item>
      )}
    </ComboboxPrimitive.List>
  </ComboboxPrimitive.Content>
</ComboboxPrimitive.Root>
```

```tsx
<TooltipPrimitive.Provider delayDuration={350}>
  <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>
      <div tabIndex={0} style={{ padding: 8 }}>Copy</div>
    </TooltipPrimitive.Trigger>
    <TooltipPrimitive.Content side="top" sideOffset={6}>
      Copy message
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Root>
</TooltipPrimitive.Provider>
```

Combobox uses the native input for text editing, IME, clipboard, and focus.
Tooltip `asChild` preserves the child ref and merges trigger behavior into that
host element. All floating content uses GPUI's deferred `anchored()` layer,
snaps inside the window, and occludes controls behind it.

### Overlay menus

Menus, tooltips, and dialogs must use **`SelectContent`**, **`ComboboxContent`**,
or `<anchored deferred>`. Those paint in a later pass, on top of
`<virtual-list>` and the rest of the page.

A `position: "absolute"` card that overflows out of the composer sits **under**
the virtual list. The list paints after the composer, so you still see the
markdown through the menu, and clicks hit the text behind it.

```tsx
<Select value={model} onValueChange={setModel}>
  <div style={{ position: 'relative' }}>
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
    <SelectContent side="top" sideOffset={4} style={{ backgroundColor: '#232323' }}>
      <SelectItem value="flash">DeepSeek V4 Flash</SelectItem>
    </SelectContent>
  </div>
</Select>
```

Give every overlay an **opaque** fill (`#232323`, not `#23232399`).
`FloatingLayer` defaults to `#1A1A1A`. Item rows should use the same solid
color, or a solid hover color. A `#00000000` child on a blurred window punches
through Metal to the desktop.

A filled in-flow `div` blocks clicks and hovers behind it. The parent
scroller still gets the wheel. `position: "absolute"` / `"fixed"` or
`pointerEvents: "auto"` also steals the wheel. Set `pointerEvents: "none"`
to pass hits through.

## Text selection

Every text GPUIX paints is **selectable and copyable**, including text inside
`<code>`, `<diff>` and `<markdown>`. A drag that starts in a heading and ends
inside a fenced code block selects everything between; Cmd+C copies it joined in
document order.

There is nothing to opt into. To opt *out* — toolbars, buttons, line-number
gutters — set `userSelect: "none"`, which inherits like the CSS property:

```tsx
<div style={{ userSelect: 'none' }}>
  <text>toolbar label, never selected</text>
</div>
```

![Text selected across markdown blocks](docs/images/selection.png)

Read the selection from the renderer:

```tsx
renderer.getSelectedText()   // joined text, or null
renderer.clearSelection()
```

Selection works because each painted text element registers itself into a
per-frame registry in **paint order**, which is document order. A drag anchored
in one element resolves against that registry into per-element spans: partial in
the anchor and head, whole for everything between.

<details>
<summary>Why not one big text element, like Zed?</summary>

Zed's markdown selects continuously because its whole document is a single
element over one text model. GPUIX renders a *tree* of text elements, so it
rebuilds that continuity at paint time instead. The mechanism is ported from
[Comet](https://github.com/zeronsh/comet) (MIT), which faced the same problem.
</details>

## Native text components

Three elements render text with Syntect syntax highlighting computed in
Rust. Colours come from a theme prop, so a late-arriving highlight recolours runs
without ever changing layout.

### `<code>`

A syntax-highlighted code block. One row per line at an exact line height, so the
block's height is known before highlighting runs.

```tsx
<code
  code={source}
  language="typescript"        // or path="src/app.ts" to detect from extension
  showLineNumbers
  showHeader={false}
/>
```

![A syntax-highlighted code block](docs/images/code.png)

### `<diff>`

A unified diff viewer. It **flows** with its parent by default, so a parent
list can be the only scroller. Collapsing a file removes its rows rather than hiding
them, so a collapsed 10k-line file costs one row.

Use `maxLines` to keep a long patch short. Show more fires `onShowMore`. Clear
`maxLines` in that handler to reveal the rest.

Pass `scroll` and a **bounded height** only for a dedicated full-window viewer.
That path uses GPUI's `list()` and virtualizes. Do not nest it inside another
scroller. See [Scrolling](#scrolling).

```tsx
<diff
  patch={unifiedPatch}
  wordDiff                     // highlight only the tokens that changed
  maxLines={open ? undefined : 24}
  collapsedPaths={['pnpm-lock.yaml']}
  onShowMore={() => setOpen(true)}
  onToggleFile={(e) => toggle(e.value)}
  onLineClick={(e) => console.log(e.oldLine, e.newLine, e.value)}
/>
```

![A unified diff with word-level highlights](docs/images/diff.png)

### `<markdown>`

GitHub-flavoured markdown: headings, lists, tables, block quotes, fenced code,
strikethrough, task lists, and autolinked bare URLs.

```tsx
<markdown source={readme} onLinkClick={(e) => open(e.value)} />
```

![Markdown with headings, lists, a table and a code fence](docs/images/markdown.png)

### Theming

All three take the same optional `theme` prop. Every field layers on top of the
built-in dark theme, so overriding one token leaves the rest alone.

```tsx
<code
  code={source}
  language="rust"
  theme={{
    appearance: 'dark',        // or 'light'
    accent: '#7c86ff',
    syntax: { keyword: '#f38ba8', string: '#a6e3a1' },
  }}
/>
```

**Layout numbers live in the theme too**, under `metrics`. Row heights, gutter
widths, paddings and the heading scale are props, not Rust constants, so tuning
the design is a React re-render and never a native rebuild.

```tsx
<diff
  patch={patch}
  theme={{
    metrics: {
      diffLineHeight: 26,
      diffGutterWidth: 48,
      mdHeadingSizes: [24, 19, 16, 14],
    },
  }}
/>
```

When `scroll` is on, `<diff>` virtualizes from these numbers without measuring,
so changing `diffLineHeight` also re-sizes the scroll model.

The same three components, retuned entirely from `metrics` with no rebuild:

![The components with enlarged metrics](docs/images/metrics.png)

Languages bundled: Rust, TypeScript, TSX, JavaScript, JSX, Python, Go, JSON,
Bash, TOML, YAML, Markdown, HTML, CSS, C.

## Supported Elements

| Element         | Description                                      |
|-----------------|--------------------------------------------------|
| `div`           | Container with flexbox layout                    |
| `text`          | Text content, selectable                         |
| `code`          | Syntax-highlighted code block                    |
| `diff`          | Unified diff viewer. Flows by default            |
| `markdown`      | GitHub-flavoured markdown                        |
| `input`         | Native single-line text editor                   |
| `textarea`      | Native multiline, auto-growing text editor       |
| `virtual-list`  | Long collections; only visible rows are built    |
| `img`           | Local raster or SVG images                       |
| `svg`           | Tintable monochrome SVG icons from source or disk |
| `anchored`      | Positioned overlay                               |
| `canvas`        | Custom drawing (planned)                         |

## Images and icons

`<img>` takes a **filesystem path**, not a URL. Resolve the file with
`fileURLToPath` or `path.join` and pass that string as `src`.

### `<img>`

`<img>` paints through GPUI's image element. It loads **PNG, JPEG, WebP, GIF,
and SVG** from disk. SVG here is a full-colour image, not a tintable icon.

```tsx
<img
  src={fileURLToPath(new URL('./photo.png', import.meta.url))}
  objectFit="cover"
  style={{ width: 240, height: 140, borderRadius: 12 }}
/>
```

`objectFit` matches CSS: `"contain"` (default), `"cover"`, `"fill"`,
`"scaleDown"`, or `"none"`. An empty `src` or a failed load shows a fallback
placeholder instead of crashing.

### `<svg>`

`<svg>` uses GPUI's **monochrome icon renderer**. Raw `source` works on desktop
and in the browser. Desktop apps can also use a local `src` path. The icon is
drawn as one shape and tinted with `style.color`.

For application icons, prefer **raw SVG source**. It works with both GPUIX
targets and lets a bundler embed each icon in the JavaScript bundle. Use `src`
only for a desktop app that intentionally ships loose asset files.

`src` is a filesystem path **or** a `data:image/svg+xml,…` URL. Vitest and some
Bun `import … with { type: 'file' }` bindings emit the data URL. GPUIX decodes
both.

`style.color` is required. Without it the icon does not paint. Prefer
`fill="#000"` or `stroke="#000"` in the file. `currentColor` in the SVG is not
the same as `style.color`.

#### Bun

Use Bun's [`text` loader](https://bun.sh/docs/bundler/loaders#text). The import
is a string containing the complete SVG, and `bun build` embeds it in the
bundle.

```tsx
import searchSvg from './assets/icons/search.svg' with { type: 'text' }

<svg
  source={searchSvg}
  style={{ width: 16, height: 16, color: '#b4b4b4' }}
/>
```

The chat example builds every sidebar and composer icon from raw SVG source this
way.

#### Node.js

For supported Node.js releases, read the icon once relative to the module. A
`URL` keeps the path correct across operating systems and avoids `__dirname`.

```tsx
import { readFileSync } from 'node:fs'

const searchSvg = readFileSync(
  new URL('./assets/icons/search.svg', import.meta.url),
  'utf8',
)

<svg
  source={searchSvg}
  style={{ width: 16, height: 16, color: '#b4b4b4' }}
/>
```

Node.js also has [text modules](https://nodejs.org/api/esm.html#text-modules),
but they currently require `--experimental-import-text`. Prefer
[`readFileSync`](https://nodejs.org/api/fs.html#fsreadfilesyncpath-options) until
text imports no longer need a runtime flag.

## Supported Events

| Event | Props | Payload fields |
|-------|-------|----------------|
| Click | `onClick` | `x`, `y`, `clickCount`, `isRightClick`, `modifiers` |
| Mouse down | `onMouseDown` | `x`, `y`, `button`, `clickCount`, `modifiers` |
| Mouse up | `onMouseUp` | `x`, `y`, `button`, `clickCount`, `modifiers` |
| Mouse enter | `onMouseEnter` | `hovered` |
| Mouse leave | `onMouseLeave` | `hovered` |
| Mouse move | `onMouseMove` | `x`, `y`, `pressedButton`, `modifiers` |
| Click outside | `onMouseDownOutside` | `x`, `y`, `button`, `modifiers` |
| Key down | `onKeyDown` | `key`, `keyChar`, `isHeld`, `modifiers` |
| Key up | `onKeyUp` | `key`, `keyChar`, `modifiers` |
| Focus | `onFocus` | — |
| Blur | `onBlur` | — |
| Scroll | `onScroll` | `deltaX`, `deltaY`, `precise`, `touchPhase`, `modifiers` |
| Change | `onChange` | `value` — `<input>` and `<textarea>` only |
| Submit | `onSubmit` | `value` — `<input>` and `<textarea>` only |
| Toggle file | `onToggleFile` | `value` (file path) — `<diff>` only |
| Show more | `onShowMore` | `value` (hidden line count) — `<diff>` only |
| Line click | `onLineClick` | `value`, `oldLine`, `newLine` — `<diff>` only |
| Link click | `onLinkClick` | `value` (URL) — `<markdown>` only |

Keyboard and focus listeners create a persistent GPUI `FocusHandle`
automatically. A listener alone does not put a `div` in the Tab order; add
`tabIndex={0}` for that. Inputs and textareas already use tab index `0`.

## Supported Styles

CSS-like styling via the `style` prop:

```tsx
<div style={{
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 16,
  backgroundColor: '#3b82f6',
  borderRadius: 8,
}}>
  <div style={{ color: '#ffffff', fontSize: 18 }}>
    Hello GPUI!
  </div>
</div>
```

**Layout:** `display` (`"flex"` | `"grid"`), `flexDirection`, `flexWrap`, `flexGrow`, `flexShrink`, `flexBasis`, `alignItems`, `alignSelf`, `alignContent`, `justifyContent`, `gap`, `rowGap`, `columnGap`, `gridTemplateColumns`, `gridTemplateRows`, `gridColumnMin`, `gridRowMin`

**Sizing:** `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight` — accepts pixels (number) or percentages (string like `"100%"`)

**Spacing:** `padding`, `paddingTop/Right/Bottom/Left`, `margin`, `marginTop/Right/Bottom/Left`

**Position:** `position` (`"relative"` | `"absolute"`), `top`, `right`, `bottom`, `left`

**Visual:** `background`, `backgroundColor`, `color`, `opacity`, `cursor`, `pointerEvents`, `borderRadius`, `borderTopLeftRadius`, `borderTopRightRadius`, `borderBottomLeftRadius`, `borderBottomRightRadius`, `borderWidth`, `borderTopWidth`, `borderRightWidth`, `borderBottomWidth`, `borderLeftWidth`, `borderColor`, `boxShadow`, `outlineColor`, `outlineWidth`, `outlineOffset`

`background` accepts a solid color, a CSS `linear-gradient()` with two through
eight stops, or a structured native gradient:

```tsx
<div style={{
  background: {
    type: 'linearGradient',
    angle: 90,
    colorSpace: 'oklab',
    stops: [
      { color: 'red', position: 0 },
      { color: 'rebeccapurple', position: 0.5 },
      { color: 'blue', position: 1 },
    ],
  },
}} />
```

Angles follow CSS (`0` points up and `90` points right); stop positions run
from `0` through `1`. Native interpolation supports `srgb` and `oklab`.
Radial gradients are explicitly rejected until GPUI has a radial background
primitive.

### Colors

Every color-bearing style field accepts the same string grammar. GPUIX native
uses `csscolorparser` 0.8.3 and accepts:

- named colors and `transparent`;
- 3/4/6/8-digit hex, with or without `#`;
- `rgb()` / `rgba()`, `hsl()` / `hsla()`, `hwb()` / `hwba()`, and
  `hsv()` / `hsva()`;
- `lab()`, `lch()`, `oklab()`, and `oklch()`;
- `none` components and the parser's limited relative-color `from` / `calc()`
  forms.

Standard comma and modern space/slash alpha forms work. Values are converted
to hard-clipped sRGB before GPUI paints them.

### Strict style diagnostics

Style objects are decoded field-by-field. An invalid value rejects only that
field; valid siblings still commit and the error never escapes React's commit
phase. In a Node runtime outside `NODE_ENV=production`, strict styles are
enabled by default and each rejection warns with the element id, element type,
`testId` when present, property, and offending value. Unknown properties,
unsupported enum values, invalid colors, radial gradients, and supported
properties with malformed values all use the same diagnostic path.

Production and browser bundles without a Node environment default to
deterministic compatibility mode: invalid fields are dropped without a warning,
while the rest of the style and mutation batch are applied. Pass
`strictStyles: true` to `render()` to keep diagnostics there, or
`strictStyles: false` to opt out explicitly.

`hsv()`, `hsva()`, and `hwba()` are parser extensions rather than CSS Color 4
standard functions. `color()`, platform/dynamic colors, and numeric color
integers are not accepted.

Theme values can use the same modern grammar:

```tsx
const theme = {
  surface: 'oklch(18% 0.02 260)',
  accent: 'oklch(67.3% 0.182 276.935)',
  text: 'oklch(96% 0 0)',
}

<div style={{ backgroundColor: theme.surface, borderColor: theme.accent }}>
  <text style={{ color: theme.text }}>Hello GPUIX!</text>
</div>
```

Limited relative-color forms can derive a new color from a base value:

```tsx
<div
  style={{
    backgroundColor: '#bad455',
    borderColor: 'oklch(from #bad455 calc(l - 0.15) calc(c * 0.7) h)',
  }}
/>
```

`boxShadow` accepts one structured shadow. Its fields are `offsetX`, `offsetY`,
`blurRadius`, `spreadRadius`, and `color`:

```tsx
<div
  style={{
    boxShadow: {
      offsetX: 0,
      offsetY: 4,
      blurRadius: 12,
      spreadRadius: 0,
      color: '#00000033',
    },
  }}
/>
```

**Overflow:** `overflow`, `overflowX`, `overflowY` — `"hidden"` clips content, `"scroll"` creates a native scrollable container with persistent scroll state

**Text:** `fontSize`, `fontFamily`, `fontWeight`, `letterSpacing`, `textTransform` (`"none"` | `"uppercase"` | `"lowercase"`), `textAlign`, `lineHeight`, `whiteSpace`, `textWrap`, `textOverflow`, `lineClamp`

`textWrap` accepts `"wrap"` and `"nowrap"`. `"balance"` and `"pretty"` are
recognized but explicitly rejected with a strict-style diagnostic because GPUI
does not yet implement those wrapping algorithms.

**Selection:** `userSelect` (`"text"` | `"none"`), `selectionColor` — both inherit down the tree

### Hover, active, and focus

`hover`, `active`, `focus`, and `focusVisible` are **nested style objects**.
GPUI applies them natively without a JavaScript round trip. `focus` applies for
pointer and keyboard focus. `focusVisible` applies only while the directly
tracked element has keyboard-modality focus, matching CSS `:focus-visible`.

```tsx
<div
  style={{
    backgroundColor: '#313244',
    borderRadius: 8,
    padding: 12,
    hover: { backgroundColor: '#45475a' },
    active: { backgroundColor: '#585b70' },
    focusVisible: {
      outlineColor: '#89b4fa',
      outlineWidth: 2,
      outlineOffset: 2,
    },
  }}
  tabIndex={0}
>
  Press
</div>
```

An outline is painted outside the border and does not change measured size or
move content. Focus styles do not make an element focusable: use `tabIndex`, a
keyboard/focus event, or a native input. A focused descendant does not apply a
parent's `focus` or `focusVisible` style.

Nesting is one level deep. A state style cannot contain `hover`, `active`,
`focus`, or `focusVisible`.

### Keyboard activation

A focused, clickable non-text element dispatches its existing `onClick` handler
for Enter or Space, using the same native click path as pointer activation.
Anchors with an `href` join the native tab order automatically, so a plain link
does not need an app-side `tabIndex` or `onKeyDown` adapter. Native text editors
keep Space as text input instead of synthesizing a click.

> **Note: `white-space: pre` is not supported.** GPUI's text system only has `normal` (wraps) and `nowrap` (single line). To preserve newlines like HTML `<pre>`, split your text on `\n` in React and render each line as a separate `<text>` element in a flex column:
>
> ```tsx
> <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'Menlo' }}>
>   {code.split('\n').map((line, i) => (
>     <text key={i} style={{ whiteSpace: 'nowrap' }}>{line}</text>
>   ))}
> </div>
> ```

> **Note: GPUI defaults text color to black, not white.** Unlike CSS, GPUI does not inherit `color` from parent elements. Every `<text>` element that doesn't set an explicit `color` style will render as black — invisible on dark backgrounds. Always set `color` on your text elements or on a parent `<div>` (which applies `text_color` to all children in that subtree via GPUI's `Styled` trait).

## Automation

Mark elements with **`testId`**, then drive them like Playwright. The same
client works in vitest, inside browser pages, and against a child process.

```tsx
<div testId="sidebar-collapse" onClick={onCollapse}>‹</div>
<textarea testId="composer" value={draft} onChange={...} />
<div testId="send" onClick={onSend}>↑</div>
```

```ts
import { createTestRoot } from '@gpuix/react'
import { connectTest } from '@gpuix/react/automation'
import { ChatApp } from './chat'

const { render, renderer } = createTestRoot()
render(<ChatApp />)
const app = await connectTest(renderer)

await app.screenshot({ path: 'open.png' })

await app.clock.pause()
await app.getByTestId('sidebar-collapse').click()
await app.clock.fastForward(200)
await app.screenshot({ path: 'collapsed.png' })

await app.getByTestId('composer').fill('hello gpuix')
await app.getByTestId('send').click()
await app.screenshot({ path: 'sent.png' })
```

That is the chat example. The real test lives in
[`examples/chat.test.tsx`](./examples/chat.test.tsx).

```
createTestRoot()          browser render()          launch({ command, args })
       │                         │                              │
       ▼                         ▼                              ▼
connectTest(renderer)      globalThis.gpuix                child stdin / stdout
       │                         │                              │
       └─────────────────────────┴──► App / Locator ◄───────────┘
                                  click, fill, query, clock
```

### Browser apps

Every browser render installs the automation `App` as **`globalThis.gpuix`**.
It is always available after `render()` returns. No setup flag or separate
transport is required.

```ts
await page.evaluate(async () => {
  await globalThis.gpuix
    .getByTestId('sidebar-collapse')
    .click()

  await globalThis.gpuix
    .getByTestId('composer')
    .fill('hello from Playwriter')

  await globalThis.gpuix.clock.pause()
  await globalThis.gpuix.clock.fastForward(200)
})
```

The browser global supports locators, input, tree and text queries, bounds,
selection, scrolling, focus, and clock control. Browser pages cannot write an
arbitrary local screenshot path. Use the controlling browser tool for that:

```ts
await page.screenshot({ path: 'review/chat.png', scale: 'css' })
```

### Locators

| Call | Matches |
|---|---|
| `app.getByTestId('send')` | The `testId` prop |
| `app.getByText('New chat')` | A node's own text |
| `app.getByType('textarea')` | The host element type |
| `locator.getByText('...')` | A descendant of another locator |

`click()` hits the center of the last painted bounds. `fill(text)` replaces the
focused editor contents. `press('enter')` sends one key. `waitFor()` polls until
exactly one match exists.

### Screenshots and clock

`app.screenshot({ path })` writes the current GPU frame as a PNG.

`app.clock.pause()`, `set(ms)`, and `fastForward(ms)` freeze native motion time.
Use that to capture a sidebar animation at known timestamps:

```ts
const startedAt = await app.clock.pause()
await app.getByTestId('sidebar-collapse').click()
await app.captureFrames('review/sidebar', [
  startedAt,
  startedAt + 100,
  startedAt + 200,
])
```

### Live apps

`launch({ command, args })` starts the app and speaks the same commands
over stdin as SSE `data:` lines. The app listens only when stdin is a **pipe**,
so a normal terminal run is unchanged. Lines without a `data:` prefix are
ignored; `console.log` cannot break a message.

```ts
import { launch } from '@gpuix/react/automation'

const app = await launch({ command: 'bun', args: ['examples/chat.tsx'] })
await app.getByTestId('composer').fill('hello')
await app.screenshot({ path: 'live.png' })
await app.close()
```

## Testing

The locators above sit on a **GPU-backed test renderer** (`TestGpuixRenderer`).
It runs the same `GpuixView`, `build_element()`, `apply_styles()`, and event
handlers as production. A fixed virtual display supplies layout geometry, so
tests never discover the host display; windows are positioned offscreen and
still rendered fully by Metal. The methods below are the lower-level API when a
locator is not enough.

### Consuming an unpublished checkout

Use packed tarballs, not a directory `file:` or `link:` dependency. Bun installs
directory dependencies as symlinks and resolves their real paths, which can load
the checkout's dev React packages alongside your app's React at runtime. That
is structurally unsafe under Bun even with correct peer dependencies;
`--preserve-symlinks` does not change it.

Build tarballs from the checkout, then pin those generated `.tgz` files in the
consuming app:

```bash
cd packages/native && bun pm pack
cd ../react && bun pm pack
```

```json
{
  "dependencies": {
    "@gpuix/native": "file:../gpuix/packages/native/gpuix-native-0.4.0.tgz",
    "@gpuix/react": "file:../gpuix/packages/react/gpuix-react-0.4.0.tgz"
  }
}
```

`react`, `react-reconciler`, and `scheduler` are peer dependencies. Install
versions compatible with your React runtime in the consuming app. If you still
use a directory link, configure Vitest to dedupe `react`, `react-dom`,
`react-reconciler`, and `scheduler`; that is only a fallback, not a supported
way to consume the unpublished fork under Bun.

`hasNativeTestRenderer` was removed. Use
`isNativeTestRendererAvailable()` when a test must check whether the native
renderer can initialize.

```ts
import { createTestRoot } from '@gpuix/react/testing'

const { root, renderer } = createTestRoot()

root.render(<MyComponent />)
renderer.flush()  // triggers GpuixView::render() via Metal

// Simulate events through GPUI's native input pipeline
renderer.nativeSimulateClick(50, 50)
renderer.nativeSimulateKeystrokes('enter')

// Inspect results
const events = renderer.drainNativeEvents()
const screenshot = renderer.captureScreenshot('/tmp/test.png')
const text = renderer.getAllText()
```

### Testing native elements

`getAllText()` only sees `<text>` nodes in the retained tree. `<code>`, `<diff>`
and `<markdown>` paint their text inside GPUI, so use `getPaintedText()`, which
returns every string painted in the last frame in paint order:

```ts
root.render(<code code={'a\nb'} language="ts" showHeader={false} />)
expect(renderer.getPaintedText()).toEqual(['a', 'b'])
```

Selection has its own helper. Listeners are registered during **paint**, so
`dragSelect` flushes between every step; calling `simulateMouseDown` / `Move` /
`Up` by hand without those flushes selects nothing:

```ts
expect(renderer.dragSelect(20, 30, 900, 300)).toBe('first line\nsecond line')
```

Screenshots land in `packages/react/screenshots/` and `examples/screenshots/`,
both gitignored, so they can be inspected after a run without adding a binary
diff to every commit. The curated set the README links to lives in
`docs/images/` and is regenerated with:

```bash
bun scripts/screenshots.ts
```

## Developing the Rust side

JS remount is covered above. There is **no hot reload for the native half**,
and there cannot be: `require()` of a `.node` file calls `process.dlopen`, Node
has no matching unload, and the live state (GPUI's platform, GPU device, open
window, UI thread, and selection registry) stays inside the loaded library. A
second load would create independent native state while the first library
remains loaded.

The rebuild is fast enough that it does not matter. Measured on an M-series Mac
after touching one file:

| Step | Time |
|---|---|
| `cargo check --lib` | 1.5s |
| `cargo build --lib` | 4.9s |
| `bun run build:debug` (napi) | ~2s |
| One vitest screenshot file | ~2s |

`bun run dev` wires that into a loop: it watches `packages/native/src`,
rebuilds, and re-renders the screenshot tests. **Rust edit to fresh PNGs is
about 4 seconds.**

```bash
bun run dev                      # rebuild, re-render the showcase screenshots
bun scripts/dev.ts --shots diff  # only tests matching "diff"
bun scripts/dev.ts --app native-text   # rebuild, restart an example app
```

Screenshot mode is the better default. Open
`packages/react/screenshots/showcase.png` in Preview.app, which reloads on
write, and unlike a live window the PNG can also be read by an agent.

Two things avoid the rebuild entirely:

- **Content** already lives in props. Change `patch` or `source` and the next
  frame shows it.
- **Design numbers** live in `theme.metrics`. Tuning a row height or heading
  scale is a React re-render.

The test renderer uses `VisualTestAppContext` with a `TestDispatcher` for deterministic scheduling. Event simulation goes through GPUI's coordinate-based hit testing and dispatch — not synthetic JS events.

## Status

- [x] React reconciler with mutation-based protocol
- [x] napi-rs FFI bindings (createElement, appendChild, setStyle, etc.)
- [x] RetainedTree (Rust-side element storage)
- [x] Style mapping (CSS properties → GPUI style methods)
- [x] Mouse events (click, mouseDown, mouseUp, mouseMove, mouseEnter, mouseLeave)
- [x] Click outside (`onMouseDownOutside`)
- [x] Scroll wheel events with delta and touch phase
- [x] Scrollable containers (`overflow: "scroll"`) with persistent scroll state
- [x] Programmatic scroll API (`scrollTo`, `scrollToItem`, `getScrollOffset`)
- [x] Keyboard events (keyDown, keyUp) with focus management
- [x] Focus/blur events with automatic FocusHandle creation
- [x] GPU-backed test renderer with screenshot capture
- [x] Standalone build (pinned GPUI platform dependencies)
- [x] Native text input and multiline textarea
- [x] Image and SVG elements (`<img>`, `<svg>`)
- [x] Virtual lists (`<virtual-list>`)
- [x] Native text components (`<code>`, `<diff>`, `<markdown>`)
- [x] Cross-element text selection
- [x] Headless Select, Combobox, and Tooltip
- [x] Native `hover` and `active` styles
- [x] Native focus styles, paint-only outlines, and keyboard activation
- [x] Window title (`setWindowTitle`)
- [x] Window chrome (`titlebarTransparent`, `windowBackground`, traffic-light position)
- [x] Application menus, Cmd+Q, explicit quit, and graceful React termination
- [x] Last window close terminates through the shared graceful lifecycle
- [x] Debug frame overlay (`debugFrameOverlay` / `setDebugFrameOverlay`)
- [ ] Canvas element
- [ ] Multiple windows
- [x] JS remount under `bun --hot` (`render()` keeps the native window)
- [ ] React Refresh during `bun --hot` (needs a Bun runtime transform)
- [ ] Hot reload of the native `.node` addon. `bun run dev` rebuilds and restarts. Native modules cannot unload.
- [x] Native `motion.div` transitions with deterministic frame capture

## Documentation

See [AGENTS.md](./AGENTS.md) for detailed architecture, communication flow, and contributing guide.

## License

[Apache-2.0](./LICENSE)
