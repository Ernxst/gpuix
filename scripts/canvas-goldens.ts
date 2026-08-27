import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { chromium, type Page } from "playwright"

import {
  CANVAS_GOLDEN_DPR,
  CANVAS_GOLDEN_HEIGHT,
  CANVAS_GOLDEN_WIDTH,
  canvasScenes,
  type CanvasSceneDraw,
} from "../packages/react/src/canvas-scenes.js"

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
)
const goldenDirectory = path.join(repositoryRoot, "packages/react/canvas-goldens")
const fixtureDirectory = path.join(goldenDirectory, "__fixtures__")

async function renderScene(
  page: Page,
  draw: CanvasSceneDraw,
  deliberatelyPerturb = false
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ drawSource, width, height, dpr, deliberatelyPerturb }) => {
      const canvas = document.createElement("canvas")
      canvas.width = width * dpr
      canvas.height = height * dpr

      const context = canvas.getContext("2d")
      if (!context) throw new Error("Chromium did not provide a CanvasRenderingContext2D")

      context.scale(dpr, dpr)
      const browserDraw = new Function(`return (${drawSource})`)() as CanvasSceneDraw
      browserDraw(context, width, height)

      if (deliberatelyPerturb) {
        context.fillStyle = "#ff00ff"
        context.fillRect(width - 8, height - 8, 4, 4)
      }

      return canvas.toDataURL("image/png")
    },
    {
      drawSource: draw.toString(),
      width: CANVAS_GOLDEN_WIDTH,
      height: CANVAS_GOLDEN_HEIGHT,
      dpr: CANVAS_GOLDEN_DPR,
      deliberatelyPerturb,
    }
  )

  return Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64")
}

await mkdir(goldenDirectory, { recursive: true })
await mkdir(fixtureDirectory, { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({
    viewport: { width: CANVAS_GOLDEN_WIDTH, height: CANVAS_GOLDEN_HEIGHT },
    deviceScaleFactor: CANVAS_GOLDEN_DPR,
  })
  const page = await context.newPage()

  for (const scene of Object.values(canvasScenes)) {
    const outputPath = path.join(goldenDirectory, `${scene.name}.png`)
    const png = await renderScene(page, scene.draw)
    await writeFile(outputPath, png)
    console.log(`${path.relative(repositoryRoot, outputPath)} (${png.byteLength} bytes)`)
  }

  const perturbedScene = canvasScenes["fill-rect-grid"]
  const perturbedPath = path.join(fixtureDirectory, `${perturbedScene.name}-perturbed.png`)
  const perturbedPng = await renderScene(page, perturbedScene.draw, true)
  await writeFile(perturbedPath, perturbedPng)
  console.log(
    `${path.relative(repositoryRoot, perturbedPath)} (${perturbedPng.byteLength} bytes)`
  )

  await context.close()
} finally {
  await browser.close()
}
