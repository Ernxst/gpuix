# Inline styles, state styles and motion

The `style` prop takes a `StyleDesc` object (`packages/react/src/types/host.ts`), which the native parser checks field by field (`parse_style_value_at` in `packages/native/src/style.rs`). It looks like React DOM's `CSSProperties`, but the value grammar is narrower and there is no cascade beyond a few inherited text properties.

## Contents

- Traps
- Strict style diagnostics
- Properties and values
- Lengths
- Colours and backgrounds
- Borders and shadows
- Text
- State styles and hover groups
- `className` and `style` together
- Transitions
- `motion.div` and `AnimatePresence`
- Frame clock
- Reduced motion
- Shared web and native styles
- Open issues

## Traps

- **Spacing, insets, radii, font sizes and letter spacing take numbers only, and a number means px.** `padding`, `margin*`, `gap`, `top`/`right`/`bottom`/`left`, `borderRadius*`, `fontSize`, `letterSpacing`, `flexBasis`, `outlineWidth`/`outlineOffset` reject `"8px"`, `"1rem"`, `"50%"`, `"auto"` and multi-value strings such as `"8px 16px"`. `margin: "0 auto"` is dropped; centre with `alignItems`/`justifyContent`.
- **Only `width`, `height`, `min*` and `max*` accept strings.** See Lengths. There is no `rem`, `em`, `min()`, `max()` or `var()` in any inline value.
- **`display` accepts `"none"`, `"flex"` or `"grid"` only.** `"block"`, `"inline"`, `"inline-flex"` and `"contents"` are dropped. An element with no `display` lays out as a block: its children stack vertically, each taking the full width. That includes `span`, `strong`, `a` and the other inline-looking tags (see `elements.md`).
- **Uncoloured text paints light grey `#e2e2e2`, not black.** It disappears on a light surface. `color` on an ancestor `div` is inherited, as are `fontSize`, `fontFamily` and `fontWeight`.
- **Common web properties do not exist**: the `flex` shorthand, `zIndex`, `boxSizing`, `transform`, `fontStyle`, `inset`, `backgroundImage`, `textDecorationColor`, `transitionProperty`, `objectFit` (a prop on `<img>`, not a style). An unknown key is dropped with a diagnostic. Layout is always border-box. Stacking follows tree order; paint an overlay later with `<anchored deferred>` (#481).
- **`var()` does nothing in inline styles.** `--*` keys are accepted and ignored, and `color: "var(--x)"` is dropped as an unsupported colour. Only CSS modules substitute custom properties, at build time.
- **A bad field is dropped quietly outside development.** Strict diagnostics are on by default only when `NODE_ENV !== "production"` and not in a `bun build --compile` binary; there a bad field vanishes without a word.
- **A bare `hoverWithin` with no `hoverGroup` ancestor never applies, and nothing reports it.** Put `hoverGroup` on the ancestor. A `hoverWithinGroup` that names a group no ancestor declares is reported in strict mode: `no ancestor hoverGroup named "x" was found`.
- **`focusWithin`, `activeWithin` and `dragOver` changes snap; they do not transition.** Only `focus`, `focusVisible`, `hoverWithin`, `hover` and `active` refinements animate.
- **`transition: "all 200ms"` is rejected as a whole.** One bad item rejects the whole declaration, and only the properties in Transitions can animate (no padding, margin, gap, box shadow or transform).
- **Reduce Motion reaches only the native animation engines.** Style transitions and `motion.div` snap to their targets; a JS `requestAnimationFrame` loop keeps running, and JS has no way to read the setting (no `matchMedia`).
- **`motion.div` animates numbers only**: `width`, `height`, `opacity`, `top`, `right`, `bottom`, `left`, `borderRadius`. There is no `x`, `y`, `scale`, `rotate`, colour or percentage target, and no other `motion.*` element.

## Strict style diagnostics

| Runtime | `strictStyles` default |
|---|---|
| Node or Bun with `NODE_ENV !== "production"` (includes Vitest) | on |
| `NODE_ENV=production` | off |
| `bun build --compile` executable | off |
| Browser bundle with no `process` | off |

Override with `render(<App />, { strictStyles })` or `createRoot(renderer, { strictStyles })` (`packages/react/src/reconciler/reconciler.ts`).

- **Field problems** (unknown key, bad keyword, bad colour, malformed length or transition): the field is dropped in both modes and its valid siblings still apply. In strict mode `console.warn` names the element, its `id`/`data-testid`, the property and the value, once per element and message. Tests read them with `renderer.drainStyleDiagnostics()`.
- **Prop-shape problems** throw in strict mode and warn once otherwise: a non-object `style` (arrays included), an uncompiled `className`, a `transition` on an element that cannot transition it.
- **Invalid `motion` targets** go to the Rust log only; the element keeps its declared style.

## Properties and values

| Property | Accepted values |
|---|---|
| `display` | `none`, `flex`, `grid` |
| `visibility` | `visible`, `hidden` |
| `flexDirection` | `row`, `column` (no `-reverse`) |
| `flexWrap` | `nowrap`, `wrap`, `wrap-reverse` |
| `flexGrow`, `flexShrink` | number ≥ 0 |
| `flexBasis` | number (px) |
| `alignItems`, `alignSelf`, `justifyItems`, `justifySelf` | `start`, `flex-start`, `center`, `end`, `flex-end`, `baseline`, `stretch` |
| `alignContent` | the above plus `normal`, `space-between`, `space-around`, `space-evenly` |
| `justifyContent` | as `alignContent` without `normal` and `stretch` |
| `gap`, `rowGap`, `columnGap` | number ≥ 0 |
| `gridTemplateColumns`, `gridTemplateRows` | array of track objects, not a CSS string: `[{ type: "fr", value: 1 }, { type: "px", value: 200 }]`; also `percent`, `auto`, `min-content`, `max-content`, `fit-content`, `minmax`, `repeat` (count or `auto-fill`/`auto-fit`) |
| `gridAutoRows`, `gridAutoColumns` | track objects without `repeat` |
| `gridColumn`, `gridRow`, `*Start`, `*End`, `gridArea` | `auto`, an integer, `span N`, `"a / b"`; no named lines or areas (#253) |
| `gridAutoFlow` | `row`, `column`, `dense`, `row dense`, `column dense` |
| `width`, `height`, `min*`, `max*` | see Lengths |
| `aspectRatio` | positive number or `"16 / 9"` |
| `padding*`, `margin*` | number; padding ≥ 0, margin may be negative |
| `position` | `relative`, `absolute`, `fixed` (lays out as `absolute`; the TS type omits it) |
| `top`, `right`, `bottom`, `left` | number |
| `opacity` | 0–1 |
| `overflow`, `overflowX`, `overflowY` | `visible`, `hidden`, `scroll`, `auto` (`auto` behaves as `scroll`); only `scroll`/`auto` make a ref scrollable |
| `clipPath` | `inset()` with 1–4 non-negative `px`, `%` or `0` values |
| `cursor` | 30 keywords (the `Cursor` type in `host.ts`); others dropped with a diagnostic |
| `pointerEvents` | `auto`, `none` |
| `userSelect` | `auto`, `text`, `none` (inherited) |
| `touchAction` | accepted and ignored |
| `selectionColor` | colour for selected text (inherited) |
| `interpolateSize` | `numeric-only`, `allow-keywords` (inherited) |
| `transition` | see Transitions; base style only |
| `hoverGroup`, `hoverWithinGroup` | string; base style only |
| State keys | `hover`, `hoverWithin`, `active`, `activeWithin`, `focus`, `focusVisible`, `focusWithin`, `dragOver`; one level deep |

## Lengths

A JSON number is px. The sizing properties (`width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`) also accept strings:

- `"<n>px"`, `"<n>%"`, `"<n>ch"` (advance of `0`), `"<n>vw"`, `"<n>vh"` (the window);
- `"auto"`, `"min-content"`, `"max-content"`, `"fit-content"`, `"fit-content(<length>)"`; the keywords are measured on `<div>` and `<text>` and behave as `auto` on other elements;
- `"calc(A + B)"` / `"calc(A - B)"`: exactly one spaced `+` or `-` between two lengths; no `*`, `/` or nesting;
- `"clamp(a, b, c)"`, separated by `", "` exactly (`clamp(1px,2px,3px)` is rejected).

There is no `rem`, `em`, `min()` or `max()`.

## Colours and backgrounds

Colour fields accept named colours, `transparent`, 3/4/6/8-digit hex, `rgb[a]()`, `hsl[a]()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `none` components, and limited relative-colour `from … calc()` forms (`packages/native/src/color.rs`; `color-functions.test.tsx`). Not accepted: `color()`, `currentColor`, `var()`, numbers. Values clip to sRGB.

`background` takes a colour, `linear-gradient(…)` with 2–8 stops, the single 135° `repeating-linear-gradient(135deg, <c> 0 <w>px, transparent <w>px <p>px)` hatch form, or `{ type: "linearGradient", angle, stops: [{ color, position }], colorSpace? }`. Radial and conic gradients and images are rejected.

## Borders and shadows

- `border`, `borderTop|Right|Bottom|Left`: `"<n>px <style> <colour>"` in any order, or `0`. `borderWidth` takes a number or a 1–4 value `px` string; the per-side widths take numbers.
- One colour and one style paint all sides. Two shorthands that disagree: the later is rejected with a diagnostic naming both (#404).
- `borderStyle`: the CSS set; `dotted` paints dashed and the 3D styles paint solid. A width with no style paints solid.
- `borderRadius` and the corner radii: numbers ≥ 0; no `%`.
- `boxShadow`: `{ offsetX, offsetY, blurRadius, spreadRadius, color, inset? }` or an array of them; `[]` means none. No CSS string. One bad layer rejects the whole list.
- `outlineColor`, `outlineWidth`, `outlineOffset` exist; there is no `outline` shorthand or `outlineStyle`.

## Text

| Property | Accepted values |
|---|---|
| `color` | colour (inherited) |
| `fontSize` | number > 0 (inherited) |
| `fontFamily` | string (inherited) |
| `fontWeight` | 1–1000, or `thin` … `black` (includes `semibold`); no `bolder`/`lighter` |
| `letterSpacing` | number |
| `lineHeight` | number or numeric string = multiple of the font size; `"<n>px"` = absolute; `> 0` |
| `textAlign` | `left`, `start`, `center`, `right` (no `end`, `justify`) |
| `textDecoration` | `underline`, `line-through`, `none` |
| `textTransform` | `none`, `uppercase`, `lowercase` |
| `whiteSpace` | `normal`, `nowrap`, `pre` (no `pre-wrap`) |
| `textWrap` | `wrap`, `nowrap` (no `balance`, `pretty`) |
| `textOverflow` | `ellipsis`, `ellipsis-start` |
| `lineClamp` | positive integer |
| `fontVariantNumeric` | `normal` or numeric-variant keywords (`tabular-nums` etc.) |
| `listStyle`, `listStyleType` | `none` only |

No user-agent styles apply: `h1` is not bold or large, `pre` needs `whiteSpace: "pre"`, `b`/`i`/`small` need explicit styles.

## State styles and hover groups

A state key holds a partial style applied while the state holds. Later entries in this list win when several apply: base → `focusWithin` → `focus` → `focusVisible` → `hoverWithin` → `hover` → `dragOver` → `activeWithin` → `active` (GPUI's refinement order).

- A state style cannot contain another state key, `transition`, `hoverGroup` or `hoverWithinGroup`.
- `hover`, `active` and `dragOver` cannot set `display: "none"`; the other states can hide or reveal an element.
- `focus` and `focusVisible` do not make an element focusable; give it `tabIndex`. `focusVisible` needs keyboard modality. `focusWithin` gives the element a focus handle without making it a Tab stop.
- `active` also applies while a focused element is activated with Space or Enter.
- `<virtual-list>` style has no `hover`, `active` or `dragOver`, but applies the `*Within` states.

**Hover groups** style a descendant from its ancestor's state, like `.card:hover .title`:

```tsx
<div style={{ hoverGroup: "card", padding: 12 }}>
  <text style={{ color: "#999", hoverWithinGroup: "card", hoverWithin: { color: "#fff" }, activeWithin: { color: "#8cf" } }}>
    Title
  </text>
</div>
```

With no `hoverWithinGroup`, any ancestor with a `hoverGroup` matches. With a name, only an ancestor with that name matches, and the nearest one wins. `activeWithin` uses the same groups.

There is no focus equivalent: no `focusWithinGroup` and no descendant style driven by an ancestor's focus (#670). `focusWithin` styles only the element that contains focus. To restyle a descendant while its ancestor contains focus, keep that state in React (from `onFocus`/`onBlur` on the focusable children, since focus events do not bubble) and set the descendant's `style` from it.

## `className` and `style` together

The element's style is the compiled class merged with `style`, `style` winning per property. A property set in `style` also removes that property from each of the class's state styles, so `style={{ backgroundColor }}` hides a class `:hover` background. A key whose value is `undefined` in `style` does not override the class. See `css-modules.md` for `className` itself.

## Transitions

`style.transition` animates changes to these properties only: `opacity`, `backgroundColor`, `color`, `borderColor`, `outlineColor`, `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `top`, `right`, `bottom`, `left`, `borderRadius` and the four corner radii.

Two forms:

```tsx
style={{ transition: "opacity 150ms ease-out, background-color 200ms" }}   // CSS shorthand, kebab-case names
style={{ transition: { properties: ["opacity", "backgroundColor"], durationMs: 150, easing: "easeOut" } }}
```

- Object `easing`: `linear`, `ease`, `easeIn`, `easeOut`, `easeInOut` (camelCase), a cubic-bezier 4-tuple, or `{ type: "spring", stiffness = 100, damping = 10, mass = 1, velocity = 0 }` (a spring ignores `durationMs`). `delayMs` is optional.
- String easings: `ease-in` etc. or `cubic-bezier(…)`; no springs. `none` disables. The TS type allows up to three comma-separated items; the runtime accepts more.
- `all`, unknown properties, unknown keys and duplicates reject the whole declaration.
- React-driven style changes and the `focus`, `focusVisible`, `hoverWithin`, `hover` and `active` states animate. An interrupted transition retargets from the painted value; a spring keeps its velocity.
- Mixed units (px ↔ %, `auto` ↔ px) step instead of interpolating, unless `interpolateSize: "allow-keywords"` lets `width`/`height` travel to or from `auto` and the intrinsic keywords on `<div>`/`<text>`.
- Colours blend in premultiplied sRGB.
- `<div>`, its aliases and `<text>` transition everything; `img`, `canvas`, `code`, `diff`, `markdown`, `input`, `textarea` and `anchored` transition everything except `color`; `<virtual-list>` cannot transition (diagnosed; throws in strict mode).

## `motion.div` and `AnimatePresence`

`motion` and `AnimatePresence` come from `@gpuix/react`.

```tsx
<AnimatePresence>
  {open && (
    <motion.div key="panel" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 240 }} exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }} />
  )}
</AnimatePresence>
```

- `initial` (a target or `false`, which mounts at `animate`), `animate` (required), `exit`, `transition`, `onMotionComplete`.
- `transition`: `duration` in seconds (default 0.3), `delay` (default 0), `ease` (default `easeOut`; the easing names, a 4-tuple, or a spring), `repeat` (integer or `Infinity`; each cycle restarts from the start value; ignored by springs).
- A new target starts from the visible value; a spring keeps its velocity.
- `AnimatePresence` keeps a removed **keyed** child mounted while its `motion.div` animates to `exit`, then removes it. A child without `exit`, a plain element, or an element relying on a style `transition` is removed at once. `initial={false}` skips the enter animation for children present at first render; `onExitComplete` fires when all exits finish. `usePresence()` returns `[false, safeToRemove]` while exiting, for custom exits; `useIsPresent()` returns a boolean.
- `MotionDivProps` does not declare `className`, `id`, `role`, ARIA props or `data-*`, so they fail type-checking.
- Missing: keyframes, variants, a separate exit transition, layout/`layoutId` animation (#409), scale and other transforms (#195), `mode="wait"`.

## Frame clock

`requestAnimationFrame` and `cancelAnimationFrame` are exported from `@gpuix/react`; they are globals only after `import "@gpuix/react/globals"`. In a browser they defer to the browser's own; natively they run on GPUI's display-paced clock with a `performance.now()`-compatible timestamp. A hot remount drops callbacks owned by the old tree. Native transitions and motion never use JS timers.

## Reduced motion

- The live renderer reads the OS setting at startup and follows changes: macOS `accessibilityDisplayShouldReduceMotion`, Windows `SPI_GETCLIENTAREAANIMATION`, Linux the XDG settings portal or GNOME `enable-animations`.
- With it on, style transitions and `motion.div` jump to their targets with no intermediate frames. App code does nothing to get this.
- `render(<App />, { reducedMotion: true | false })` overrides the OS for the app's lifetime. It is read when the window is created; a later `render()` (hot reload) does not change it. There is no runtime setter or getter.
- JS animation loops are not affected and cannot read the setting.
- Test windows ignore the OS; see `testing.md`.

## Shared web and native styles

`SharedStyle` (from `@gpuix/react`) is the intersection of React `CSSProperties` and `StyleDesc`, for helpers used by both a `react-dom` build and GPU-IX. It excludes state keys; widen with `Pick<StyleDesc, NativeStateStyleKey>` or add them at the GPU-IX call site. Object-shaped native values (`boxShadow` objects, grid track arrays, gradient objects) have no shared form. The CSS `transition` shorthand string is shared, within the transitionable properties.

## Open issues

| Issue | Gap |
|---|---|
| #481 | No `zIndex`; positioned elements paint in tree order. |
| #404 | No per-side border colour or style. |
| #253 | No `gridTemplateAreas` or named grid lines. |
| #195 | No transform or animated scale. |
| #409 | No `motion` layout or `layoutId` animation. |
