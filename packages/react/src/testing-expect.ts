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
/// absent when the desktop has nothing for it to be about: `toBeChecked` and
/// `toHaveClass` were both judged low-value against this tree and are not
/// shipped.

import {
  matches as matchesMatcher,
  resolveNormalizer,
  type Matcher,
  type MatcherOptions,
} from "./testing-matchers.js"
import {
  accessibleNameOf,
  computedRoleOf,
  describeElement,
  matchesComputedRole,
  rendererOf,
  textContent,
  type AccessKitNodeSnapshot,
  type TestElement,
  type TestRenderer,
} from "./testing.js"
import { toMatchScreenshot, type ToMatchScreenshotOptions } from "./testing-screenshot.js"
import { TEXT_EDITING_TYPES } from "./reconciler/text-editing.js"
import {
  ARIA_PROP_ALIASES,
  ATTRIBUTE_PROP_ALIASES,
  AUTHORED_ROLE_PROP,
} from "./reconciler/aria-props.js"

export { configureScreenshots } from "./testing-screenshot.js"
export type {
  ConfigureScreenshotsOptions,
  ResolveScreenshotPath,
  ScreenshotComparatorOptions,
  ScreenshotPathContext,
  ToMatchScreenshotOptions,
} from "./testing-screenshot.js"

/** The normalization half of the matcher options; `exact` has no meaning here. */
export type TextContentOptions = Omit<MatcherOptions, "exact">

export type TextContentMatcher = Matcher<TestElement>

type AriaAttributeName = keyof typeof ARIA_PROP_ALIASES
type AliasedAttributeName = keyof typeof ATTRIBUTE_PROP_ALIASES

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
  /**
   * The element is still reachable in the renderer's retained tree. Negated,
   * it also accepts the `null` a `queryBy…` returns when nothing matched.
   */
  toBeInTheDocument(): R
  /** The element painted a box in the last frame. See the caveats below. */
  toBeVisible(): R
  /** `disabled` or `ariaDisabled` is declared on the element. */
  toBeDisabled(): R
  /** The element has no children and no text of its own. */
  toBeEmptyDOMElement(): R
  /** The element holds the window's keyboard focus. */
  toHaveFocus(): R
  /** The element's text, plus every descendant's, contains or matches this. */
  toHaveTextContent(expected: TextContentMatcher, options?: TextContentOptions): R
  /** The element's current value equals this exactly. */
  toHaveValue(expected: string): R
  /** The element's current value matches, through the Testing Library matcher. */
  toHaveDisplayValue(expected: TextContentMatcher, options?: MatcherOptions): R
  /** The element's computed accessible name matches, or is non-empty. */
  toHaveAccessibleName(expected?: TextContentMatcher, options?: MatcherOptions): R
  /** The element's computed role — explicit, or implicit where none is authored. */
  toHaveRole(role: string): R
  /**
   * The attribute is declared on the element, with this text if one is given.
   * `getAttribute` semantics: names are case-insensitive and values are text.
   */
  toHaveAttribute(name: string, value?: string): R
  /**
   * The window — or the element's box within it — matches its stored golden.
   *
   * The one asynchronous matcher here, as vitest browser mode's is: it must be
   * awaited, `await expect(screen).toMatchScreenshot('built')`.
   */
  toMatchScreenshot(options?: ToMatchScreenshotOptions): Promise<R>
  toMatchScreenshot(name?: string, options?: ToMatchScreenshotOptions): Promise<R>
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

/**
 * Run a matcher against an element re-resolved from its renderer.
 *
 * Two failure modes are deliberately different. A receiver that was never a
 * `TestElement` **throws**: no assertion about it could mean anything, and a
 * quiet `pass: false` would let `.not.toBeVisible()` "pass" on a typo. An
 * element that is no longer in the tree **fails**, because a removed node is
 * precisely what `.not.toBeVisible()` and `.not.toHaveFocus()` are asked
 * about, and jest-dom answers a detached node with `pass: false` too. Throwing
 * there made the negated form unusable after an unmount.
 *
 * The re-resolution itself matters because `TestElement.children` and
 * `parentElement` already re-resolve after a rerender; a matcher reading the
 * captured snapshot would be the one stale surface on the object.
 */
