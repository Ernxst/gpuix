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

export interface CanvasWptCase {
  id: string
  name: string
  suite: string
  desc: string
  code: string
  expected: string | null
  size: [number, number] | null
  skip: string | null
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

function rewrite(code: string): { code: string; skip: string | null } {
  let output = code.replace(/\\-\s*\n\s*/g, " ").trim()
  output = output.replace(
    /@nonfinite ([^(]+)\(([^)]+)\)(.*);/g,
    (_line, method: string, argumentsText: string, tail: string) => {
      const argumentSets = argumentsText.split(", ").map((argument) => {
        const match = argument.match(/^<(.*)>$/)
        if (!match) throw new Error(`Malformed @nonfinite argument ${argument}`)
        return match[1]!.split(" ")
      })
      const baseline = argumentSets.map((values) => values[0]!)
      const calls: string[] = []
      for (let index = 0; index < argumentSets.length; index += 1) {
        for (const nonfinite of argumentSets[index]!.slice(1)) {
          const values = [...baseline]
          values[index] = nonfinite
          calls.push(`${method}(${values.join(", ")})${tail};`)
        }
      }
      return calls.join("\n")
    }
  )
  output = output.replace(
    /@assert pixel (\d+),(\d+) ==~? (\d+),(\d+),(\d+),(\d+)(?: \+\/- (\d+))?;/g,
    (_line, x, y, r, g, b, a, tolerance) =>
      `assertPixel(${x}, ${y}, ${r}, ${g}, ${b}, ${a}${tolerance ? `, ${tolerance}` : ""});`
  )
  output = output.replace(
    /@assert throws (\S+) (.*);/g,
    (_line, expected, body) => `assertThrows(${JSON.stringify(expected)}, () => { ${body}; });`
  )
  output = output.replace(/@assert (.*) === (.*);/g, "assertStrictEqual($1, $2);")
  output = output.replace(/@assert (.*) !== (.*);/g, "assertNotStrictEqual($1, $2);")
  output = output.replace(/@assert (.*) =~ (.*);/g, "assertMatches($1, $2);")
  output = output.replace(/@assert (.*);/g, "assertTrue($1);")
  if (/@[A-Za-z_.]+/.test(output)) {
    return { code: "", skip: "WPT assertion syntax not implemented by this harness" }
  }
  if (/\{[{%#]/.test(output)) {
    return { code: "", skip: "WPT Jinja variant expansion is not implemented by this harness" }
  }
  return { code: output, skip: null }
}

function staticGap(code: string, canvasTypes: unknown): string | null {
  if (Array.isArray(canvasTypes) && !canvasTypes.includes("HtmlCanvas")) {
    return `WPT canvas type ${canvasTypes.join(", ")} is outside the HTML canvas host`
  }
  return API_GAPS.find(([, pattern]) => pattern.test(code))?.[0] ?? null
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
    const source = typeof test.code === "string" ? test.code : ""
    const converted = rewrite(source)
    const staticSkip = converted.skip ?? staticGap(source, test.canvas_types)
    const baseId = `${suite}/${test.name}`
    const occurrence = (ids.get(baseId) ?? 0) + 1
    ids.set(baseId, occurrence)
    cases.push({
      id: occurrence === 1 ? baseId : `${baseId}#${occurrence}`,
      name: test.name,
      suite,
      desc: typeof test.desc === "string" ? test.desc : "",
      code: staticSkip ? "" : converted.code,
      expected: typeof test.expected === "string" ? test.expected : null,
      size:
        Array.isArray(test.size) && test.size.length === 2 && test.size.every((value) => typeof value === "number")
          ? [test.size[0] as number, test.size[1] as number]
          : null,
      skip: staticSkip,
    })
  }
}

mkdirSync(path.dirname(outputFile), { recursive: true })
writeFileSync(
  outputFile,
  JSON.stringify(
    {
      source: "w3c/web-platform-tests html/canvas/tools/yaml",
      vendoredFrom: "https://github.com/web-platform-tests/wpt/tree/master/html/canvas/tools/yaml",
      cases,
    },
    null,
    2
  ) + "\n"
)
const skipped = cases.filter((test) => test.skip).length
console.log(`WPT canvas conversion: ${cases.length} cases (${cases.length - skipped} runnable, ${skipped} static skips)`)
