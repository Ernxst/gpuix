export type NormalizerFn = (content: string) => string

export interface DefaultNormalizerOptions {
  /** Strip leading and trailing whitespace. Defaults to true. */
  trim?: boolean
  /** Collapse runs of whitespace into a single space. Defaults to true. */
  collapseWhitespace?: boolean
}

export interface MatcherOptions extends DefaultNormalizerOptions {
  /** Full equality by default; false enables case-insensitive substring matching. */
  exact?: boolean
  /** Replaces the default trim-and-collapse-whitespace normalizer. */
  normalizer?: NormalizerFn
}

export type MatcherFunction<Element> = (content: string, element: Element) => boolean
export type Matcher<Element> = MatcherFunction<Element> | RegExp | number | string

/**
 * One test ID per element, as in Testing Library: the standard `data-testid`
 * attribute. Resolving per element rather than per tree is what keeps the
 * retained-tree queries and the automation locators counting the same nodes.
 */
export function resolveTestId(node: { dataTestId?: string }): string | undefined {
  return node.dataTestId
}

/** Testing Library's default normalizer, composable inside a custom one. */
export function getDefaultNormalizer({
  trim = true,
  collapseWhitespace = true,
}: DefaultNormalizerOptions = {}): NormalizerFn {
  return (content) => {
    let normalized = content
    if (trim) normalized = normalized.trim()
    if (collapseWhitespace) normalized = normalized.replace(/\s+/g, " ")
    return normalized
  }
}

/**
 * The normalizer a set of matcher options asks for, with Testing Library's rule
 * that a custom one replaces `trim`/`collapseWhitespace` rather than composing
 * with them.
 *
 * Exported so the jest-dom-shaped matchers normalize in the same one place the
 * queries do. `toHaveTextContent` does not share Testing Library's *matching*
 * rules — a bare string is a substring there — but it must share this.
 */
export function resolveNormalizer({
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
  const normalizedContent = resolveNormalizer(options)(content)

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
