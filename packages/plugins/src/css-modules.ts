import transformCssModule from "css-to-react-native-transform"
import postcss from "postcss"
import type { AcceptedPlugin } from "postcss"

type TransformCss = (css: string) => Record<string, unknown>

// The transform is CommonJS. Bun hands back the function; Node's interop hands
// back the module namespace, which a Vitest run or a Node bundler hits.
const transformCss: TransformCss =
  typeof transformCssModule === "function"
    ? (transformCssModule as TransformCss)
    : ((transformCssModule as { default: TransformCss }).default)

const SUPPORTED_PROPERTIES = new Set([
  "display",
  "visibility",
  "flexDirection",
  "flexWrap",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "alignItems",
  "alignSelf",
  "alignContent",
  "justifyContent",
  "gap",
  "rowGap",
  "columnGap",
  "gridTemplateColumns",
  "gridTemplateRows",
  "gridColumn",
  "gridRow",
  "gridColumnStart",
  "gridColumnEnd",
  "gridRowStart",
  "gridRowEnd",
  "gridArea",
  "gridAutoFlow",
  "gridAutoRows",
  "gridAutoColumns",
  "justifyItems",
  "justifySelf",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "aspectRatio",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "background",
  "backgroundColor",
  "color",
  "opacity",
  "border",
  "borderTop",
  "borderRight",
  "borderBottom",
  "borderLeft",
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderColor",
  "borderStyle",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "boxShadow",
  "outlineColor",
  "outlineWidth",
  "outlineOffset",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "letterSpacing",
  "fontVariantNumeric",
  "textDecoration",
  "listStyle",
  "listStyleType",
  "textTransform",
  "textAlign",
  "lineHeight",
  "whiteSpace",
  "textWrap",
  "textOverflow",
  "lineClamp",
  "overflow",
  "overflowX",
  "overflowY",
  "clipPath",
  "cursor",
  "pointerEvents",
  "touchAction",
  "userSelect",
  "selectionColor",
  "transition",
  "hoverGroup",
  "interpolateSize",
])

const NATIVE_STATE_PROPERTIES = new Set(
  [...SUPPORTED_PROPERTIES].filter(
    (property) => property !== "transition" && property !== "hoverGroup",
  ),
)
const CLASS_NAME = "[A-Za-z_][A-Za-z0-9_-]*"
const CLASS_SELECTOR = new RegExp(
  `^\\.(${CLASS_NAME})(?::(hover|active|focus|focus-visible|focus-within))?$`,
)
const HOVER_WITHIN_SELECTOR = new RegExp(
  `^\\.(${CLASS_NAME}):hover\\s+\\.(${CLASS_NAME})$`,
)

type CssModuleStyles = Record<string, Record<string, unknown>>
type CssModuleSelector =
  | { kind: "class"; name: string; pseudoClass?: string }
  | { kind: "hoverWithin"; ancestor: string; descendant: string }

/**
 * Convert the deliberately small CSS-module subset supported by the native
 * renderer into the shape accepted by its `style` prop.
 *
 * `css-to-react-native-transform` already handles class selectors, grouped
 * class selectors, camel-casing, and common CSS length shorthands. This
 * boundary removes its React Native-only metadata and rejects declarations
 * that GPUIX cannot apply instead of silently dropping them.
 */
