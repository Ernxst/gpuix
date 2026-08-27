/**
 * Canvas map-shape scale benchmark.
 *
 * Measures two separate costs through createTestRoot:
 *
 * - command flush: browser-shaped Canvas 2D recording plus display-list upload
 * - draw: native preparation, layout, and paint in TestRenderer.flush()
 *
 * The grouped and interleaved cases contain identical images and geometry.
 * Only their painter order changes, exposing the cost of ending and restarting
 * GPUI's main encoder for each PrimitiveBatch::Paths run.
 *
 * This is a measurement, not a timing gate. Run it uncontended with:
 *
 *   bun x vitest run canvas-map.perf.test.tsx
 */

import { fileURLToPath } from 'node:url'

import React, { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import {
  __applyCanvasCommands,
  Image,
  type CanvasPublicInstance,
} from '@gpuix/react'
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  recordCanvasCommands,
  type CanvasTestState,
} from '@gpuix/react/testing'

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const VIEWPORT_WIDTH = 1280
const VIEWPORT_HEIGHT = 800
const TILE_SIZE = 256
const TILE_COLUMNS = 5
const IMAGE_TILE_COUNT = 20
const STROKED_POLYLINE_COUNT = 160
const FILLED_POLYGON_COUNT = 240
const POLYGON_VERTICES = 8
const POLYLINE_VERTICES = 24
const WARMUP = 10
const SAMPLES = 40
const PATH_VERTEX_UPLOAD_BYTES = 112

type PaintOrder = 'grouped' | 'interleaved'

interface Samples {
  commandFlush: number[]
  draw: number[]
}

interface Stats {
  p50: number
  p95: number
  max: number
}

const imageFixture = fileURLToPath(
  new URL(
    '../packages/react/canvas-goldens/__fixtures__/canvas-image-source.png',
    import.meta.url,
  ),
)

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]!
}

function summarize(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
  }
}

function report(order: PaintOrder, phase: keyof Samples, samples: number[]): Stats {
  const stats = summarize(samples)
  console.log(
    `[canvas-map.perf] order=${order} phase=${phase} n=${samples.length} ` +
      `p50=${stats.p50.toFixed(2)}ms p95=${stats.p95.toFixed(2)}ms ` +
      `max=${stats.max.toFixed(2)}ms`,
  )
  return stats
}

function aliasedFixture(index: number): string {
  const separator = imageFixture.lastIndexOf('/')
  return (
    imageFixture.slice(0, separator + 1) +
    './'.repeat(index + 1) +
    imageFixture.slice(separator + 1)
  )
}

function createTileImages(): HTMLImageElement[] {
  return Array.from({ length: IMAGE_TILE_COUNT }, (_, index) => {
    const image = new Image()
    image.src = aliasedFixture(index)
    return image
  })
}

function drawTile(
  context: CanvasRenderingContext2D,
  images: readonly HTMLImageElement[],
  index: number,
): void {
  const column = index % TILE_COLUMNS
  const row = Math.floor(index / TILE_COLUMNS)
  const x = column * TILE_SIZE
  const y = row * TILE_SIZE
  context.drawImage(images[index]!, x, y, TILE_SIZE, TILE_SIZE)
}

