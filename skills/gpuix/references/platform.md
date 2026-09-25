# Installing, running and shipping a GPU-IX app

## Contents

- Traps
- Install
- TypeScript
- Entry points
- `render()` and windows
- Native and browser targets
- Hot reload
- Building a binary
- Menus, window controls, background launch, updates
- Clipboard and announcements

## Traps

- **`bun add @gpuix/react` installs upstream's package, not this fork.** The fork publishes nothing to npm. Install its release tarballs, with an `overrides` entry for `@gpuix/native`; without it Bun resolves `@gpuix/native` from npm and the install fails or mixes in upstream's binary.
- **Release tarballs of `@gpuix/native` carry the macOS arm64 binary only.** Other platforms build from a checkout; Linux builds but is untested, and has no test renderer.
- **Without `jsxImportSource: "@gpuix/react"`, TypeScript uses DOM types**, so `<virtual-list>`, `<markdown>`, `<code code=…>` and `style.hover` fail to type-check, and DOM-only props type-check when they should not.
- **Run the app with `bun --hot`, not plain `bun`**, and end the entry file with `render()`. A save then remounts React in the same window; `useState` and focus reset (this is not React Refresh). Window options from later `render()` calls are ignored, except `menus`.
- **A piped stdin turns the app into an automation server.** When `process.stdin` is not a TTY, `render()` serves the automation protocol over stdio; a process manager that pipes stdin has its input parsed as protocol lines.
- **`bun build --compile` on the command line drops CSS modules** (`css-modules.md`). Build through `Bun.build`.
- **Strict style diagnostics are off in a compiled binary and in production**, so a style mistake that warns in development vanishes silently in the shipped app. Check the development console.
- **One window per renderer, one root per renderer.** A second root on the same renderer throws, and the renderer's capabilities report `multiple: false`. The `document` facade and clipboard follow the most recently attached root.
- **`@gpuix/react/dialogs` imports `node:os`**; it is desktop-only.

## Install

Pin the three tarballs from a release on https://github.com/Ernxst/gpuix/releases and override `@gpuix/native`:

```json
{
  "dependencies": {
    "@gpuix/react": "https://github.com/Ernxst/gpuix/releases/download/<tag>/gpuix-react-<version>.tgz",
    "@gpuix/plugins": "https://github.com/Ernxst/gpuix/releases/download/<tag>/gpuix-plugins-<version>.tgz"
  },
  "overrides": {
    "@gpuix/native": "https://github.com/Ernxst/gpuix/releases/download/<tag>/gpuix-native-<version>.tgz"
  }
}
```

Tags look like `@gpuix/react@0.25.0-fork.4` (URL-encoded in the path). `@gpuix/plugins` is needed for Bun builds and CSS modules. Peer dependencies: `react ^19.2.0`, `react-reconciler ^0.33.0`, optional `scheduler ^0.27.0`; React 18 is not supported. To use unreleased changes, build tarballs from a checkout cloned with `--recurse-submodules` (it needs a Rust toolchain; `bun install && bun run build`, then `bun pm pack` in `packages/native`, `packages/react` and `packages/plugins`) and pin them by absolute `file:` path; do not use a `link:` or directory dependency, which can load two copies of React under Bun.

## TypeScript

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@gpuix/react",
    "moduleResolution": "bundler",
    "module": "ESNext",
    "target": "ES2022",
    "strict": true
  }
}
```

For CSS modules add `import "@gpuix/plugins/css-modules"` to a `.d.ts`.

## Entry points

Every public import path (checked against both packages' `exports` by `packages/plugins/src/skill.test.ts`):

<!-- skill-check:entry-points -->
```text
@gpuix/react
@gpuix/react/cn
@gpuix/react/jsx-runtime
@gpuix/react/jsx-dev-runtime
@gpuix/react/testing
@gpuix/react/testing/vitest
@gpuix/react/testing/matchers
@gpuix/react/select
@gpuix/react/combobox
@gpuix/react/tooltip
@gpuix/react/floating
@gpuix/react/dialogs
@gpuix/react/globals
@gpuix/react/automation
@gpuix/plugins/bun
@gpuix/plugins/css
@gpuix/plugins/preload
@gpuix/plugins/css-modules
```

| Import | Contents |
|---|---|
| `@gpuix/react` | `render`, `createRoot`, `flushSync`, hooks (`useWindowSize`, `useWindowInsets`, `useGpuix`, `useGpuixRequired`, `useTextSearch`, `findRanges`), `motion`, `AnimatePresence`, `usePresence`, `useIsPresent`, `Select*`/`Combobox*`/`Tooltip*`, `requestAnimationFrame`, `ResizeObserver`, `Image`, `createImageBitmap`, `clipboard`, `announce`, `DOCUMENT_POSITION_*`, types (`PublicInstance`, `StyleDesc`, `SharedStyle`, …). Installs no globals. |
| `@gpuix/react/cn` | `cn()` for compiled CSS module styles (`css-modules.md`). |
| `@gpuix/react/jsx-runtime`, `/jsx-dev-runtime` | The JSX runtime and `JSX.IntrinsicElements`, used through `jsxImportSource`. |
| `@gpuix/react/testing`, `/testing/vitest`, `/testing/matchers` | Test renderer, Vitest wiring, matchers (`testing.md`). |
| `@gpuix/react/select`, `/combobox`, `/tooltip`, `/floating` | Headless components (`components.md`). |
| `@gpuix/react/dialogs` | Native file pickers. |
| `@gpuix/react/globals` | Opt-in browser-global facades (`events-and-dom.md`). |
| `@gpuix/react/automation` | Drive a live or test app (`testing.md`). |
| `@gpuix/plugins/bun`, `/css`, `/preload`, `/css-modules` | Build plugins and CSS module types (`css-modules.md`). |

## `render()` and windows

```tsx
import { render } from "@gpuix/react"