function against(
  context: MatcherContext,
  received: unknown,
  matcher: string,
  expectation: string,
  read: (resolved: Resolved) => { pass: boolean; actual: string }
): GpuixMatcherResult {
  const captured = asTestElement(received, matcher)
  const renderer = rendererOf(captured)
  const element = renderer.getElement(captured.id)
  if (element === undefined) {
    return report(
      context,
      false,
      expectation,
      `  element #${captured.id} <${captured.type}> is no longer in the renderer's tree`
    )
  }

  const { pass, actual } = read({
    renderer,
    element,
    describe: () => describeElement(renderer, element),
  })

  return report(context, pass, expectation, actual)
}

/**
 * The AccessKit node projected from this element, if it has one.
 *
 * An element that both carries a role and paints text projects two: its own,
 * and the static-text node its painted string reaches AccessKit as — the same
 * pair `<p>Hi</p>` makes in the DOM. An element-level assertion is about the
 * element's own node, so a static-text node is only the fallback, which is what
 * a plain `<span>Hello</span>` has and nothing else.
 */
function accessibilityNodeOf(
  renderer: TestRenderer,
  element: TestElement
): AccessKitNodeSnapshot | undefined {
  const nodes = accessibilityNodesOf(renderer, element)
  return nodes.find((node) => node.aria.role !== "Label") ?? nodes[0]
}

/**
 * Every AccessKit node this element projects, in tree order.
 *
 * Usually one, or none at all. The pair described above is why this exists: a
 * role query walks every node, so a question about *which roles an element
 * has* must walk them too, or the matcher and `getByRole` would answer
 * differently about the same element.
 */
function accessibilityNodesOf(
  renderer: TestRenderer,
  element: TestElement
): AccessKitNodeSnapshot[] {
  return Object.values(renderer.getAccessibilityTree().nodes).filter(
    (node) => node.host_id === element.id
  )
}

/**
 * The value a browser would report for this element.
 *
 * For a text-editing host — `<input>`, `<textarea>` — that is the editor's own
 * buffer, so text the user typed and an imperative `ref.value = x` write are
 * both seen, exactly as `HTMLInputElement.value` sees them.
 *
 * The buffer read crosses to native and forces a draw — milliseconds, against
 * microseconds for the retained tree — so only those two types pay it. Nothing
 * else has a buffer to read: they are the only types that register a text
 * editing state, and a `<div>` would spend the draw to be told `null`.
 *
 * The `??` still matters for an `<input>` whose editor was never materialised —
 * an off-screen `<virtual-list>` row, say, which is in the retained tree with
 * its declared `value` but has built no editor to hold one. There the prop is
 * the only value there is, and it is the right answer.
 */
function currentValue(renderer: TestRenderer, element: TestElement): string | undefined {
  if (!TEXT_EDITING_TYPES.has(element.type)) return element.semantics?.value
  return renderer.getInputValue(element.id) ?? element.semantics?.value
}

/**
 * The prop a content-from-a-prop host renders, where it has one.
 *
 * Three host types take their whole content as a prop rather than as children,
 * so the retained tree shows them with no children and no text however much
 * they paint. Anything else answers `undefined` and is judged by its tree.
 */
const CONTENT_PROPS: Readonly<Record<string, string>> = {
  code: "code",
  diff: "patch",
  markdown: "source",
}

function declaredContent(
  element: TestElement
): { prop: string; value: string } | undefined {
  if (!Object.hasOwn(CONTENT_PROPS, element.type)) return undefined
  const prop = CONTENT_PROPS[element.type]!
  const value = element.customProps?.[prop]
  return { prop, value: typeof value === "string" ? value : "" }
}

/** One resolved attribute: the prop key holding it, and the declared value. */
interface DeclaredAttribute {
  key: string
  value: unknown
}

/** A prop read that cannot be fooled by `Object.prototype`. */
function ownProp(
  props: Record<string, unknown> | undefined,
  key: string
): DeclaredAttribute | undefined {
  if (props === undefined) return undefined
  if (Object.hasOwn(props, key)) return { key, value: props[key] }
  // Attribute names are case-insensitive in an HTML document, and the props
  // behind them are not: `tabindex` has to find `tabIndex`.
  const lowered = key.toLowerCase()
  const match = Object.keys(props).find((candidate) => candidate.toLowerCase() === lowered)
  return match === undefined ? undefined : { key: match, value: props[match] }
}

