import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "playwright"

import { cssBoxShadow, shadowCases } from "../packages/react/src/__tests__/fixtures/shadow-cases.js"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const goldenDirectory = path.join(repositoryRoot, "packages/react/shadow-goldens")

await mkdir(goldenDirectory, { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ deviceScaleFactor: dpr })
    try {
      for (const testCase of shadowCases) {
        const page = await context.newPage()
        try {
          await page.setViewportSize({
            width: testCase.viewportWidth,
            height: testCase.viewportHeight,
          })
          await page.setContent(
            `<!doctype html>
<html>
<head>
<style>
  html, body { margin: 0; padding: 0; background: white; }
  #box {
    position: absolute;
    box-sizing: border-box;
    left: ${testCase.left}px;
    top: ${testCase.top}px;
    width: ${testCase.width}px;
    height: ${testCase.height}px;
    background: ${testCase.background};
    border-style: solid;
    border-color: ${testCase.borderColor};
    border-width: ${testCase.borderWidth}px;
    box-shadow: ${cssBoxShadow(testCase.layers)};
  }
</style>
</head>
<body>
<div id="box"></div>
</body>
</html>`
          )
          const outputPath = path.join(goldenDirectory, `${testCase.name}-dpr${dpr}.png`)
          await page.screenshot({ path: outputPath })
          console.log(`${path.relative(repositoryRoot, outputPath)}`)
        } finally {
          await page.close()
        }
      }
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}
