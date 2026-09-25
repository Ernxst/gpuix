import { readFile } from "node:fs/promises"
import path from "node:path"
import transformCssModule from "css-to-react-native-transform"
import postcss from "postcss"
import type { AcceptedPlugin } from "postcss"
import postcssCustomProperties from "postcss-custom-properties"
import postcssImport from "postcss-import"
import postcssNesting from "postcss-nesting"

type TransformCss = (css: string) => Record<string, unknown>
export type CssImportResolver = (
  id: string,
  importer: string,
) => Promise<string | undefined> | string | undefined

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
  "hoverWithinGroup",
  "interpolateSize",
])

const NATIVE_STATE_PROPERTIES = new Set(
  [...SUPPORTED_PROPERTIES].filter(
    (property) =>
      property !== "transition" &&
      property !== "hoverGroup" &&
      property !== "hoverWithinGroup",
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

type StyleContribution = { className: string; style: Record<string, unknown> }
type Composition = {
  classes: string[]
  from?: string
  declaration: string
  importer: string
}
type ParsedCssModule = {
  sourceId: string
  classNames: Set<string>
  contributions: StyleContribution[]
  compositions: Map<string, Composition[]>
}
type CompositionContext = {
  plugins: readonly AcceptedPlugin[]
  resolveImport?: CssImportResolver
  watchImport?: (file: string) => void
  modules: Map<string, Promise<ParsedCssModule>>
}

const STATE_STYLE_KEYS = new Set([
  "hover",
  "active",
  "focus",
  "focusVisible",
  "focusWithin",
  "hoverWithin",
])

/**
 * The PostCSS plugins the native transform cannot do without.
 *
 * `@import` and every other at-rule fails validation, nested rules do not parse
 * at all, and custom properties are removed rather than substituted, so a CSS
 * module written the way its web counterpart is needs all three of these before
 * GPUIX sees it. `preserve: false` keeps the resolved value from sitting beside
 * a second `var()` declaration.
 *
 * Order matters twice: imports are inlined before the rules and custom
 * properties they carry are in scope, and nesting is flattened before `var()`
 * substitution walks the declarations that remain.
 */
function defaultCssModulePlugins(resolveImport?: CssImportResolver): AcceptedPlugin[] {
  const imports = resolveImport
    ? postcssImport({
        // postcss-import passes the current at-rule as a fourth argument. Its
        // published types omit it, so keep this optional for that signature.
        resolve: async (id, basedir, _options, atRule?: postcss.AtRule) => {
          const importer = atRule?.source?.input?.file ?? path.join(basedir, "index.css")
          const resolved = await resolveImport(id, importer)
          // Package `main` can point at JavaScript while its `style` field points
          // at CSS. Let postcss-import retain its CSS-aware package lookup then.
          return !resolved || /\.[cm]?[jt]sx?$/i.test(resolved) ? id : resolved
        },
      })
    : postcssImport()
  return [imports, postcssNesting(), postcssCustomProperties({ preserve: false })]
}

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
  resolveImport?: CssImportResolver,
  watchImport?: (file: string) => void,
): Promise<CssModuleStyles> {
  const context: CompositionContext = {
    plugins,
    resolveImport,
    watchImport,
    modules: new Map(),
  }
  const module = await parseCssModule(css, sourceId, context)
  context.modules.set(sourceId, Promise.resolve(module))

  const styles: CssModuleStyles = {}
  for (const className of module.classNames) {
    styles[className] = await resolveComposedClass(module, className, [], context)
  }
  return styles
}

async function parseCssModule(
  css: string,
  sourceId: string,
  context: CompositionContext,
): Promise<ParsedCssModule> {
  const processed = await postcss([
    ...defaultCssModulePlugins(context.resolveImport),
    ...context.plugins,
  ]).process(css, {
    from: sourceId,
  })
  for (const message of processed.messages) {
    if (message.type === "dependency" && message.plugin === "postcss-import") {
      context.watchImport?.(message.file)
    }
  }
  // Keep PostCSS's imported nodes so declarations retain the file they came
  // from. `composes` is resolved relative to that declaring stylesheet.
  const preprocessed = processed.root
  // Custom properties provide values to the processor, not native styles.
  preprocessed.walkDecls(/^--/, (declaration) => {
    declaration.remove()
  })
  // A token rule is gone once its custom properties are, even when a comment
  // remains: `:root` has no native style representation and would be rejected.
  preprocessed.walkRules((rule) => {
    if (rule.nodes.every((node) => node.type === "comment")) rule.remove()
  })

  const compositions = new Map<string, Composition[]>()
  preprocessed.walkRules((rule) => {
    const declarations: postcss.Declaration[] = []
    rule.walkDecls(/^composes$/i, (declaration) => {
      declarations.push(declaration)
    })
    if (declarations.length === 0) return

    const selectors = rule.selectors.map((selector) => parseSelector(selector.trim()))
    if (
      selectors.length !== 1 ||
      selectors[0]?.kind !== "class" ||
      selectors[0].pseudoClass !== undefined
    ) {
      throw unsupportedCss(
        sourceId,
        `declaration ${JSON.stringify(declarations[0]?.toString())} must be in a single local class rule`,
      )
    }

    const className = selectors[0].name
    const classCompositions = compositions.get(className) ?? []
    for (const declaration of declarations) {
      classCompositions.push(parseComposition(declaration, sourceId))
      declaration.remove()
    }
    compositions.set(className, classCompositions)
  })

  const root = validateSelectors(preprocessed, sourceId)
  const classNames = new Set<string>()
  const contributions: StyleContribution[] = []
  const accumulatedStyles: CssModuleStyles = {}
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
      classNames.add(name)
      const pseudoClass = parsed.kind === "class" ? parsed.pseudoClass : undefined
      const state =
        parsed.kind === "hoverWithin"
          ? "hoverWithin"
          : pseudoClass === "focus-visible"
            ? "focusVisible"
            : pseudoClass === "focus-within"
              ? "focusWithin"
              : pseudoClass
      const transformRule = rule.clone({ selector: `.${name}` })
      transformRule.walkDecls(/^composes$/i, (declaration) => {
        declaration.remove()
      })
      let explicitLineHeight: string | undefined
      transformRule.walkDecls("line-height", (declaration) => {
        if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(declaration.value)) {
          explicitLineHeight = declaration.value
          declaration.value += "px"
        } else {
          explicitLineHeight = /^[+-]?(?:\d+\.?\d*|\.\d+)px$/i.test(declaration.value)
            ? declaration.value
            : undefined
        }
      })
      const hasDeclarations = transformRule.nodes?.some((node) => node.type === "decl") ?? false
      const transformed = hasDeclarations ? transformCss(transformRule.toString()) : {}
      const value = hasDeclarations ? transformed[name] : {}

      if (!isPlainObject(value)) {
        throw unsupportedCss(sourceId, `class ".${name}" did not produce a style object`)
      }
      if (explicitLineHeight !== undefined) value.lineHeight = explicitLineHeight

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

      const contribution = state ? { [state]: value } : value
      contributions.push({ className: name, style: contribution })
      mergeStyle(accumulatedStyles[name] ??= {}, contribution)

      if (parsed.kind === "hoverWithin") {
        classNames.add(parsed.ancestor)
        const ancestorStyle = accumulatedStyles[parsed.ancestor] ??= {}
        if (!("hoverGroup" in ancestorStyle)) {
          const generatedGroup = {
            hoverGroup: generatedHoverGroup(sourceId, parsed.ancestor),
          }
          contributions.push({ className: parsed.ancestor, style: generatedGroup })
          mergeStyle(ancestorStyle, generatedGroup)
        }
      }
    }
  })

  // Bind the descendant state to the marker on its matching ancestor. The
  // marker may be declared after the relation, so derive it after all rules
  // have contributed in stylesheet order.
  for (const [descendant, { ancestor }] of hoverWithinRelations) {
    const hoverGroup = accumulatedStyles[ancestor]?.hoverGroup
    if (typeof hoverGroup !== "string") continue

    const descendantStyle = accumulatedStyles[descendant] ??= {}
    if ("hoverWithinGroup" in descendantStyle) continue

    const binding = { hoverWithinGroup: hoverGroup }
    contributions.push({ className: descendant, style: binding })
    mergeStyle(descendantStyle, binding)
  }

  for (const className of compositions.keys()) classNames.add(className)
  return { sourceId, classNames, contributions, compositions }
}

