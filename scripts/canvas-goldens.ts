import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { chromium, type Page } from "playwright"

import {
  CANVAS_GOLDEN_DPR,
  CANVAS_GOLDEN_HEIGHT,
  CANVAS_GOLDEN_WIDTH,
  CANVAS_IMAGE_FIXTURE_NAME,
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
  imageSources: readonly string[] = [],
  deliberatelyPerturb = false
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    async ({ drawSource, width, height, dpr, imageSources, deliberatelyPerturb }) => {
      const canvas = document.createElement("canvas")
      canvas.width = width * dpr
      canvas.height = height * dpr

      const context = canvas.getContext("2d")
      if (!context) throw new Error("Chromium did not provide a CanvasRenderingContext2D")

      context.scale(dpr, dpr)
      const browserDraw = new Function(`return (${drawSource})`)() as CanvasSceneDraw
      const images = await Promise.all(
        imageSources.map(
          (src) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const image = new Image()
              image.onload = () => resolve(image)
              image.onerror = () => reject(new Error(`Failed to load fixture ${src}`))
              image.src = src
            })
        )
      )
      browserDraw(context, width, height, images)

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
      imageSources,
      deliberatelyPerturb,
    }
  )

  return Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64")
}

async function renderImageFixture(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas")
    canvas.width = 64
    canvas.height = 48
    const context = canvas.getContext("2d")!
    const horizontal = context.createLinearGradient(0, 0, 64, 0)
    horizontal.addColorStop(0, "#315da8")
    horizontal.addColorStop(0.5, "#6f7492")
    horizontal.addColorStop(1, "#ad6950")
    context.fillStyle = horizontal
    context.fillRect(0, 0, 64, 48)

    const vertical = context.createLinearGradient(0, 0, 0, 48)
    vertical.addColorStop(0, "#ffffff30")
    vertical.addColorStop(1, "#09142630")
    context.fillStyle = vertical
    context.fillRect(0, 0, 64, 48)

    // Keep the fixture's perimeter transparent so Chromium's and GPUI's
    // different image samplers are compared on the image content, not on how
    // many pixels each filter extends past a hard source edge.
    const pixels = context.getImageData(0, 0, 64, 48)
    for (let y = 0; y < 48; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const edgeDistance = Math.min(x + 1, 64 - x, y + 1, 48 - y)
        const alpha = Math.min(1, edgeDistance / 8)
        pixels.data[(y * 64 + x) * 4 + 3] = Math.round(255 * alpha)
      }
    }
    context.putImageData(pixels, 0, 0)
    return canvas.toDataURL("image/png")
  })
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

  const imageFixture = await renderImageFixture(page)
  const imageFixturePath = path.join(fixtureDirectory, CANVAS_IMAGE_FIXTURE_NAME)
  await writeFile(imageFixturePath, imageFixture)
  const imageFixtureDataUrl = `data:image/png;base64,${imageFixture.toString("base64")}`
  console.log(
    `${path.relative(repositoryRoot, imageFixturePath)} (${imageFixture.byteLength} bytes)`
  )

  for (const scene of Object.values(canvasScenes)) {
    const outputPath = path.join(goldenDirectory, `${scene.name}.png`)
    const imageSources = (scene.imageFixtures ?? []).map((fixture) => {
      if (fixture !== CANVAS_IMAGE_FIXTURE_NAME) {
        throw new Error(`Unknown canvas image fixture ${JSON.stringify(fixture)}`)
      }
      return imageFixtureDataUrl
    })
    const png = await renderScene(page, scene.draw, imageSources)
    await writeFile(outputPath, png)
    console.log(`${path.relative(repositoryRoot, outputPath)} (${png.byteLength} bytes)`)
  }

  const perturbedScene = canvasScenes["fill-rect-grid"]
  const perturbedPath = path.join(fixtureDirectory, `${perturbedScene.name}-perturbed.png`)
  const perturbedPng = await renderScene(page, perturbedScene.draw, [], true)
  await writeFile(perturbedPath, perturbedPng)
  console.log(
    `${path.relative(repositoryRoot, perturbedPath)} (${perturbedPng.byteLength} bytes)`
  )

  await context.close()
} finally {
  await browser.close()
}