function drawPolygon(context: CanvasRenderingContext2D, index: number): void {
  const centerX = 24 + ((index * 83) % (VIEWPORT_WIDTH - 48))
  const centerY = 24 + ((index * 47) % (VIEWPORT_HEIGHT - 48))
  const radius = 7 + (index % 11)
  context.beginPath()
  for (let vertex = 0; vertex < POLYGON_VERTICES; vertex += 1) {
    const angle = (vertex / POLYGON_VERTICES) * Math.PI * 2 + (index % 5) * 0.07
    const wobble = vertex % 2 === 0 ? 1 : 0.72
    const x = centerX + Math.cos(angle) * radius * wobble
    const y = centerY + Math.sin(angle) * radius * wobble
    if (vertex === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
  context.fill()
}

function drawPolyline(context: CanvasRenderingContext2D, index: number): void {
  const startX = -24 + (index % 10) * 11
  const lane = (index * 37) % VIEWPORT_HEIGHT
  context.beginPath()
  for (let vertex = 0; vertex < POLYLINE_VERTICES; vertex += 1) {
    const progress = vertex / (POLYLINE_VERTICES - 1)
    const x = startX + progress * (VIEWPORT_WIDTH + 48)
    const y = lane + Math.sin(progress * Math.PI * 4 + index * 0.19) * 22
    if (vertex === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.stroke()
}

function drawMapFrame(
  context: CanvasRenderingContext2D,
  order: PaintOrder,
  images: readonly HTMLImageElement[],
): void {
  context.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
  context.fillStyle = 'rgba(30, 102, 74, 0.58)'
  context.strokeStyle = 'rgba(24, 45, 72, 0.9)'
  context.lineWidth = 2
  context.lineJoin = 'round'
  context.lineCap = 'round'

  if (order === 'grouped') {
    for (let index = 0; index < IMAGE_TILE_COUNT; index += 1) {
      drawTile(context, images, index)
    }
    for (let index = 0; index < FILLED_POLYGON_COUNT; index += 1) {
      drawPolygon(context, index)
    }
  } else {
    const polygonsPerTile = FILLED_POLYGON_COUNT / IMAGE_TILE_COUNT
    for (let tile = 0; tile < IMAGE_TILE_COUNT; tile += 1) {
      drawTile(context, images, tile)
      for (let offset = 0; offset < polygonsPerTile; offset += 1) {
        drawPolygon(context, tile * polygonsPerTile + offset)
      }
    }
  }

  for (let index = 0; index < STROKED_POLYLINE_COUNT; index += 1) {
    drawPolyline(context, index)
  }
}

async function waitForImages(
  flush: () => void,
  readState: () => CanvasTestState | undefined,
): Promise<CanvasTestState> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    flush()
    const state = readState()
    if (
      state?.loadedImageCount === IMAGE_TILE_COUNT &&
      state.paintedImageCount === IMAGE_TILE_COUNT
    ) {
      return state
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Map tile fixtures did not load: ${JSON.stringify(readState())}`)
}

describeNative('canvas map scale', () => {
  it('measures command flush and draw with grouped and interleaved painter order', async () => {
    const root = createTestRoot({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      strictStyles: true,
    })
    const canvasRef = createRef<CanvasPublicInstance>()
    const images = createTileImages()

    try {
      root.render(
        <canvas
          ref={canvasRef}
          width={VIEWPORT_WIDTH}
          height={VIEWPORT_HEIGHT}
          style={{ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }}
        />,
      )
      root.renderer.flush()
      const canvas = canvasRef.current
      if (!canvas) throw new Error('Map benchmark canvas did not mount')
      const elementId = canvas.id

      const applyFrame = (order: PaintOrder): { commandFlush: number; draw: number } => {
        const commandStarted = performance.now()
        const frame = recordCanvasCommands((context) => drawMapFrame(context, order, images))
        __applyCanvasCommands(canvas, frame.ops, frame.operands, frame.strings)
        const commandFlush = performance.now() - commandStarted

        const drawStarted = performance.now()
        root.renderer.flush()
        const draw = performance.now() - drawStarted
        return { commandFlush, draw }
      }

      applyFrame('grouped')
      await waitForImages(
        () => root.renderer.flush(),
        () => root.renderer.getCanvasState(elementId),
      )

      for (let index = 0; index < WARMUP; index += 1) {
        applyFrame(index % 2 === 0 ? 'grouped' : 'interleaved')
      }

      const samples: Record<PaintOrder, Samples> = {
        grouped: { commandFlush: [], draw: [] },
        interleaved: { commandFlush: [], draw: [] },
      }
      for (let index = 0; index < SAMPLES; index += 1) {
        for (const order of index % 2 === 0
          ? (['grouped', 'interleaved'] as const)
          : (['interleaved', 'grouped'] as const)) {
          const sample = applyFrame(order)
          samples[order].commandFlush.push(sample.commandFlush)
          samples[order].draw.push(sample.draw)
        }
      }

      for (const order of ['grouped', 'interleaved'] as const) {
        report(order, 'commandFlush', samples[order].commandFlush)
        report(order, 'draw', samples[order].draw)
      }

      applyFrame('grouped')
      const groupedState = root.renderer.getCanvasState(elementId)!
      applyFrame('interleaved')
      const interleavedState = root.renderer.getCanvasState(elementId)!
      const uploadMiB =
        (groupedState.pathVertexCount * PATH_VERTEX_UPLOAD_BYTES) / (1024 * 1024)
      console.log(
        `[canvas-map.perf] images=${groupedState.imagePrimitiveCount} ` +
          `paths=${groupedState.pathPrimitiveCount} vertices=${groupedState.pathVertexCount} ` +
          `maxPathVertices=${groupedState.maxPathVertexCount} ` +
          `estimatedPathUpload=${uploadMiB.toFixed(2)}MiB ` +
          `pathBatches=${groupedState.pathBatchCount}/${interleavedState.pathBatchCount}`,
      )

      expect(groupedState.imagePrimitiveCount).toBe(IMAGE_TILE_COUNT)
      expect(groupedState.pathPrimitiveCount).toBe(
        FILLED_POLYGON_COUNT + STROKED_POLYLINE_COUNT,
      )
      expect(groupedState.pathVertexCount).toBeGreaterThan(0)
      expect(groupedState.maxPathVertexCount).toBeLessThan(65_536)
      expect(groupedState.pathVertexCount).toBe(interleavedState.pathVertexCount)
      expect(groupedState.pathBatchCount).toBe(1)
      expect(interleavedState.pathBatchCount).toBe(IMAGE_TILE_COUNT)
      expect(samples.grouped.commandFlush).toHaveLength(SAMPLES)
      expect(samples.grouped.draw).toHaveLength(SAMPLES)
      expect(samples.interleaved.commandFlush).toHaveLength(SAMPLES)
      expect(samples.interleaved.draw).toHaveLength(SAMPLES)
      expect([...samples.grouped.draw, ...samples.interleaved.draw].every(Number.isFinite)).toBe(
        true,
      )
    } finally {
      root.unmount()
    }
  }, 120_000)
})