function parseComposition(declaration: postcss.Declaration, sourceId: string): Composition {
  const source = declaration.value.trim()
  const description = declaration.toString()
  if (/(?:^|\s)from\s+global\s*$/i.test(source)) {
    throw unsupportedCss(sourceId, `declaration ${JSON.stringify(description)} cannot use "from global"`)
  }

  const quotedSource = /^(.*?)\s+from\s+(?:"([^"]+)"|'([^']+)')\s*$/.exec(source)
  const hasFromClause = /\s+from\s+/i.test(source)
  if (hasFromClause && !quotedSource) {
    throw unsupportedCss(sourceId, `declaration ${JSON.stringify(description)} has an invalid from clause`)
  }

  const classList = (quotedSource?.[1] ?? source).trim()
  const classes = classList.split(/\s+/)
  if (classes.length === 0 || classes.some((name) => !new RegExp(`^${CLASS_NAME}$`).test(name))) {
    throw unsupportedCss(sourceId, `declaration ${JSON.stringify(description)} has an invalid class name`)
  }

  return {
    classes,
    from: quotedSource?.[2] ?? quotedSource?.[3],
    declaration: description,
    importer: declaration.source?.input.file ?? sourceId,
  }
}

async function resolveComposedClass(
  module: ParsedCssModule,
  className: string,
  chain: string[],
  context: CompositionContext,
): Promise<Record<string, unknown>> {
  const key = compositionKey(module.sourceId, className)
  const cycleStart = chain.indexOf(key)
  if (cycleStart !== -1) {
    const cycle = [...chain.slice(cycleStart), key].map(formatCompositionKey)
    throw unsupportedCss(module.sourceId, `composition cycle: ${cycle.join(" -> ")}`)
  }
  if (!module.classNames.has(className)) {
    throw unsupportedCss(module.sourceId, `class ".${className}" does not exist`)
  }

  const includedLocalClasses = new Set<string>()
  const visitedLocalClasses = new Set<string>()
  const externalStyles: Array<{ style: Record<string, unknown>; sourceKey: string }> = []
  const externalKeys = new Set<string>()

  const collect = async (localClassName: string, localChain: string[]): Promise<void> => {
    const localKey = compositionKey(module.sourceId, localClassName)
    const localCycleStart = localChain.indexOf(localKey)
    if (localCycleStart !== -1) {
      const cycle = [...localChain.slice(localCycleStart), localKey].map(formatCompositionKey)
      throw unsupportedCss(module.sourceId, `composition cycle: ${cycle.join(" -> ")}`)
    }
    if (visitedLocalClasses.has(localClassName)) return
    if (!module.classNames.has(localClassName)) {
      throw unsupportedCss(module.sourceId, `class ".${localClassName}" does not exist`)
    }

    visitedLocalClasses.add(localClassName)
    includedLocalClasses.add(localClassName)
    const compositionChain = [...localChain, localKey]
    for (const composition of module.compositions.get(localClassName) ?? []) {
      if (composition.from === undefined) {
        for (const composedClass of composition.classes) {
          if (!module.classNames.has(composedClass)) {
            throw unsupportedCss(
              module.sourceId,
              `declaration ${JSON.stringify(composition.declaration)} references missing class ".${composedClass}"`,
            )
          }
          await collect(composedClass, compositionChain)
        }
        continue
      }

      const composedModule = await loadComposedModule(
        composition.from,
        composition.importer,
        composition,
        context,
      )
      for (const composedClass of composition.classes) {
        const externalKey = compositionKey(composedModule.sourceId, composedClass)
        if (externalKeys.has(externalKey)) continue
        if (!composedModule.classNames.has(composedClass)) {
          throw unsupportedCss(
            module.sourceId,
            `declaration ${JSON.stringify(composition.declaration)} references missing class ".${composedClass}" in ${JSON.stringify(composedModule.sourceId)}`,
          )
        }
        externalKeys.add(externalKey)
        externalStyles.push({
          style: await resolveComposedClass(
            composedModule,
            composedClass,
            compositionChain,
            context,
          ),
          sourceKey: externalKey,
        })
      }
    }
  }

  await collect(className, chain)
  const style: Record<string, unknown> = {}
  const metadataSources = new Map<string, string>()
  for (const { style: externalStyle, sourceKey } of externalStyles) {
    mergeCompositionStyle(
      style,
      externalStyle,
      module.sourceId,
      className,
      sourceKey,
      metadataSources,
    )
  }
  for (const contribution of module.contributions) {
    if (includedLocalClasses.has(contribution.className)) {
      mergeCompositionStyle(
        style,
        contribution.style,
        module.sourceId,
        className,
        compositionKey(module.sourceId, contribution.className),
        metadataSources,
      )
    }
  }
  return style
}

