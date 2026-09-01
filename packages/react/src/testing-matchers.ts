export type NormalizerFn = (content: string) => string

export interface MatcherOptions {
  /** Full equality by default; false enables case-insensitive substring matching. */
  exact?: boolean
  /** Replaces the default trim-and-collapse-whitespace normalizer. */
  normalizer?: NormalizerFn
}

export type MatcherFunction<Element> = (content: string, element: Element) => boolean
export type Matcher<Element> = MatcherFunction<Element> | RegExp | number | string

const defaultNormalizer: NormalizerFn = (content) => content.trim().replace(/\s+/g, " ")

/** Testing Library matcher semantics shared by retained-tree and automation queries. */
export function matches<Element>(
  content: string,
  element: Element,
  matcher: Matcher<Element>,
  options: MatcherOptions = {}
): boolean {
  const normalizedContent = (options.normalizer ?? defaultNormalizer)(content)

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