export async function transformGpuixCssModule(
  css: string,
  sourceId: string,
  plugins: readonly AcceptedPlugin[] = [],
): Promise<CssModuleStyles> {
  const processed = await postcss(plugins).process(css, { from: sourceId })
  const preprocessed = postcss.parse(processed.css, { from: sourceId })
  // Custom properties provide values to the processor, not native styles.
  preprocessed.walkDecls(/^--/, (declaration) => {
    declaration.remove()
  })
  // A token rule is gone once its custom properties are, even when a comment
  // remains: `:root` has no native style representation and would be rejected.
  preprocessed.walkRules((rule) => {
    if (rule.nodes.every((node) => node.type === "comment")) rule.remove()
  })

  const root = validateSelectors(preprocessed.toString(), sourceId)
  const styles: CssModuleStyles = {}
  const hoverWithinRelations = new Map<string, { ancestor: string; selector: string }>()

  root.walkRules((rule) => {
    for (const selector of rule.selectors) {
      const trimmedSelector = selector.trim()
      const parsed = parseSelector(trimmedSelector)
      if (!parsed) continue // validateSelectors has already rejected this selector.

      if (parsed.kind === "hoverWithin") {
        const previousRelation = hoverWithinRelations.get(parsed.descendant)
        if (previousRelation && previousRelation.ancestor !== parsed.ancestor) {
          throw unsupportedCss(
            sourceId,
            `selector ${JSON.stringify(trimmedSelector)} conflicts with selector ${JSON.stringify(previousRelation.selector)}`,
          )
        }
        hoverWithinRelations.set(parsed.descendant, {
          ancestor: parsed.ancestor,
          selector: trimmedSelector,
        })
      }

      const name = parsed.kind === "class" ? parsed.name : parsed.descendant
      const pseudoClass = parsed.kind === "class" ? parsed.pseudoClass : undefined
      const state =
        parsed.kind === "hoverWithin"
          ? "hoverWithin"
          : pseudoClass === "focus-visible"
            ? "focusVisible"
            : pseudoClass === "focus-within"
              ? "focusWithin"
              : pseudoClass
      const transformed = transformCss(rule.clone({ selector: `.${name}` }).toString())
      const value = transformed[name]

      if (!isPlainObject(value)) {
        throw unsupportedCss(sourceId, `class ".${name}" did not produce a style object`)
      }

      const allowedProperties = state ? NATIVE_STATE_PROPERTIES : SUPPORTED_PROPERTIES
      const unsupported = Object.keys(value).find(
        (property) => !allowedProperties.has(property),
      )
      if (unsupported !== undefined) {
        throw unsupportedCss(
          sourceId,
          state
            ? `property "${unsupported}" is not supported by the native ${JSON.stringify(state)} style`
            : `property "${unsupported}" is not supported by the native style prop`,
        )
      }

      const classStyle = (styles[name] ??= {})
      if (state) {
        const previousState = classStyle[state]
        classStyle[state] = {
          ...(isPlainObject(previousState) ? previousState : {}),
          ...value,
        }
      } else {
        Object.assign(classStyle, value)
      }

      if (parsed.kind === "hoverWithin" && !("hoverGroup" in (styles[parsed.ancestor] ??= {}))) {
        styles[parsed.ancestor].hoverGroup = generatedHoverGroup(sourceId, parsed.ancestor)
      }
    }
  })

  return styles
}

function validateSelectors(css: string, sourceId: string): postcss.Root {
  const root = postcss.parse(css, { from: sourceId })

  root.walkAtRules((rule) => {
    throw unsupportedCss(sourceId, `at-rule "@${rule.name}" is not supported yet`)
  })

  root.walkRules((rule) => {
    for (const selector of rule.selectors) {
      if (!parseSelector(selector.trim())) {
        throw unsupportedCss(
          sourceId,
          `selector ${JSON.stringify(selector)} is not supported yet`,
        )
      }
    }
  })

  return root
}

function parseSelector(selector: string): CssModuleSelector | undefined {
  const classMatch = CLASS_SELECTOR.exec(selector)
  if (classMatch) {
    const [, name, pseudoClass] = classMatch
    return { kind: "class", name, pseudoClass }
  }

  const hoverWithinMatch = HOVER_WITHIN_SELECTOR.exec(selector)
  if (hoverWithinMatch) {
    const [, ancestor, descendant] = hoverWithinMatch
    return { kind: "hoverWithin", ancestor, descendant }
  }
}

function generatedHoverGroup(sourceId: string, className: string): string {
  return `gpuix-css-module:hover-group:${encodeURIComponent(sourceId)}:${className}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function unsupportedCss(sourceId: string, reason: string): Error {
  return new Error(`[gpuix] cannot use CSS module ${JSON.stringify(sourceId)}: ${reason}`)
}
