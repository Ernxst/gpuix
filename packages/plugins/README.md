# @gpuix/plugins

Use `@gpuix/plugins` with Bun to develop and package a native GPUIX app. Install
it alongside `@gpuix/react`.

### Develop with Bun hot reload

Pass the package preload to Bun when developing with `bun --hot`:

```bash
bun --hot --preload @gpuix/plugins/preload src/app.tsx
```

If the app needs other Bun plugins, register them alongside `gpuixDev()` in a
custom preload instead:

```ts
// src/gpuix.preload.ts
import { gpuixDev } from "@gpuix/plugins/bun"

Bun.plugin(gpuixDev())
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
style model. It supports the `:hover`, `:active`, `:focus`, `:focus-visible`,
and `:focus-within` states, plus hovered and pressed descendant selectors such as
`.container:hover .child` and `.container:active .child`. Each child can refer to
one ancestor group across both states. The transform binds its `hoverWithin` and
`activeWithin` styles to that ancestor's `hoverGroup`, including when the two
classes are composed separately. Other
selectors, at-rules and animations are rejected until they have a native style
representation.

`box-shadow` and `text-decoration` are part of the native style model, but the
underlying CSS-to-object transform expands them into React Native's split
properties (`shadowOffset`, `shadowRadius`, `textDecorationLine`, and so on),
which GPUIX's model does not accept, so a CSS module declaring either is
rejected (`text-decoration` is [#672](https://github.com/Ernxst/gpuix/issues/672)).
Set them through the `style` prop instead.

CSS modules can compose local classes from the same file or another CSS module:

```css
.base { color: white; }
.icon { font-size: 12px; }
.button { composes: base icon; }
.card { composes: plate from "./tile.module.css"; }
```

Composition produces one style object containing the composed and local
declarations, including their interaction states. Same-file declarations merge
in stylesheet order. Cross-file classes merge in the order listed by
`composes`, with later classes winning conflicts; the local module's rules merge
after them in stylesheet order. CSS Modules does not define the order of
conflicting declarations across files, so those conflicts are not guaranteed to
match the web build. A relative `from` path resolves from the stylesheet that
declares the `composes` statement. Package `imports` subpaths such as
`composes: control from "#ui/control/control.module.css"` use the same Vite or
Bun resolution as `@import`. Exported package subpaths such as
`composes: tile from "style-pkg/tile.module.css"` also resolve under Bun's
preload, as do package subpaths without an `exports` map and package `imports`
aliases that point to those subpaths. `composes: name from global` is rejected
because GPU-IX cannot resolve a global class to a style object. Composition also
rejects classes whose `hoverGroup` or `hoverWithinGroup` values name different
groups, because one style object cannot represent both relationships.

Add `@gpuix/plugins/css` to the Vite or Vitest project that should compile
native CSS modules:

```ts
import { defineConfig } from "vite"
import { gpuixCssModules } from "@gpuix/plugins/css"

export default defineConfig({
  plugins: [gpuixCssModules()],
})
```

The plugin compiles CSS modules in the project where it is installed. A web
build needs no GPUIX plugin: Vite's CSS modules already produce what
`className` wants there.

The transform inlines `@import`, flattens nested rules and resolves custom
properties on its own: it runs `postcss-import`, `postcss-nesting` and
`postcss-custom-properties` with `preserve: false` before validation, and the
package depends on all three. A `plugins` option adds to those built-in plugins
rather than replacing them, and runs after them:

```ts
import { gpuixCssModules } from "@gpuix/plugins/css"

export default defineConfig({
  plugins: [gpuixCssModules({ plugins: [myOwnPlugin()] })],
})
```

Custom-property declarations are removed after substitution, while unsupported
at-rules and selectors still fail validation. The same option is available to
`gpuixCssModulesBun()`.

Nesting is flattened before validation, so an interaction state can sit inside
its class and a hovered descendant inside its ancestor:

```css
.card {
  background-color: #111;

  &:hover {
    background-color: #222;
  }

  &:hover .label {
    color: #fff;
  }
}
```

Flattening hands the result to the same selector rules rather than widening
them. `&:hover` becomes `.card:hover` and folds into the class style, and
`&:hover .label` becomes the `hoverGroup` and `hoverWithin` pair. A nested
descendant or child selector such as `.card { .label { … } }` becomes
`.card .label`, which is still rejected.

For example, `tokens.css` can hold values shared with the web build:

```css
:root {
  --band-hover: #252e34;
}
```

A native CSS module can import those tokens and use `var()`:

```css
@import "./tokens.css";

.item {
  background-color: var(--band-hover);
}
```

The built-in plugins run before GPUIX validates the CSS, so this becomes
`{ item: { backgroundColor: "#252e34" } }`.
Imports inside a CSS module use Vite's resolver in Vite and Vitest, or Bun's
resolver in Bun. Relative imports, package `imports` subpaths such as
`#styles/tokens.css`, and bare package specifiers resolve from the stylesheet
that contains each `@import`. PostCSS retains its CSS-aware lookup when a
package's JavaScript entry differs from its `style` field.

Unitless `line-height`, such as `line-height: 1.5`, compiles to the font-size
multiplier `lineHeight: "1.5"`. A pixel value such as `line-height: 18px`
compiles to `lineHeight: "18px"`, an absolute line height on desktop.
`line-height` must be unitless or `px`: a `rem` value is converted to a bare
number that the native side reads as a multiplier (`line-height: 2rem`
compiles to `32`, not a 32px absolute height), and `em` or `%` values compile
but the native renderer rejects them.

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
