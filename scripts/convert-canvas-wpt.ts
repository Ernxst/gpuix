/**
 * Converts the vendored W3C canvas YAML into the committed case table consumed
 * by the native GPUIX conformance harness. This is deliberately dependency
 * free: Bun provides the YAML reader and the generated JSON keeps test runs
 * network-free.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const yamlDirectory = path.join(root, "packages/react/wpt/yaml")
const outputFile = path.join(root, "packages/react/wpt/generated/canvas-wpt.json")

/**
 * The upstream revision the eleven suites in `packages/react/wpt/yaml` are
 * vendored from. Re-vendoring means bumping this and re-running the converter:
 * the files must stay byte-identical to
 * `html/canvas/tools/yaml/<suite>.yaml` at this commit.
 */
const VENDORED_SHA = "7413adf41ac497181510ff906de6ba842bd21e48"

export interface CanvasWptCase {
  id: string
  name: string
  suite: string
  desc: string
  code: string
  expected: string | null
  size: [number, number] | null
  /**
   * Every gap that statically applies to this case, most specific first. A
   * runnable case still executes with gaps recorded: they are the *expected*
   * outcome, so a case that starts passing because the capability landed shows
   * up as an unexplained ledger deviation instead of staying quietly skipped.
   */
  gaps: string[]
  /** False when the harness cannot execute the WPT source at all. */
  runnable: boolean
}