render(<App />, { title: "My App", width: 1000, height: 700 })
```

- The first call creates the renderer and window, mounts React and starts the frame loop. Later calls (hot reload) unmount and remount on the same window. After the app terminates, `render()` throws.
- Window options: `title`, `appName`, `width`, `height`, `minWidth`, `minHeight`, `resizable`, `fullscreen`, `transparent`, `titlebarTransparent`, `windowBackground`, `trafficLightX`/`trafficLightY`, `reducedMotion`, `allowPrivateNetworkImages`, `focus`, `show`, `appId`, `menus`, `layerShell` (Linux/Wayland). Render options add `onEvent`, `onSelectionChange`, `onMenuAction`, `onTerminated`, `renderer`, `debugFrameOverlay`, `strictStyles`, `errorOverlay`.
- `errorOverlay` and `strictStyles` default on outside production and outside a compiled binary.
- `createRenderer`, `createRoot` and `startFrameLoop` exist for custom hosts and tests; an app entry should use `render()`, which is what hot reload expects.

## Native and browser targets

`@gpuix/native` has a napi `main` and a wasm `browser` entry, so the bundler target picks the renderer: the same `app.tsx` and `render()` run natively under Bun and in a browser built with `Bun.build({ target: "browser" })`. The browser page must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Window controls, `checkUpdate` and `@gpuix/react/dialogs` are desktop-only. The web build of a CSS module uses the bundler's own CSS modules, so share components, not the GPU-IX style objects.

## Hot reload

```bash
bun --hot --preload @gpuix/plugins/preload app.tsx
```

The preload registers the CSS module plugin before the app imports any `.module.css`. A saved `.tsx` remounts React in the same window and GPU context. An edited CSS module needs a restart. A new native binary needs a restart too.

## Building a binary

```ts
import { gpuixCssModulesBun } from "@gpuix/plugins/css"

await Bun.build({
  entrypoints: ["app.tsx"],
  compile: { outfile: "dist/my-app" },
  plugins: [gpuixCssModulesBun()],
  define: { "process.env.NODE_ENV": '"production"' },
})
```

- Without `NODE_ENV=production` the binary ships React's development build.
- `gpuix()` from `@gpuix/plugins/bun` sets GPU-IX build defaults for `Bun.build` (Bun target, ESM, JSX from `@gpuix/react`, `@gpuix/native` always external) and takes no PostCSS plugins. Because it keeps `@gpuix/native` external, use `gpuixCssModulesBun({ plugins? })` for a `compile` build, as above (`examples/compile-chat.ts`).
- Do not register the preload in `bunfig.toml`; it is embedded into compiled binaries and fails there.
- The README's "Ship a binary" and app-bundle sections cover `cargo-packager` for `.app`/installer packaging.

## Menus, window controls, background launch, updates

- **Menus**: `render(…, { menus })` takes `{ name, items, disabled? }` menus. Item kinds: `action` (`id`, `label`, optional `keyEquivalent` and `osAction`; `role: "quit"` needs no `id`), `separator`, `submenu` (`label`, `items`) and `system` (`label`, `systemMenu: "services"`). `menus: []` removes the default menu; `onMenuAction({ id })` handles actions; `renderer.setMenus()` and `renderer.quit()` exist. macOS gets no Edit menu by default.
- **Window controls** on the renderer from `useGpuixRequired()`: `activateWindow()`, `minimizeWindow()`, `zoomWindow()`, `toggleFullscreen()`.
- **Background launch**: `focus: false` opens without stealing focus; `show: false` keeps the window hidden until `activateWindow()`. Both are ignored on Linux. Agents launching a live app pass `GPUIX_BACKGROUND=1` and the app maps it to `focus: false`.
- **Auto-update**: `import { checkUpdate } from "@gpuix/native"`; `checkUpdate(currentVersion, { endpoints, pubkey, … })` returns an update or `null`, and `update.downloadAndInstall()` replaces the packaged files without relaunching.

## Clipboard and announcements

- `clipboard.writeText()` and `clipboard.readText()` from `@gpuix/react` (or `navigator.clipboard` after `globals`) handle text only and use the most recently attached root; with no root they reject with `No GPUIX root is mounted`.
- `announce(message, options)` speaks a message through the accessibility tree without an element.
