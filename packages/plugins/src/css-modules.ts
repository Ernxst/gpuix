import transformCssModule from "css-to-react-native-transform"
import postcss from "postcss"

const transformCss = transformCssModule as unknown as (
  css: string,
) => Record<string, unknown>

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
  "interpolateSize",
])

type CssModuleStyles = Record<string, Record<string, unknown>>

/**
 * Convert the deliberately small CSS-module subset supported by the native
 * renderer into the shape accepted by its `style` prop.
 *
 * `css-to-react-native-transform` already handles class selectors, grouped
 * class selectors, camel-casing, and common CSS length shorthands. This
 * boundary removes its React Native-only metadata and rejects declarations
 * that GPUIX cannot apply instead of silently dropping them.
 */
export function transformGpuixCssModule(css: string, sourceId: string): CssModuleStyles {
  validateSelectors(css, sourceId)

  const transformed = transformCss(css) as Record<string, unknown>
  const styles: CssModuleStyles = {}

  for (const [name, value] of Object.entries(transformed)) {
    if (name === "__viewportUnits") continue

    if (name.startsWith("@media ")) {
      throw unsupportedCss(sourceId, `media queries are not supported yet (${name})`)
    }

    if (!isPlainObject(value)) {
      throw unsupportedCss(sourceId, `class ".${name}" did not produce a style object`)
    }

    const unsupported = Object.keys(value).find(
      (property) => !SUPPORTED_PROPERTIES.has(property),
    )
    if (unsupported !== undefined) {
      throw unsupportedCss(
        sourceId,
        `property "${unsupported}" is not supported by the native style prop`,
      )
    }

    styles[name] = value
  }

  return styles
}

function validateSelectors(css: string, sourceId: string): void {
  const root = postcss.parse(css, { from: sourceId })

  root.walkAtRules((rule) => {
    throw unsupportedCss(sourceId, `at-rule "@${rule.name}" is not supported yet`)
  })

  root.walkRules((rule) => {
    for (const selector of rule.selectors) {
      if (!/^\.[A-Za-z_][A-Za-z0-9_-]*$/.test(selector.trim())) {
        throw unsupportedCss(
          sourceId,
          `selector ${JSON.stringify(selector)} is not supported yet`,
        )
      }
    }
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function unsupportedCss(sourceId: string, reason: string): Error {
  return new Error(`[gpuix] cannot use CSS module ${JSON.stringify(sourceId)}: ${reason}`)
}
