/// The props the retained tree keeps on the author's behalf, and the DOM
/// attribute names they answer to.
///
/// A leaf module on purpose. The reconciler writes these props and the matcher
/// pack reads them back, and the pack must not import the host config to do it:
/// that would pull the whole reconciler into `@gpuix/react/testing/matchers`.

/**
 * The DOM spelling of every supported ARIA attribute, and the prop key the
 * retained tree stores it under.
 *
 * The mapping is not mechanical — `aria-valuetext` is stored as `ariaValue` and
 * `aria-labelledby` as `ariaLabelledBy` — so both sides read this one table
 * rather than camel-casing and hoping.
 */
export const ARIA_PROP_ALIASES = {
  "aria-label": "ariaLabel",
  "aria-labelledby": "ariaLabelledBy",
  "aria-description": "ariaDescription",
  "aria-describedby": "ariaDescribedBy",
  "aria-checked": "ariaChecked",
  "aria-expanded": "ariaExpanded",
  "aria-current": "ariaCurrent",
  "aria-live": "ariaLive",
  "aria-atomic": "ariaAtomic",
  "aria-selected": "ariaSelected",
  "aria-valuetext": "ariaValue",
  "aria-valuemin": "ariaValueMin",
  "aria-valuemax": "ariaValueMax",
  "aria-valuenow": "ariaValueNow",
  "aria-level": "ariaLevel",
  "aria-rowindex": "ariaRowIndex",
  "aria-colindex": "ariaColIndex",
  "aria-rowcount": "ariaRowCount",
  "aria-colcount": "ariaColCount",
  "aria-rowspan": "ariaRowSpan",
  "aria-colspan": "ariaColSpan",
  "aria-disabled": "ariaDisabled",
  "aria-hidden": "ariaHidden",
} as const

/** DOM attribute names whose prop spelling differs outside the ARIA table. */
export const ATTRIBUTE_PROP_ALIASES = {
  for: "htmlFor",
} as const

/** `id` and `data-*`: the props that identify an element rather than style it. */
export function isIdentityProp(name: string): boolean {
  return name === "id" || name.startsWith("data-")
}

/**
 * HTML attributes an author can write on an element that the renderer builds as
 * a native div — `<a href>`, `<button type>` and their kin.
 *
 * A built-in type otherwise forwards only universal and identity props, which
 * left these declared in JSX and absent from the retained tree: the element
 * carried an `href` no query could see. They are retained so an attribute the
 * author wrote is an attribute the test surface can answer for. Names the fork
 * does not accept yet cost nothing here and keep the surface honest when it
 * does.
 */
export const HTML_ATTRIBUTE_PROPS = new Set([
  "alt",
  "download",
  "href",
  "htmlFor",
  "name",
  "placeholder",
  "rel",
  "src",
  "target",
  "title",
  "type",
  "value",
])

/**
 * The custom-prop key carrying the role the author wrote.
 *
 * `role` in the retained tree is the *resolved* role the accessibility
 * projection needs, implicit ones included, so an `<img>` carries `role: "img"`
 * with nothing declared. The DOM has no such attribute, so the authored role is
 * kept beside it and is what `toHaveAttribute("role")` reads.
 */
export const AUTHORED_ROLE_PROP = "authoredRole"

/** Props the retained tree keeps for the author, whatever the element type. */
export function isAuthorVisibleProp(name: string): boolean {
  return (
    isIdentityProp(name) || HTML_ATTRIBUTE_PROPS.has(name) || name === AUTHORED_ROLE_PROP
  )
}
