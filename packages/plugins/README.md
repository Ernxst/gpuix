# @gpuix/plugins

Use `@gpuix/plugins/vite` to run a native GPUIX app with Vite during
development. Use `@gpuix/plugins/bun` to package it with `Bun.build`.

The Vite process runs under Bun, so the native N-API binding and Vite share one
runtime.

Install this package alongside `@gpuix/react`. Add Vite when using the `/vite`
entry point, then configure it with an application entry point:

```ts
import { defineConfig } from "vite"
import { gpuix } from "@gpuix/plugins/vite"

export default defineConfig({
  appType: "custom",
  plugins: [gpuix({ entry: "app.tsx" })],
})
```

Run the Vite executable under Bun in `package.json`:

```json
{ "scripts": { "dev": "bun run --bun vite" } }
```

The Vite adapter is for native development. If a config includes `gpuix()` in
`vite build`, it throws; use the Bun adapter for native packaging.

### Bun import attributes in Vite development

The Vite dev server recognises Bun's `type: "text"` and `type: "file"`
import attributes in the native `gpuix` environment. A text import evaluates to
the file contents. A file import evaluates to the file's absolute path on disk,
so APIs such as `Bun.file` can open it:

```ts
import bundledNodes from "./nodes.json" with { type: "file" }

const nodesFile = Bun.file(bundledNodes)
```

### Bun hot reload

Use `gpuixDev()` from a Bun preload when developing with `bun --hot`:

```ts
// src/gpuix.preload.ts
import { gpuixDev } from "@gpuix/plugins/bun"

Bun.plugin(gpuixDev())
```

Register the preload in `bunfig.toml`:

```toml
preload = ["./src/gpuix.preload.ts"]
```

Then run the application normally:

```json
{ "scripts": { "dev": "bun --hot src/app.tsx" } }
```

The preload must run before the application imports any CSS modules.
Bun's runtime watcher does not currently re-run files handled by custom
`onLoad` plugins, so restart the process after changing a CSS module. JavaScript
and TypeScript changes continue to use Bun's hot reload.

## Bun build

Use `@gpuix/plugins/bun` when packaging a native application with `Bun.build`:

```ts
import { gpuix } from "@gpuix/plugins/bun"

const result = await Bun.build({
  entrypoints: ["app.tsx"],
  outdir: "dist",
  plugins: [gpuix()],
})

if (!result.success) throw new Error("Bun build failed")
```

The plugin defaults to Bun as the target, ESM output, automatic JSX using
`@gpuix/react`, and an external `@gpuix/native` import. Existing `Bun.build`
values win for scalar settings. `external`, `define`, and `conditions` are
merged, while `@gpuix/native` is always kept external for the native loader.

Plugin-specific values can be supplied when needed:

```ts
plugins: [
  gpuix({
    external: ["another-native-addon"],
    define: { "process.env.APP_VERSION": JSON.stringify("1.0.0") },
    conditions: ["desktop"],
  }),
]
```

## Shared native and web config

When one Vite config also serves a browser entry, keep the React plugin enabled
and add `gpuix()` only in native mode:

```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { gpuix } from "@gpuix/plugins/vite"

export default defineConfig(({ mode }) => {
  const native = mode === "native"

  return {
    appType: native ? "custom" : "spa",
    plugins: [
      react({ jsxImportSource: "@gpuix/react" }),
      native && gpuix({ entry: "src/native.tsx" }),
    ],
  }
})
```

The React plugin refreshes Vite's client environment. GPUIX refreshes the
native environment, so the two plugins do not apply two Refresh wrappers to the
native app. The scoped `--bun` flag runs only Vite under Bun; browser and Node
test commands keep their usual runtimes.

Component-only React edits use Fast Refresh and preserve state. Changes to a
module with incompatible exports, such as a TanStack Router route module,
perform Vite's ordinary reload and remount the native React tree. Rebuild and
restart Bun after changing Rust or the native binding.

## Native CSS modules

In the native `gpuix` environment and the Bun build plugin, imports ending in
`.module.css` are converted to objects for the `style` prop:

```tsx
import styles from "./button.module.css"

export function Button() {
  return <div style={styles.button}>Save</div>
}
```

The transform accepts simple local class selectors and declarations supported
by GPUIX's native style model. Grouped class selectors are supported. Complex
selectors, pseudo-classes, at-rules, animations, and CSS-module composition
are rejected until they have a native style representation.

Vite's normal browser environment continues to use ordinary CSS Modules. Add a
type-only import to opt into the native CSS-module declaration:

```ts
// src/gpuix-css-modules.d.ts
import "@gpuix/plugins/css-modules"
```

Keep this declaration opt-in in projects that also compile browser CSS modules:
the browser and native environments give the same `.module.css` import
different value shapes.

For complete setup and packaging instructions, see the repository README.
