/// jest-dom-shaped matchers over the GPUIX test renderer.
///
/// Wire them up once, in a test setup file or at the top of a suite:
///
/// ```ts
/// import { expect } from "vitest"
/// import { gpuixMatchers } from "@gpuix/react/testing/matchers"
///
/// expect.extend(gpuixMatchers)
///
/// declare module "vitest" {
///   interface Matchers<T = any> extends GpuixMatchers<T> {}
/// }
/// ```
///
/// The pack is deliberately small. A matcher is here when it replaces an
/// assertion a test would otherwise have to spell out against the renderer, and
/// absent when the desktop has nothing for it to be about: `toBeChecked`,
/// `toHaveClass`, and `toBeEmptyDOMElement` were all judged low-value against
/// this tree and are not shipped.

import {
  matches as matchesMatcher,
  resolveNormalizer,
  type Matcher,
  type MatcherOptions,
} from "./testing-matchers.js"
import {
  describeElement,
  rendererOf,
  textContent,
  type AccessKitNodeSnapshot,
  type TestElement,
  type TestRenderer,
} from "./testing.js"

/** The normalization half of the matcher options; `exact` has no meaning here. */
export type TextContentOptions = Omit<MatcherOptions, "exact">

export type TextContentMatcher = Matcher<TestElement>

/** What a runner needs back from a matcher. Shaped for Vitest and Jest alike. */
export interface GpuixMatcherResult {
  pass: boolean
  message: () => string
}

/** The `this` a runner binds; only the negation flag is read. */
interface MatcherContext {
  isNot?: boolean
}

/**
 * The matcher surface, for the `declare module` augmentation a runner needs.
 *
 * `R` is the runner's return type — `void` under Vitest's `Matchers<T>`, a
 * promise under `expect(...).resolves`.
 */
export interface GpuixMatchers<R = unknown> {
  /** The element is still reachable in the renderer's retained tree. */
  toBeInTheDocument(): R
  /** The element painted a box in the last frame. See the caveats below. */
  toBeVisible(): R
  /** `disabled` or `ariaDisabled` is declared on the element. */
  toBeDisabled(): R
  /** The element holds the window's keyboard focus. */
  toHaveFocus(): R
  /** The element's text, plus every descendant's, contains or matches this. */
  toHaveTextContent(expected: TextContentMatcher, options?: TextContentOptions): R
  /** The element's retained `value` prop equals this exactly. */
  toHaveValue(expected: string): R
  /** The element's `value` prop matches, through the Testing Library matcher. */
  toHaveDisplayValue(expected: TextContentMatcher, options?: MatcherOptions): R
  /** The element's computed accessible name matches, or is non-empty. */
  toHaveAccessibleName(expected?: TextContentMatcher, options?: MatcherOptions): R
}

function asTestElement(received: unknown, matcher: string): TestElement {
  if (
    received === null ||
    typeof received !== "object" ||
    typeof (received as TestElement).id !== "number" ||
    typeof (received as TestElement).type !== "string"
  ) {
    throw new TypeError(
      `${matcher} expects a TestElement from a GPUIX test renderer, received ${
        received === null ? "null" : typeof received
      }`
    )
  }

  return received as TestElement
}

interface Resolved {
  renderer: TestRenderer
  /** The element as the renderer holds it *now*, not as it was captured. */
  element: TestElement
  describe: () => string
}

/**
 * Re-resolve an element against its renderer.
 *
 * `TestElement.children` and `parentElement` already re-resolve after a
 * rerender, so a matcher that read the captured snapshot instead would be the
 * one stale surface on the object.
 */
function resolve(received: unknown, matcher: string): Resolved {
  const captured = asTestElement(received, matcher)
  const renderer = rendererOf(captured)
  const element = renderer.getElement(captured.id)
  if (element === undefined) {
    throw new Error(
      `${matcher}: element #${captured.id} <${captured.type}> is no longer in the renderer's tree`
    )
  }

  return { renderer, element, describe: () => describeElement(renderer, element) }
}