/**
 * Custom-prop keys that are the renderer's bookkeeping, not an author's
 * attribute, and so answer for no attribute name at all.
 *
 * Both are written by the reconciler rather than declared in JSX:
 * `activationKind` records how the element is activated, and the authored role
 * is the sibling of the resolved one that `role` already answers with. Reading
 * them through their own names would turn an implementation detail into an
 * attribute a test could assert on.
 */
const RENDERER_BOOKKEEPING_PROPS: readonly string[] = [AUTHORED_ROLE_PROP, "activationKind"]

/**
 * The prop holding the attribute of this name, if the element declares one.
 *
 * Attributes live in the retained tree as the props the reconciler sent, and
 * three names do not survive the trip verbatim: the author's `id` is lifted out
 * of the custom-prop map onto the element, every `aria-*` attribute is stored
 * under the camelCase prop it aliases (`aria-labelledby` as `ariaLabelledBy`),
 * and `role` is stored twice — the resolved role the accessibility projection
 * needs, and the authored one, which is the attribute. Each translation reads
 * the same table the reconciler wrote with.
 */
function declaredAttribute(element: TestElement, name: string): DeclaredAttribute | undefined {
  const lowered = name.toLowerCase()
  if (lowered === "id") {
    return element.authorId === undefined ? undefined : { key: "id", value: element.authorId }
  }
  if (lowered === "role") return ownProp(element.customProps, AUTHORED_ROLE_PROP)
  if (Object.hasOwn(ARIA_PROP_ALIASES, lowered)) {
    return ownProp(element.customProps, ARIA_PROP_ALIASES[lowered as AriaAttributeName])
  }
  if (Object.hasOwn(ATTRIBUTE_PROP_ALIASES, lowered)) {
    return ownProp(element.customProps, ATTRIBUTE_PROP_ALIASES[lowered as AliasedAttributeName])
  }
  if (RENDERER_BOOKKEEPING_PROPS.some((key) => key.toLowerCase() === lowered)) return undefined
  return ownProp(element.customProps, lowered)
}

/**
 * The text `getAttribute` would return for a declared value: `undefined` where
 * it would return `null`, and `null` where the attribute is there but holds no
 * text a document could have held.
 *
 * An attribute is text in a document, so a declared number is its digits. A
 * boolean follows the two rules HTML has for one: `aria-*` and `data-*` carry
 * the words `"true"` and `"false"`, and every other attribute is present or
 * absent, with present reading as the empty string — `<div disabled>` has
 * `disabled=""`, and `disabled={false}` has no attribute at all.
 *
 * An object is the `null` case, and `<img src={{ kind: "data", bytes }}>` is
 * why: the value is a desktop image source with no text form, so the attribute
 * answers the presence question and nothing more. Stringifying it would compare
 * every such assertion against `"[object Object]"`, which is a value no test
 * meant and no browser would ever have shown.
 */
function attributeText({ key, value }: DeclaredAttribute): string | null | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "object") return null
  if (typeof value !== "boolean") return String(value)
  if (key.startsWith("aria") || key.startsWith("data-")) return String(value)
  return value ? "" : undefined
}

/**
 * Attribute names this tree cannot answer for, and why, rather than a quiet
 * "absent" that reads as a passing negative assertion about nothing.
 *
 * `class` has no equivalent here at all. `autoFocus` does — it is declared in
 * JSX and acted on — but the retained tree lifts it onto the element as a flag
 * and never keeps it as a prop, so the honest answer is that this matcher
 * cannot see it, not that the element lacks it.
 */
