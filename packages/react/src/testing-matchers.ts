export type NormalizerFn = (content: string) => string

export interface NormalizerOptions {
  /** Strip leading and trailing whitespace. Defaults to true. */
  trim?: boolean
  /** Collapse runs of whitespace into a single space. Defaults to true. */
  collapseWhitespace?: boolean
}

export interface MatcherOptions extends NormalizerOptions {
  /** Full equality by default; false enables case-insensitive substring matching. */
  exact?: boolean
  /** Replaces the default trim-and-collapse-whitespace normalizer. */
  normalizer?: NormalizerFn
}

export type MatcherFunction<Element> = (content: string, element: Element) => boolean
export type Matcher<Element> = MatcherFunction<Element> | RegExp | number | string

/**
 * One test ID per element, as in Testing Library. `data-testid` is the standard
 * attribute, so it wins; the legacy `testId` prop only answers for elements that
 * carry no `data-testid`. Resolving per element rather than per tree is what
 * keeps the retained-tree queries and the automation locators counting the same
 * nodes on a tree that mixes both props.
 */
export function resolveTestId(node: {
  dataTestId?: string
  testId?: string
}): string | undefined {
  return node.dataTestId ?? node.testId
}

/** Testing Library's default normalizer, composable inside a custom one. */
export function getDefaultNormalizer({
  trim = true,
  collapseWhitespace = true,
}: NormalizerOptions = {}): NormalizerFn {
  return (content) => {
    let normalized = content
    if (trim) normalized = normalized.trim()
    if (collapseWhitespace) normalized = normalized.replace(/\s+/g, " ")
    return normalized
  }
}

function makeNormalizer({
  trim,
  collapseWhitespace,
  normalizer,
}: MatcherOptions): NormalizerFn {
  if (!normalizer) return getDefaultNormalizer({ trim, collapseWhitespace })

  if (trim !== undefined || collapseWhitespace !== undefined) {
    throw new Error(
      "trim and collapseWhitespace are not supported with a normalizer. " +
        "If you want to use the default trim and collapseWhitespace logic in your " +
        'normalizer, use "getDefaultNormalizer({trim, collapseWhitespace})" and ' +
        "compose that into your normalizer"
    )
  }

  return normalizer
}

/** Testing Library matcher semantics shared by retained-tree and automation queries. */
export function matches<Element>(
  content: string,
  element: Element,
  matcher: Matcher<Element>,
  options: MatcherOptions = {}
): boolean {
  const normalizedContent = makeNormalizer(options)(content)

  if (typeof matcher === "function") return matcher(normalizedContent, element)
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0
    const matched = matcher.test(normalizedContent)
    matcher.lastIndex = 0
    return matched
  }

  const expected = String(matcher)
  return options.exact === false
    ? normalizedContent.toLowerCase().includes(expected.toLowerCase())
    : normalizedContent === expected
}
