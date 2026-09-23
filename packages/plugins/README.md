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

## CSS modules

A `.module.css` import goes in `className`, the same as on the web:

```tsx
import styles from "./button.module.css"

export function Button() {
  return <div className={styles.button}>Save</div>
}
```

A web build resolves that import to a class name and applies the stylesheet. A
GPUIX build has no CSS engine, so `@gpuix/plugins/css` compiles the file into
the styles it describes and the renderer applies them as the element's style.
One component source works on both, and `style` wins where both set the same
property.

The transform puts compiled styles in `className` and accepts local class
selectors, grouped selectors, and declarations supported by GPUIX's native
style model. It supports the `:hover`, `:active`, `:focus`, and
`:focus-visible` states, plus hovered-descendant selectors such as
`.container:hover .child`, limited to one hovered-ancestor relation per child.
Other selectors, at-rules, animations, and CSS-module composition are rejected
until they have a native style representation.

`gpuix()` already compiles CSS modules in its own Vite environment. Add the
standalone plugin where that one cannot run — a Vitest config, a native-only
Vite config, another bundler:

```ts
import { defineConfig } from "vite"
import { gpuixCssModules } from "@gpuix/plugins/css"

export default defineConfig({
  plugins: [gpuixCssModules()],
})
```

It compiles every environment by default. Pass `environments` to restrict it,
as `gpuix()` does for its own. A web build needs no GPUIX plugin at all: Vite's
CSS modules already produce what `className` wants there.

`gpuixCssModulesBun()` is the same transform for Bun, in `Bun.build()` or in a
`Bun.plugin()` preload. A Bun build without it compiles `.module.css` to class
names of Bun's own, which the renderer cannot resolve:

```ts
import { gpuixCssModulesBun } from "@gpuix/plugins/css"

await Bun.build({
  entrypoints: ["src/app.tsx"],
  compile: { outfile: "dist/app" },
  plugins: [gpuixCssModulesBun()],
})
```

`bun build` on the command line takes no plugins, so a packaged application
needs either this API or a `Bun.plugin()` preload. A preload named in
`bunfig.toml` is also embedded in a `--compile` binary, where it fails to
resolve `@gpuix/plugins`, so keep the preload for `bun --hot` and build through
the API.

### Combining classes

Import `cn` from `@gpuix/react/cn` rather than from `cn` or `clsx`:

```tsx
import { cn } from "@gpuix/react/cn"

<div className={cn(styles.item, active && styles.active, className)} />
```

On the web it is the `cn` package, Tailwind conflict resolution included. On
GPUIX it merges the compiled styles instead, later values winning. A literal
class name reaching a GPUIX build cannot be applied, so the renderer names it
in a diagnostic rather than dropping it silently. `cn({ [styles.active]: on })`
works only on the web, because the key of a compiled style is not a class name;
write `on && styles.active` for code that runs on both.

### Types

Opt into the `.module.css` declaration from a project `.d.ts` file:

```ts
// src/gpuix-css-modules.d.ts
import "@gpuix/plugins/css-modules"
```

It types the import as the class-name string a web build produces, which is
what both targets pass along and neither reads as text. Typing it that way
keeps one component compiling against react-dom and GPUIX alike, and keeps an
inline style object out of `className`. Building a class name out of one —
`` `${styles.a} extra` `` — compiles and then fails on GPUIX, where the value
is an object.

For complete setup and packaging instructions, see the repository README.