const UNANSWERABLE_ATTRIBUTES: Readonly<Record<string, string>> = {
  class:
    "GPUIX elements have no class attribute. Style them with the `style` prop " +
    "and assert on `TestElement.style`, or mark them with `data-*` and assert on that.",
  classname:
    "GPUIX elements have no class attribute. Style them with the `style` prop " +
    "and assert on `TestElement.style`, or mark them with `data-*` and assert on that.",
  autofocus:
    "autoFocus is lifted onto the element as a flag and is not retained as an " +
    "attribute, so no answer here would be honest. Assert the effect instead, " +
    "with toHaveFocus().",
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
   *
   * This is the one matcher that takes `null`, and only when negated, exactly
   * as jest-dom does: `queryBy…` answers `null` when nothing matched, and
   * `expect(screen.queryByText('gone')).not.toBeInTheDocument()` is the
   * assertion that result exists to state. The positive form still rejects it —
   * `null` names no element that could be in the document — and every other
   * matcher rejects it in both forms.
   */
  toBeInTheDocument(this: MatcherContext, received: unknown): GpuixMatcherResult {
    if (received === null && this.isNot === true) {
      return report(this, false, "be in the document", "  received null")
    }

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
    return against(
      this,
      received,
      "toBeVisible",
      "have painted in the last frame",
      ({ renderer, element, describe }) => {
        const bounds = renderer.getElementBounds(element.id)
        return {
          pass: bounds !== null,
          actual:
            bounds === null
              ? `  ${describe()} painted no bounds`
              : `  ${describe()} painted [x=${bounds[0]}, y=${bounds[1]}, width=${bounds[2]}, height=${bounds[3]}]`,
        }
      }
    )
  },

  /**
   * The element declares `disabled` or `ariaDisabled`.
   *
   * Two departures from jest-dom, both because the desktop differs. It has no
   * disabling container — no `<fieldset disabled>` — so there is no ancestor to
   * inherit from and none is invented. And it counts `ariaDisabled`, which
   * jest-dom's `toBeDisabled` deliberately ignores in favour of the native
   * attribute alone: here the two are one predicate all the way down
   * (`is_action_disabled`), so a disabled query cannot disagree with a disabled
   * accessibility node.
   */
  toBeDisabled(this: MatcherContext, received: unknown): GpuixMatcherResult {
    return against(this, received, "toBeDisabled", "be disabled", ({ element, describe }) => {
      const disabled = element.semantics?.disabled === true
      return {
        pass: disabled,
        actual: `  ${describe()} is ${disabled ? "" : "not "}disabled`,
      }
    })
  },

  /**
   * The element renders nothing: no retained children, and no text of its own.
   *
   * jest-dom counts child nodes and treats whitespace as content, skipping only
   * comments; there are no comments in this tree, so the rule is simply that
   * any child and any text at all make the element non-empty.
   *
   * `<code>`, `<diff>`, and `<markdown>` render their content from a prop
   * rather than from children — `code`, `patch`, and `source` — so a declared
   * one counts as content here. Without that they would read as empty while
   * painting a screenful of text.
   *
   * It says what `toHaveTextContent(/^$/)` was standing in for, and says more:
   * an element holding an empty `<div>` has no text content but is not empty.
   */
  toBeEmptyDOMElement(this: MatcherContext, received: unknown): GpuixMatcherResult {
    return against(
      this,
      received,
      "toBeEmptyDOMElement",
      "be an empty element",
      ({ element, describe }) => {
        const text = element.text ?? ""
        const children = element.children.length
        const content = declaredContent(element)
        return {
          pass: children === 0 && text === "" && (content?.value ?? "") === "",
          actual: `  ${describe()}\n  contains ${children} ${
            children === 1 ? "child" : "children"
          } and text ${JSON.stringify(text)}${
            content === undefined ? "" : ` and ${content.prop} ${JSON.stringify(content.value)}`
          }`,
        }
      }
    )
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
    return against(this, received, "toHaveFocus", "have focus", ({ renderer, element, describe }) => {
      const active = renderer.getActiveElement()
      const focused = active === null ? undefined : renderer.getElement(active)
      return {
        pass: active === element.id,
        actual: `  ${describe()}\n  focus is on ${
          focused === undefined ? "no element" : describeElement(renderer, focused)
        }`,
      }
    })
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
    // jest-dom rejects this rather than answering it, and so do we: an empty
    // string is a substring of everything, so the assertion can never fail and
    // whatever the author meant, it was not this.
    if (expected === "") {
      throw new Error(
        "toHaveTextContent: checking with an empty string always matches. " +
          "Assert the text you expect, or use toHaveTextContent(/^$/) for an element with no text."
      )
    }

    return against(
      this,
      received,
      "toHaveTextContent",
      `have text content ${describeMatcher(expected)}`,
      ({ renderer, element, describe }) => {
        const content = resolveNormalizer(options)(textContent(renderer, element))
        return {
          pass:
            typeof expected === "function"
              ? expected(content, element)
              : expected instanceof RegExp
                ? // Not reset the way the queries reset `lastIndex`, because
                  // jest-dom does not either and this matcher follows jest-dom.
                  // The consequence is jest-dom's own wart: a `/g` pattern is
                  // stateful, so repeating the same assertion alternates
                  // between passing and failing. Drop the `g` — it buys a
                  // `test()` call nothing anyway.
                  expected.test(content)
                : content.includes(String(expected)),
          actual: `  ${describe()}\n  text content ${JSON.stringify(content)}`,
        }
      }
    )
  },

  /**
   * The element's current value, compared exactly.
   *
   * The live editor buffer for `<input>` and `<textarea>`, and the retained
   * `value` prop for anything else — see `currentValue`. No normalization: this
   * is the matcher for "the value is exactly this string". Use
   * `toHaveDisplayValue` for a regular expression, a predicate, or normalized
   * text.
   *
   * jest-dom's zero-argument form (`toHaveValue()`, "has any value") and its
   * numeric and string-array forms are not implemented. There is no
   * `type="number"` input and no multi-select to coerce for, and "has any
   * value" is `expect(renderer.getInputValue(field.id) ?? "").not.toBe("")` —
   * the `?? ""` matters, because an editor that was never built reads `null`,
   * and `expect(null).not.toBe("")` would pass without a value in sight.
   */
  toHaveValue(
    this: MatcherContext,
    received: unknown,
    expected: string
  ): GpuixMatcherResult {
    return against(
      this,
      received,
      "toHaveValue",
      `have value ${JSON.stringify(expected)}`,
      ({ renderer, element, describe }) => {
        const value = currentValue(renderer, element)
        return {
          pass: value === expected,
          actual: `  ${describe()}\n  value ${
            value === undefined ? "is not declared" : JSON.stringify(value)
          }`,
        }
      }
    )
  },

  /**
   * The element's current value through the Testing Library matcher, so strings
   * are exact after normalization and regular expressions, predicates, and
   * `{ exact: false }` all work as they do in the queries.
   *
   * The same value `toHaveValue` reads: live for a text editor, the retained
   * prop otherwise. `getByDisplayValue` still matches the declared prop — a
   * query walks every element and cannot force a draw per candidate.
   */
  toHaveDisplayValue(
    this: MatcherContext,
    received: unknown,
    expected: TextContentMatcher,
    options: MatcherOptions = {}
  ): GpuixMatcherResult {
    return against(
      this,
      received,
      "toHaveDisplayValue",
      `have display value ${describeMatcher(expected)}`,
      ({ renderer, element, describe }) => {
        const value = currentValue(renderer, element)
        return {
          pass: value !== undefined && matchesMatcher(value, element, expected, options),
          actual: `  ${describe()}\n  value ${
            value === undefined ? "is not declared" : JSON.stringify(value)
          }`,
        }
      }
    )
  },

  /**
   * The element's computed accessible name, from its AccessKit node.
   *
   * Called with no argument it asserts only that a name exists, as jest-dom
   * does. The name is GPUI's computation, so an element that projects no
   * accessibility node — no declared role, no name from contents, and no
   * painted text of its own — has no accessible name to assert on, and this
   * reports that rather than falling back to the raw `ariaLabel` prop.
   */
  toHaveAccessibleName(
    this: MatcherContext,
    received: unknown,
    expected?: TextContentMatcher,
    options: MatcherOptions = {}
  ): GpuixMatcherResult {
    return against(
      this,
      received,
      "toHaveAccessibleName",
      expected === undefined
        ? "have an accessible name"
        : `have accessible name ${describeMatcher(expected)}`,
      ({ renderer, element, describe }) => {
        const node = accessibilityNodeOf(renderer, element)
        const name = node === undefined ? "" : accessibleNameOf(node)
        return {
          pass:
            expected === undefined
              ? name.length > 0
              : matchesMatcher(name, element, expected, options),
          actual: `  ${describe()}\n  accessible name ${JSON.stringify(name)}`,
        }
      }
    )
  },

  /**
   * The role the element resolves to: the one it declares, or the one its host
   * type implies where it declares none.
   *
   * The role is read through the same resolution `getByRole` uses — GPUI's
   * computed role off the element's AccessKit nodes, normalized and aliased by
   * the same rule — so the matcher and the query can never disagree about an
   * element. An `<img>` therefore has the role `img` with no `role` attribute
   * to show for it, and `toHaveAttribute('role')` is the matcher for the
   * authored one.
   *
   * An element that both carries a role and paints text projects two nodes, as
   * `<p>Hi</p>` does in the DOM, and has both roles — the same two a role query
   * would find it under. An element that projects no node at all has no role
   * here: the desktop has no `generic` to fall back to.
   */
  toHaveRole(this: MatcherContext, received: unknown, role: string): GpuixMatcherResult {
    return against(
      this,
      received,
      "toHaveRole",
      `have role ${JSON.stringify(role)}`,
      ({ renderer, element, describe }) => {
        const nodes = accessibilityNodesOf(renderer, element)
        const roles = nodes.map(computedRoleOf)
        return {
          pass: nodes.some((node) => matchesComputedRole(node, role)),
          actual: `  ${describe()}\n  ${
            roles.length === 0
              ? "projects no accessibility node, so it has no role"
              : `${roles.length === 1 ? "role" : "roles"} ${roles
                  .map((computed) => JSON.stringify(computed))
                  .join(", ")}`
          }`,
        }
      }
    )
  },

  /**
   * The attribute the element was given, by its DOM name — `getAttribute`
   * semantics, with no desktop dialect to learn.
   *
   * Called with a name alone it asserts only that the attribute is declared, as
   * jest-dom does; with a value it compares the attribute's text, because an
   * attribute in a document is text. `tabIndex={0}` answers `'0'`, `<div
   * disabled>` answers `''`, `disabled={false}` is not declared at all, and an
   * `aria-*` or `data-*` boolean carries the words `'true'` and `'false'`.
   * Names are case-insensitive, as they are in an HTML document, so
   * `tabindex` and `tabIndex` are one attribute.
   *
   * The source is the retained tree, which is where the desktop keeps what a
   * browser keeps in an attribute — `<a href>`, `<img src>`, `data-*`,
   * `aria-*`, the author's `id` and `role`. `class` and `autofocus` throw
   * rather than answering: see {@link UNANSWERABLE_ATTRIBUTES}.
   */
  toHaveAttribute(
    this: MatcherContext,
    received: unknown,
    name: string,
    expected?: string
  ): GpuixMatcherResult {
    // The receiver is checked first, so a typo in the receiver is reported as
    // one whatever name follows it.
    asTestElement(received, "toHaveAttribute")

    // Rejected rather than answered, as `toHaveTextContent('')` is: an answer
    // this tree cannot give honestly would read as a passing assertion about
    // nothing, in the negated form especially.
    const lowered = name.toLowerCase()
    if (Object.hasOwn(UNANSWERABLE_ATTRIBUTES, lowered)) {
      throw new TypeError(`toHaveAttribute: ${UNANSWERABLE_ATTRIBUTES[lowered]}`)
    }

    return against(
      this,
      received,
      "toHaveAttribute",
      expected === undefined
        ? `have attribute ${JSON.stringify(name)}`
        : `have attribute ${JSON.stringify(name)} with value ${JSON.stringify(expected)}`,
      ({ element, describe }) => {
        const declared = declaredAttribute(element, name)
        const text = declared === undefined ? undefined : attributeText(declared)
        return {
          // `null` is declared with no text to compare, so it answers the
          // presence question and fails every value one.
          pass:
            text !== undefined &&
            (expected === undefined ? true : text !== null && text === expected),
          actual: `  ${describe()}\n  attribute ${JSON.stringify(name)} ${
            text === undefined
              ? "is not declared"
              : text === null
                ? "is declared with a value no document could hold"
                : `is ${JSON.stringify(text)}`
          }`,
        }
      }
    )
  },

  /**
   * The golden matcher, mirroring vitest browser mode's. Its receiver is a
   * render result or a `TestRenderer` — the whole offscreen window — or a
   * `TestElement`, clipped to the box that element painted. See
   * `testing-screenshot.ts` for the decisions it makes and where they differ
   * from vitest's.
   */
  toMatchScreenshot,
}
