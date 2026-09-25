# CSS modules on GPU-IX

GPU-IX has no CSS engine. `@gpuix/plugins` compiles each `.module.css` file at build time into the style objects it describes, and the renderer applies them as the element's style. The compiler is `packages/plugins/src/css-modules.ts`; its tests are `packages/plugins/src/css-modules.test.ts` and `css.test.ts`.

A declaration that compiles is not always one the renderer accepts. The compiler checks property names; the native parser checks values at runtime and drops a bad value with a strict-mode diagnostic. The traps below list the known gaps.

## Contents

- Traps
- Wiring (Vite, Bun, preload, types)
- Selectors
- `:root` custom properties and `@import`
- At-rules
- `composes`
- Properties
- The compiled value and `className`
- Open issues

## Traps

- **Import CSS modules from JS by relative path only.** Bun resolves a JS-level `.module.css` import with `path.resolve(importer dir, id)`, so `@/ui/x.module.css` and `pkg/x.module.css` resolve to the wrong file. A `#ui/x.module.css` specifier is not recognised as a CSS module in either Bun or Vite, because the plugin strips everything after `#` (`css.ts` `cleanId`). Inside CSS, `@import` and `composes … from` do resolve package and `#` imports.
- **Only two descendant forms exist: `.a:hover .b` and `.a:active .b`.** Plain descendants, children (`>`), compound classes (`.a.b`), attribute selectors, and descendants of `:focus`/`:focus-visible`/`:focus-within` fail the build (#670). There are no `data-*` state attributes to target anyway. For `.card:focus-within .title`, give `.card` its own `:focus-within` rule and drive the title from React state (`styles.md`, State styles).
- **One ancestor per descendant class.** `.card:hover .title` together with `.panel:hover .title` fails: `selector ".panel:hover .title" conflicts with selector ".card:hover .title"`.
- **A descendant rendered outside its ancestor gets a runtime diagnostic, not a silent miss.** `.a:hover .b` gives `.a` a generated `hoverGroup` and `.b` a `hoverWithinGroup`; if an element with class `b` has no `a` ancestor, strict mode reports `no ancestor hoverGroup named … was found`.
- **Custom properties are substituted only from `:root` or `html`.** A class-scoped `--c` is left as the literal string `var(--c)`, and the renderer implements no `var()`, so the value is dropped at runtime. A token file that wraps `:root` in `@media (prefers-color-scheme: dark)` fails the build.
- **`box-shadow` and `text-decoration` cannot be written in a CSS module** although the native style model has both. The translator expands them to `shadowOffset…` and `textDecorationLine`, which are rejected (#672). Put them in the `style` prop.
- **`line-height` must be unitless or `px`.** `2rem` compiles to the bare number `32`, which the renderer reads as a multiplier of the font size. `em` and `%` values compile and then fail natively. Releases up to 0.25.0-fork.4 also turn `px` into a multiplier (#665, fixed on `main` by #668); on those, use unitless values.
- **Lengths in `em` compile and then fail natively.** Native lengths accept px, `%`, `ch`, `vw` and `vh`; `rem` works only because the compiler converts it to px at 16px per rem.
- **Values the renderer rejects compile cleanly**: `display: block` (native accepts `none`, `flex`, `grid`; omit `display` for block flow), `margin: 0 auto` (margins must be numbers), and `grid-template-columns`/`-rows`/`grid-auto-*` (native takes track-object arrays, not CSS strings; set grids in `style`).
- **`transition` belongs on the base class rule only.** Inside `:hover` or another state it fails the build; the `transition-*` longhands are rejected everywhere.
- **Plain descendant rules nested inside a class are rejected.** `postcss-nesting` flattens `.card { .label {} }` to `.card .label`. `&:hover` and `&:hover .label` are fine.
- **`bun build --compile` on the command line compiles no CSS modules.** It takes no plugins, so each import becomes Bun's class-name string and paints nothing; strict mode is off in the binary, so this only warns. Build with `Bun.build({ compile, plugins: [gpuixCssModulesBun()] })` (`packages/plugins/README.md`).
- **An edited CSS module needs a process restart under `bun --hot`.** Bun's watcher does not re-run plugin-loaded files. Vite watches the module and its imports.
- **An empty rule produces no key.** `.a {}` makes `styles.a` `undefined`.

## Wiring

| Entry | Use |
|---|---|
| `@gpuix/plugins/css` → `gpuixCssModules({ plugins })` (also the default export) | Vite and Vitest plugin; resolves through Vite, so aliases work, and watches imports. |
| `@gpuix/plugins/css` → `gpuixCssModulesBun({ plugins })` | CSS-only Bun plugin for `Bun.build()` or `Bun.plugin()`. |
| `@gpuix/plugins/bun` → `gpuix(options)` | `Bun.build` plugin that also sets GPU-IX build defaults (Bun target, ESM, automatic JSX from `@gpuix/react`, `@gpuix/native` always external). Takes no PostCSS plugins. |
| `@gpuix/plugins/bun` → `gpuixDev()` | The CSS plugin for a custom `Bun.plugin()` preload. |
| `@gpuix/plugins/preload` | Side-effect preload: `bun --hot --preload @gpuix/plugins/preload app.tsx`. |
| `@gpuix/plugins/css-modules` | Types only: add `import "@gpuix/plugins/css-modules"` to a `.d.ts`. |

Do not register the preload in `bunfig.toml`: it is embedded into `--compile` binaries and fails to resolve there. User PostCSS plugins run after the built-in ones and are accepted only by `gpuixCssModules` and `gpuixCssModulesBun`.

## Selectors

Class names match `[A-Za-z_][A-Za-z0-9_-]*`. Every rejection reads `[gpuix] cannot use CSS module "<path>": selector "<sel>" is not supported yet`.

| Selector | Compiles to |
|---|---|
| `.a` | The class style. |
| `.a:hover`, `:active`, `:focus`, `:focus-visible`, `:focus-within` | `hover`, `active`, `focus`, `focusVisible`, `focusWithin` inside `.a`. A state rule with no base rule still creates the class. |
| `.a:hover .b` | `.a` gets a generated `hoverGroup`; `.b` gets `hoverWithinGroup` and `hoverWithin`. |
| `.a:active .b` | The same group; `.b` gets `activeWithin`. Added on `main` by #671; releases up to 0.25.0-fork.4 reject it. |
| `.a, .b:hover` | Applied to each selector in the list. |

A hand-written `hover-group: name` on the ancestor replaces the generated name. `hover-group` and `hover-within-group` are not allowed inside a state rule.

These compile:

<!-- skill-check:accepted-selectors -->
```text
.a
.a:hover
.a:active
.a:focus
.a:focus-visible
.a:focus-within
.a:hover .b
.a:active .b
.a, .b:hover
.a:hover, .b:focus-visible
```

These fail the build:

<!-- skill-check:rejected-selectors -->
```text
.a .b
.a > .b
.a.b
.a:hover > .b
.a:hover .b .c
.a:focus .b
.a:focus-visible .b
.a:focus-within .b
.a:hover:focus
.a::before
.a[data-state="open"]
.a:not(.b)
.a:disabled
div
#a
:global(.a)
:root
```

## `:root` custom properties and `@import`

The built-in PostCSS pipeline is `postcss-import` (resolving through the host bundler), `postcss-nesting`, then `postcss-custom-properties({ preserve: false })`. After substitution every `--*` declaration is removed, and a `:root` rule left empty is dropped.

- A module can declare its own `:root { --x: … }` and use `var(--x)`; so can an imported token file. `var(--x, fallback)` with no definition takes the fallback.
- `@import` resolves relative paths, package `imports` (`#styles/tokens.css`), exported package subpaths, and packages whose `style` field points at CSS, from the file that contains the `@import`, under both Vite and Bun (test "Vite and Bun resolve package imports and bare CSS packages inside nested modules").
- `@import "./other.module.css"` inlines that file's classes as this module's own.

## At-rules

After `@import` is inlined, every remaining at-rule fails with `at-rule "@<name>" is not supported yet`: `@media`, `@supports`, `@container`, `@layer`, `@keyframes`, `@font-face`, `@charset`. There are no media queries; branch on `useWindowSize()` in the component instead.

## `composes`

- Allowed only in a rule whose selector is one class with no pseudo-class; elsewhere: `declaration "composes: …" must be in a single local class rule`.
- **Same file** (`composes: base icon`): included classes merge in stylesheet order, not the order listed.
- **Other file** (`composes: x from "./f.module.css"`): imported classes merge first in `composes` order, then local rules. Relative paths resolve from the stylesheet that declares the `composes`, including one pulled in by `@import`. Under the Bun preload, package subpaths and `#` imports work (fixed on `main` by #669; releases up to 0.25.0-fork.4 resolve `#…` against the importer's directory, #667).
- State objects deep-merge, and hover ancestor/descendant pairs compose across modules.
- Errors: `from global` is rejected; missing classes, unreadable files and cycles are reported by name; composing two different `hoverGroup` values fails.

Cross-file conflicts follow CSS Modules' own undefined ordering on the web, so a conflicting result can differ between the web build and GPU-IX.

## Properties

The compiler converts declarations with `css-to-react-native-transform` and accepts only these properties (the list is checked against `SUPPORTED_PROPERTIES` in `css-modules.ts` by `packages/plugins/src/skill.test.ts`):

<!-- skill-check:css-module-properties -->
```text
display
visibility
flex-direction
flex-wrap
flex-grow
flex-shrink
flex-basis
align-items
align-self
align-content
justify-content
gap
row-gap
column-gap
grid-template-columns
grid-template-rows
grid-column
grid-row
grid-column-start
grid-column-end
grid-row-start
grid-row-end
grid-area
grid-auto-flow
grid-auto-rows
grid-auto-columns
justify-items
justify-self
width
height
min-width
min-height
max-width
max-height
aspect-ratio
padding
padding-top
padding-right
padding-bottom
padding-left
margin
margin-top
margin-right
margin-bottom
margin-left
position
top
right
bottom
left
background
background-color
color
opacity
border
border-top
border-right
border-bottom
border-left
border-width
border-top-width
border-right-width
border-bottom-width
border-left-width
border-color
border-style
border-radius
border-top-left-radius
border-top-right-radius
border-bottom-left-radius
border-bottom-right-radius
box-shadow
outline-color
outline-width
outline-offset
font-size
font-family
font-weight
letter-spacing
font-variant-numeric
text-decoration
list-style
list-style-type
text-transform
text-align
line-height
white-space
text-wrap
text-overflow
line-clamp
overflow
overflow-x
overflow-y
clip-path
cursor
pointer-events
touch-action
user-select
selection-color
transition
hover-group
hover-within-group
interpolate-size
```

Being on this list means the property name compiles. The Traps section lists values that still fail. Other conversions to know:

| CSS | Result |
|---|---|
| `padding: 1rem 2px`, `margin: 0 8px` | Longhands; `rem` × 16 → px number. |
| `border: 1px solid red` | `borderWidth`, `borderStyle`, `borderColor`. |
| `flex: 1` | `flexGrow: 1`, `flexShrink: 1`, `flexBasis: 0`. The `flex` shorthand is not accepted in inline `style`. |
| `aspect-ratio: 16 / 9` | A number. |
| `width: 50%`, `50vw`, `calc(100% - 10px)` | Strings, passed through; see `styles.md` for the native length grammar. |
| Colours (`oklch()`, `hsl()`, named, hex) | Strings. |
| `transition: opacity 150ms ease-out` | The shorthand string, on the base rule only. |
| `color: red !important` | `"red !important"`, passed through and rejected natively. |

Rejected at build time: `font`, `font-style`, `transform`, `z-index`, `inset`, the `outline` shorthand, `outline-style`, `place-items`, `background-image`, `background: linear-gradient(…)`, `-webkit-line-clamp`, `transition-*` longhands, `animation`, `line-height: normal`, and anything else not listed above. Errors read `property "<camelName>" is not supported by the native style prop` (or `…by the native "<state>" style` inside a state).

## The compiled value and `className`

A module's default export is `{ [className]: styleObject }`, each tagged with the non-enumerable `Symbol.for("gpuix.compiledStyle")`. There are no named exports. The `*.module.css` type still says `Record<string, string>`, so these type-check and then fail on GPU-IX:

```tsx
<div className={`${styles.a} ${styles.b}`} />      // "[object Object] [object Object]": throws in dev
<div className={clsx(styles.a, on && styles.b)} /> // same
<div className={cn({ [styles.a]: on })} />         // class "[object Object]"
```

Write this instead:

```tsx
import { cn } from "@gpuix/react/cn"
<div className={cn(styles.a, on && styles.b)} />
```

- `className` takes one compiled object, `cn(...)` over compiled objects, or `null`/`undefined`/`""`. A plain string or an uncompiled object throws `UnsupportedClassNamePropError` in development (strict styles) and warns once otherwise; no style applies.
- `style` beats `className` per property, and a property set in `style` also removes that property from the class's state styles: a class `:hover` background never shows over an inline `backgroundColor`.
- `cn()` merges compiled styles shallowly: a later class's `hover` object replaces an earlier one whole, where CSS would cascade both. Keep each state's declarations in one class, or use `composes`, which deep-merges states.
- With no compiled input, `cn` delegates to the `cn` package (with Tailwind merge) and returns a string, which is what the web build uses.

## Open issues

| Issue | Gap |
|---|---|
| #670 | Descendant styles from ancestor `:focus`, `:focus-visible`, `:focus-within`. |
| #672 | `text-decoration` rejected after conversion to `textDecorationLine`. |
| #632 | Whether to keep the React Native translator, the source of the `box-shadow`, `text-decoration`, `font` and `em` failures. |