async function loadComposedModule(
  specifier: string,
  importer: string,
  composition: Composition,
  context: CompositionContext,
): Promise<ParsedCssModule> {
  let sourceId: string | undefined
  try {
    sourceId = context.resolveImport
      ? await context.resolveImport(specifier, importer)
      : path.resolve(path.dirname(importer), specifier)
  } catch (error) {
    throw unsupportedCss(
      importer,
      `declaration ${JSON.stringify(composition.declaration)} could not resolve ${JSON.stringify(specifier)}: ${String(error)}`,
    )
  }
  if (!sourceId) {
    throw unsupportedCss(
      importer,
      `declaration ${JSON.stringify(composition.declaration)} could not resolve ${JSON.stringify(specifier)}`,
    )
  }

  const cached = context.modules.get(sourceId)
  if (cached) return cached

  const loading = (async () => {
    context.watchImport?.(sourceId!)
    let css: string
    try {
      css = await readFile(sourceId!, "utf8")
    } catch (error) {
      throw unsupportedCss(
        importer,
        `declaration ${JSON.stringify(composition.declaration)} could not read ${JSON.stringify(sourceId)}: ${String(error)}`,
      )
    }
    return parseCssModule(css, sourceId!, context)
  })()
  context.modules.set(sourceId, loading)
  return loading
}

