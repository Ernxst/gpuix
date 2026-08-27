/** Logical width shared by browser goldens and native canvas comparisons. */
export const CANVAS_GOLDEN_WIDTH = 320

/** Logical height shared by browser goldens and native canvas comparisons. */
export const CANVAS_GOLDEN_HEIGHT = 240

/** Browser device-pixel ratio used to encode the committed PNG goldens. */
export const CANVAS_GOLDEN_DPR = 2

export type CanvasSceneDraw = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number
) => void

export interface CanvasScene {
  name: string
  draw: CanvasSceneDraw
}

/**
 * Browser-standard Canvas 2D scenes used by the native equivalence gate.
 *
 * Keep every drawing function self-contained and free of GPUIX imports. The
 * golden generator serializes the same function into Chromium, while the
 * native canvas test passes it unchanged to the GPUIX canvas context.
 */
export const canvasScenes = {
  "fill-rect-grid": {
    name: "fill-rect-grid",
    draw: function fillRectGrid(context, width, height) {
      context.fillStyle = "#f8fafc"
      context.fillRect(0, 0, width, height)

      const colors = ["#0f172a", "#2563eb", "#14b8a6", "#f59e0b"]
      const cellWidth = 56
      const cellHeight = 40
      const gap = 8
      const originX = 24
      const originY = 24

      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          context.fillStyle = colors[(row + column) % colors.length]!
          context.fillRect(
            originX + column * (cellWidth + gap),
            originY + row * (cellHeight + gap),
            cellWidth,
            cellHeight
          )
        }
      }
    },
  },

  "translucent-overlap": {
    name: "translucent-overlap",
    draw: function translucentOverlap(context, width, height) {
      context.fillStyle = "#111827"
      context.fillRect(0, 0, width, height)

      context.globalAlpha = 0.68
      context.fillStyle = "#ef4444"
      context.fillRect(40, 42, 150, 116)
      context.fillStyle = "#22c55e"
      context.fillRect(108, 72, 150, 116)
      context.fillStyle = "#3b82f6"
      context.fillRect(76, 116, 150, 92)
      context.globalAlpha = 1
    },
  },

  "dashed-polyline": {
    name: "dashed-polyline",
    draw: function dashedPolyline(context, width, height) {
      context.fillStyle = "#f1f5f9"
      context.fillRect(0, 0, width, height)

      context.beginPath()
      context.moveTo(24, 188)
      context.lineTo(72, 78)
      context.lineTo(132, 142)
      context.lineTo(198, 48)
      context.lineTo(292, 112)
      context.setLineDash([14, 8, 4, 8])
      context.lineWidth = 7
      context.lineJoin = "round"
      context.lineCap = "round"
      context.strokeStyle = "#7c3aed"
      context.stroke()
    },
  },

  "even-odd-polygon": {
    name: "even-odd-polygon",
    draw: function evenOddPolygon(context, width, height) {
      context.fillStyle = "#fff7ed"
      context.fillRect(0, 0, width, height)

      context.beginPath()
      context.moveTo(160, 20)
      context.lineTo(298, 118)
      context.lineTo(246, 218)
      context.lineTo(74, 218)
      context.lineTo(22, 118)
      context.closePath()

      context.moveTo(160, 70)
      context.lineTo(106, 166)
      context.lineTo(214, 166)
      context.closePath()

      context.fillStyle = "#ea580c"
      context.fill("evenodd")
    },
  },

  "translate-scale": {
    name: "translate-scale",
    draw: function translateScale(context, width, height) {
      context.fillStyle = "#ecfeff"
      context.fillRect(0, 0, width, height)

      context.save()
      context.translate(58, 34)
      context.scale(1.75, 1.25)

      context.fillStyle = "#0891b2"
      context.fillRect(0, 0, 82, 58)
      context.fillStyle = "#164e63"
      context.fillRect(26, 24, 82, 58)

      context.beginPath()
      context.moveTo(12, 112)
      context.lineTo(64, 70)
      context.lineTo(116, 112)
      context.closePath()
      context.fillStyle = "#f97316"
      context.fill()
      context.restore()
    },
  },

  "zoomed-curve-stroke": {
    name: "zoomed-curve-stroke",
    draw: function zoomedCurveStroke(context, width, height) {
      context.fillStyle = "#f8fafc"
      context.fillRect(0, 0, width, height)

      context.save()
      context.translate(28, 18)
      context.scale(4, 4)
      context.beginPath()
      context.moveTo(4, 42)
      context.bezierCurveTo(18, 2, 42, 58, 66, 12)
      context.quadraticCurveTo(72, 3, 70, 30)
      context.setLineDash([3.5, 2])
      context.lineWidth = 1.75
      context.lineCap = "round"
      context.lineJoin = "round"
      context.strokeStyle = "#0f766e"
      context.stroke()

      context.beginPath()
      context.ellipse(35, 28, 24, 13, 0.35, 0.2, Math.PI * 1.1)
      context.setLineDash([])
      context.lineWidth = 1.25
      context.strokeStyle = "#7c3aed"
      context.stroke()
      context.restore()
    },
  },
} satisfies Record<string, CanvasScene>

export type CanvasSceneName = keyof typeof canvasScenes