const API_GAPS: readonly [string, RegExp][] = [
  ["arbitrary path clipping", /\.clip\b/],
  ["geometry hit-testing", /\.isPointIn(?:Path|Stroke)\b/],
  ["canvas gradients", /create(?:Linear|Radial|Conic)Gradient\b/],
  ["canvas patterns", /\.createPattern\b/],
  ["CPU canvas pixel buffers", /(?:create|get|put)ImageData\b|\bImageData\b/],
  ["Path2D objects", /\bPath2D\b/],
  ["roundRect opcode", /\.roundRect\b/],
  ["context reset", /\.reset\b/],
  ["canvas text", /\b(?:fillText|strokeText|measureText)\b|\.(?:font|textAlign|textBaseline|direction)\b/],
  ["canvas shadows", /\.shadow(?:Blur|Color|OffsetX|OffsetY)\b/],
  ["canvas filters", /\.filter\b/],
  ["image smoothing controls", /\.imageSmoothing(?:Enabled|Quality)\b/],
  ["non-source-over compositing", /\.globalCompositeOperation\s*=\s*['\"](?!source-over)/],
  ["dash offset", /\.lineDashOffset\s*=\s*(?!0(?:\D|$))/],
  ["DOM canvas attributes and CSS", /\.getAttribute\b|\.setAttribute\b|getComputedStyle|document\.body/],
  ["HTML canvas backing-store state", /\bcanvas\.(?:width|height|toDataURL|transferControlToOffscreen)\b|\bctx\.canvas\b/],
  ["DOM image sources", /\bnew Image\b|createImageBitmap|\bHTMLImageElement\b/],
  ["OffscreenCanvas", /\bOffscreenCanvas\b/],
  ["asynchronous WPT driver", /\b(?:async_test|promise_test|step_timeout|requestAnimationFrame)\b/],
  ["modern CSS color spaces", /display-p3|color\((?!srgb)|color-mix\(/],
]

const JINJA_GAP = "WPT Jinja variant expansion is not implemented by this harness"
const ASSERT_SYNTAX_GAP = "WPT assertion syntax not implemented by this harness"
const DEFERRED_PIXEL_GAP =
  "WPT case asserts pixels between drawing operations; this harness compares every pixel assertion " +
  "against a single screenshot taken after the whole case body"

/**
 * True when the case checks a pixel and then keeps drawing. The harness defers
 * every pixel assertion to one screenshot taken after the body has run, so such
 * a case would be checked against the final canvas rather than the state at the
 * assertion. Today every one of these is skipped for an unrelated missing
 * capability, so the mis-comparison is inert - but it would manufacture
 * divergences the moment that capability landed. The case is unconvertible
 * under this harness's screenshot model rather than silently mis-scored.
 */
function assertsPixelBeforeDrawing(code: string): boolean {
  const statements = code.split("\n")
  const firstAssertion = statements.findIndex((line) => /\bassertPixel\(/.test(line))
  if (firstAssertion < 0) return false
  return statements
    .slice(firstAssertion + 1)
    .some((line) => !/^\s*assert\w*\(/.test(line) && /\b(?:ctx|canvas)\.\w+\s*(?:\(|=[^=])/.test(line))
}

/**
 * WPT's own `@nonfinite` expansion (tools/gentest.py `expand_nonfinite`): every
 * argument alone gets each of its non-finite values, and then every combination
 * of two or more arguments gets its *first* non-finite value. Expanding only
 * the single-argument calls would silently drop 57 of setTransform's 75 calls
 * and overstate what the case proves.
 */
function expandNonfinite(method: string, argumentsText: string, tail: string): string {
  const argumentSets = argumentsText.split(", ").map((argument) => {
    const match = argument.match(/^<(.*)>$/)
    if (!match) throw new Error(`Malformed @nonfinite argument ${argument}`)
    return match[1]!.split(" ")
  })
  const baseline = argumentSets.map((values) => values[0]!)
  const calls: string[][] = []
  for (let index = 0; index < argumentSets.length; index += 1) {
    for (const nonfinite of argumentSets[index]!.slice(1)) {
      const values = [...baseline]
      values[index] = nonfinite
      calls.push(values)
    }
  }
  const combine = (current: string[], start: number, depth: number): void => {
    for (let index = start; index < argumentSets.length; index += 1) {
      const nonfinite = argumentSets[index]![1]
      if (nonfinite === undefined) continue
      const values = [...current]
      values[index] = nonfinite
      if (depth > 0) calls.push(values)
      combine(values, index + 1, depth + 1)
    }
  }
  combine(baseline, 0, 0)
  return calls.map((values) => `${method}(${values.join(", ")})${tail};`).join("\n")
}

function rewrite(code: string): { code: string; unconvertible: string | null } {
  let output = code.replace(/\\-\s*\n\s*/g, " ").trim()
  output = output.replace(/@nonfinite ([^(]+)\(([^)]+)\)(.*);/g, (_line, method: string, args: string, tail: string) =>
    expandNonfinite(method, args, tail)
  )
  // `==` is an exact pixel match and `==~` is WPT's ±2 approximate match; an
  // explicit `+/- n` overrides both. Collapsing them would relax 1189 exact
  // assertions into approximate ones.
  output = output.replace(
    /@assert pixel (\d+),(\d+) (==~?) (\d+),(\d+),(\d+),(\d+)(?: \+\/- (\d+))?;/g,
    (_line, x, y, operator, r, g, b, a, tolerance) =>
      `assertPixel(${x}, ${y}, ${r}, ${g}, ${b}, ${a}, ${tolerance ?? (operator === "==~" ? 2 : 0)});`
  )
  output = output.replace(
    /@assert throws (\S+) (.*);/g,
    (_line, expected, body) => `assertThrows(${JSON.stringify(expected)}, () => { ${body}; });`
  )
  output = output.replace(/@assert (.*) === (.*);/g, "assertStrictEqual($1, $2);")
  output = output.replace(/@assert (.*) !== (.*);/g, "assertNotStrictEqual($1, $2);")
  output = output.replace(/@assert (.*) =~ (.*);/g, "assertMatches($1, $2);")
  output = output.replace(/@assert (.*);/g, "assertTrue($1);")
  if (/@[A-Za-z_.]+/.test(output)) return { code: "", unconvertible: ASSERT_SYNTAX_GAP }
  if (/\{[{%#]/.test(output)) return { code: "", unconvertible: JINJA_GAP }
  if (assertsPixelBeforeDrawing(output)) return { code: "", unconvertible: DEFERRED_PIXEL_GAP }
  return { code: output, unconvertible: null }
}

/** Every gap that statically applies, not just the first one matched. */
function staticGaps(code: string, canvasTypes: unknown): string[] {
  const gaps: string[] = []
  if (Array.isArray(canvasTypes) && !canvasTypes.includes("HtmlCanvas")) {
    gaps.push(`WPT canvas type ${canvasTypes.join(", ")} is outside the HTML canvas host`)
  }
  for (const [gap, pattern] of API_GAPS) if (pattern.test(code)) gaps.push(`Unsupported API: ${gap}`)
  return gaps
}

const cases: CanvasWptCase[] = []
const ids = new Map<string, number>()
for (const file of readdirSync(yamlDirectory).filter((name) => name.endsWith(".yaml")).sort()) {
  const suite = file.slice(0, -".yaml".length)
  const document = Bun.YAML.parse(readFileSync(path.join(yamlDirectory, file), "utf8")) as unknown
  const tests = Array.isArray(document)
    ? document
    : (document as { tests?: unknown[] } | null)?.tests ?? []
  if (!Array.isArray(tests)) throw new Error(`${file}: expected a YAML test list`)
  for (const rawTest of tests) {
    const test = rawTest as Record<string, unknown>
    if (typeof test.name !== "string") continue
    // A Jinja variant parent carries its code inside `variants`; the top-level
    // entry has none, and executing its empty body would score a phantom pass.
    const hasCode = typeof test.code === "string"
    const source = hasCode ? (test.code as string) : ""
    const converted = hasCode ? rewrite(source) : { code: "", unconvertible: JINJA_GAP }
    // A Jinja or unexpanded-`@assert` body cannot be scanned for API gaps - the
    // code it would run does not exist yet. A case held back only by the
    // screenshot model converted cleanly, so its API gaps are known and stay
    // recorded behind the harness limitation that blocks it first.
    const gaps =
      converted.unconvertible === null
        ? staticGaps(source, test.canvas_types)
        : converted.unconvertible === DEFERRED_PIXEL_GAP
          ? [DEFERRED_PIXEL_GAP, ...staticGaps(source, test.canvas_types)]
          : [converted.unconvertible]
    const baseId = `${suite}/${test.name}`
    const occurrence = (ids.get(baseId) ?? 0) + 1
    ids.set(baseId, occurrence)
    cases.push({
      id: occurrence === 1 ? baseId : `${baseId}#${occurrence}`,
      name: test.name,
      suite,
      desc: typeof test.desc === "string" ? test.desc : "",
      code: converted.code,
      expected: typeof test.expected === "string" ? test.expected : null,
      size:
        Array.isArray(test.size) && test.size.length === 2 && test.size.every((value) => typeof value === "number")
          ? [test.size[0] as number, test.size[1] as number]
          : null,
      gaps,
      runnable: converted.unconvertible === null,
    })
  }
}

mkdirSync(path.dirname(outputFile), { recursive: true })
writeFileSync(
  outputFile,
  JSON.stringify(
    {
      source: "w3c/web-platform-tests html/canvas/tools/yaml",
      vendoredFrom: `https://github.com/web-platform-tests/wpt/tree/${VENDORED_SHA}/html/canvas/tools/yaml`,
      vendoredSha: VENDORED_SHA,
      cases,
    },
    null,
    2
  ) + "\n"
)
const unconvertible = cases.filter((test) => !test.runnable).length
const gapped = cases.filter((test) => test.runnable && test.gaps.length > 0).length
console.log(
  `WPT canvas conversion: ${cases.length} cases (${cases.length - unconvertible} runnable, ` +
    `${gapped} of them with a known static gap, ${unconvertible} unconvertible)`
)