function compositionKey(sourceId: string, className: string): string {
  return `${sourceId}\0${className}`
}

function formatCompositionKey(key: string): string {
  const separator = key.lastIndexOf("\0")
  return `${key.slice(0, separator)}#.${key.slice(separator + 1)}`
}

function mergeStyle(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [property, value] of Object.entries(source)) {
    const previous = target[property]
    if (STATE_STYLE_KEYS.has(property) && isPlainObject(previous) && isPlainObject(value)) {
      target[property] = { ...previous, ...value }
    } else {
      target[property] = value
    }
  }
}

function mergeCompositionStyle(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  sourceId: string,
  className: string,
  sourceKey: string,
  metadataSources: Map<string, string>,
): void {
  for (const property of ["hoverGroup", "hoverWithinGroup"] as const) {
    if (property in target && property in source && target[property] !== source[property]) {
      if (metadataSources.get(property) !== sourceKey) {
        throw unsupportedCss(
          sourceId,
          `class ".${className}" cannot compose conflicting ${JSON.stringify(property)} values`,
        )
      }
    }
  }
  mergeStyle(target, source)
  for (const property of ["hoverGroup", "hoverWithinGroup"] as const) {
    if (property in source) metadataSources.set(property, sourceKey)
  }
}

function validateSelectors(root: postcss.Root, sourceId: string): postcss.Root {
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