function report(
  context: MatcherContext,
  pass: boolean,
  expectation: string,
  actual: string
): GpuixMatcherResult {
  return {
    pass,
    message: () =>
      `expected element ${context.isNot === true ? "not " : ""}to ${expectation}\n\n${actual}`,
  }
}

/** The AccessKit node projected from this element, if it has one. */
function accessibilityNodeOf(
  renderer: TestRenderer,
  element: TestElement
): AccessKitNodeSnapshot | undefined {
  const tree = renderer.getAccessibilityTree()
  return Object.values(tree.nodes).find((node) => node.host_id === element.id)
}

function describeMatcher(matcher: TextContentMatcher): string {
  if (typeof matcher === "function") return `[function ${matcher.name || "anonymous"}]`
  return matcher instanceof RegExp ? matcher.toString() : JSON.stringify(matcher)
}

/**
 * jest-dom-shaped matchers for `expect.extend`.
 *
 * Read the caveat on `toBeVisible` before using it: its honest meaning is
 * narrower than the DOM matcher of the same name.
 */
export const gpuixMatchers = {
  /**
   * Trivial sugar over the retained tree: the element's ID still resolves.
   *
   * The element map is built by walking from the root, so an unmounted or
   * detached element is absent — this is attachment, not mere existence.
   */
  toBeInTheDocument(this: MatcherContext, received: unknown): GpuixMatcherResult {
    const element = asTestElement(received, "toBeInTheDocument")
    const renderer = rendererOf(element)
    const current = renderer.getElement(element.id)

    return report(
      this,
      current !== undefined,
      "be in the document",
      current === undefined
        ? `  element #${element.id} <${element.type}> is not in the renderer's tree`
        : `  ${describeElement(renderer, current)}`
    )
  },

  /**
   * The element painted a box in the last frame.
   *
   * **This is not the DOM's visibility, and the difference matters.** Bounds
   * are recorded during paint and cleared at the start of every frame
   * (`bounds_frame_reset`), so "no bounds" means "nothing painted for this
   * element last frame" and nothing more. It conflates a row scrolled out of a
   * virtual list with `display: none`, and it says *nothing* about an element
   * that paints while fully transparent: `opacity: 0` is visible here and
   * hidden in a browser.
   *
   * Assert on the reason, not the pixel, when you need one of those apart.
   */
  toBeVisible(this: MatcherContext, received: unknown): GpuixMatcherResult {
    const { renderer, element, describe } = resolve(received, "toBeVisible")
    const bounds = renderer.getElementBounds(element.id)

    return report(
      this,
      bounds !== null,
      "have painted in the last frame",
      bounds === null
        ? `  ${describe()} painted no bounds`
        : `  ${describe()} painted [x=${bounds[0]}, y=${bounds[1]}, width=${bounds[2]}, height=${bounds[3]}]`
    )
  },

  /**
   * The element declares `disabled` or `ariaDisabled`.
   *
   * This is the element's own state. GPUIX has no disabling container — no
   * `<fieldset disabled>` — so unlike jest-dom there is no ancestor to inherit
   * from, and none is invented.
   */
  toBeDisabled(this: MatcherContext, received: unknown): GpuixMatcherResult {
    const { element, describe } = resolve(received, "toBeDisabled")
    const disabled = element.semantics?.disabled === true

    return report(this, disabled, "be disabled", `  ${describe()} is ${disabled ? "" : "not "}disabled`)
  },

  /**
   * The element holds the window's keyboard focus.
   *
   * Read from the window's own focus, the direct analogue of
   * `document.activeElement`, rather than from the accessibility snapshot's
   * `gpui_focus` — the snapshot only carries a node for an element that
   * projects accessibility semantics, so a focused plain `<input>` would be
   * invisible to it.
   */
  toHaveFocus(this: MatcherContext, received: unknown): GpuixMatcherResult {
    const { renderer, element, describe } = resolve(received, "toHaveFocus")
    const active = renderer.getActiveElement()
    const focused = active === null ? undefined : renderer.getElement(active)

    return report(
      this,
      active === element.id,
      "have focus",
      `  ${describe()}\n  focus is on ${
        focused === undefined ? "no element" : describeElement(renderer, focused)
      }`
    )
  },

  /**
   * The element's text plus every descendant's, like DOM `textContent`.
   *
   * jest-dom's matching rules, not the queries': a bare string is a
   * case-sensitive **substring**, a regular expression is tested, and a
   * function is a predicate. The normalization is the queries' — trimmed and
   * whitespace-collapsed by default, and `{ trim }`, `{ collapseWhitespace }`,
   * and `{ normalizer }` all apply.
   */
  toHaveTextContent(
    this: MatcherContext,
    received: unknown,
    expected: TextContentMatcher,
    options: TextContentOptions = {}
  ): GpuixMatcherResult {
    const { renderer, element, describe } = resolve(received, "toHaveTextContent")
    const content = resolveNormalizer(options)(textContent(renderer, element))
    const pass =
      typeof expected === "function"
        ? expected(content, element)
        : expected instanceof RegExp
          ? expected.test(content)
          : content.includes(String(expected))

    return report(
      this,
      pass,
      `have text content ${describeMatcher(expected)}`,
      `  ${describe()}\n  text content ${JSON.stringify(content)}`
    )
  },

  /**
   * The element's retained `value` prop, compared exactly.
   *
   * This is the raw prop with no normalization — the matcher for "the value is
   * exactly this string". Use `toHaveDisplayValue` for a regular expression, a
   * predicate, or normalized text.
   */
  toHaveValue(
    this: MatcherContext,
    received: unknown,
    expected: string
  ): GpuixMatcherResult {
    const { element, describe } = resolve(received, "toHaveValue")
    const value = element.semantics?.value

    return report(
      this,
      value === expected,
      `have value ${JSON.stringify(expected)}`,
      `  ${describe()}\n  value ${value === undefined ? "is not declared" : JSON.stringify(value)}`
    )
  },

  /**
   * The element's `value` prop through the Testing Library matcher, so strings
   * are exact after normalization and regular expressions, predicates, and
   * `{ exact: false }` all work as they do in the queries.
   */
  toHaveDisplayValue(
    this: MatcherContext,
    received: unknown,
    expected: TextContentMatcher,
    options: MatcherOptions = {}
  ): GpuixMatcherResult {
    const { element, describe } = resolve(received, "toHaveDisplayValue")
    const value = element.semantics?.value

    return report(
      this,
      value !== undefined && matchesMatcher(value, element, expected, options),
      `have display value ${describeMatcher(expected)}`,
      `  ${describe()}\n  value ${value === undefined ? "is not declared" : JSON.stringify(value)}`
    )
  },

  /**
   * The element's computed accessible name, from its AccessKit node.
   *
   * Called with no argument it asserts only that a name exists, as jest-dom
   * does. The name is GPUI's computation, so an element that projects no
   * accessibility node — no declared role and no name from contents — has no
   * accessible name to assert on, and this reports that rather than falling
   * back to the raw `ariaLabel` prop.
   */
  toHaveAccessibleName(
    this: MatcherContext,
    received: unknown,
    expected?: TextContentMatcher,
    options: MatcherOptions = {}
  ): GpuixMatcherResult {
    const { renderer, element, describe } = resolve(received, "toHaveAccessibleName")
    const name = accessibilityNodeOf(renderer, element)?.aria.label ?? ""
    const pass =
      expected === undefined
        ? name.length > 0
        : matchesMatcher(name, element, expected, options)

    return report(
      this,
      pass,
      expected === undefined
        ? "have an accessible name"
        : `have accessible name ${describeMatcher(expected)}`,
      `  ${describe()}\n  accessible name ${JSON.stringify(name)}`
    )
  },
}
