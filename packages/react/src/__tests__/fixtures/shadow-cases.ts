/// Shared fixtures for `boxShadow` layering and inset geometry, consumed by
/// both the Chromium golden generator (`scripts/shadow-goldens.ts`) and the
/// native pixel-comparison test (`box-shadow-goldens.test.tsx`), so the two
/// never drift apart.
///
/// Every case is run at both DPR 1 and DPR 2 by its consumers; this file only
/// declares the CSS-pixel (logical) geometry.

export interface ShadowLayer {
  offsetX: number
  offsetY: number
  blurRadius: number
  spreadRadius: number
  color: string
  inset?: boolean
}

export interface ShadowCase {
  name: string
  left: number
  top: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  background: string
  borderWidth: number
  borderColor: string
  /**
   * Authored in CSS `box-shadow` order: the first layer paints on top of
   * every layer that follows it.
   */
  layers: ShadowLayer[]
}

/** Renders `layers` as a CSS `box-shadow` declaration value. */
export function cssBoxShadow(layers: readonly ShadowLayer[]): string {
  if (layers.length === 0) return "none"
  return layers
    .map((layer) => {
      const parts = [
        `${layer.offsetX}px`,
        `${layer.offsetY}px`,
        `${layer.blurRadius}px`,
        `${layer.spreadRadius}px`,
        layer.color,
      ]
      return layer.inset ? `${parts.join(" ")} inset` : parts.join(" ")
    })
    .join(", ")
}

export const shadowCases: readonly ShadowCase[] = [
  {
    // Two opaque, unblurred drop layers whose rectangles overlap: if the
    // first layer isn't painted on top of the second, the overlap region
    // shows the wrong color.
    name: "overlapping-drop-layers",
    left: 40,
    top: 40,
    width: 80,
    height: 60,
    viewportWidth: 200,
    viewportHeight: 160,
    background: "#101010",
    borderWidth: 0,
    borderColor: "transparent",
    layers: [
      { offsetX: 30, offsetY: 20, blurRadius: 0, spreadRadius: 0, color: "#ff2d55" },
      { offsetX: 15, offsetY: 10, blurRadius: 0, spreadRadius: 0, color: "#2d7dff" },
    ],
  },
  {
    // An inset layer on a bordered element. The unshadowed "hole" is sized
    // and positioned relative to the padding box (border box inset by the
    // border width); painting it relative to the border box instead would
    // shift and enlarge the hole by twice the border width.
    name: "inset-padding-box",
    left: 40,
    top: 30,
    width: 100,
    height: 70,
    viewportWidth: 200,
    viewportHeight: 150,
    background: "#ffffff",
    borderWidth: 10,
    borderColor: "#202020",
    layers: [{ offsetX: 8, offsetY: 6, blurRadius: 0, spreadRadius: 4, color: "#ff5c7a", inset: true }],
  },
  {
    // A two-layer blurred elevation, the shape most component libraries use
    // for card/menu shadows. Blur rasterization can legitimately diverge
    // slightly between GPUI's shader and Chromium's, so this case's
    // tolerance is measured rather than fixed at 2 (see the golden test).
    name: "blurred-elevation",
    left: 40,
    top: 40,
    width: 120,
    height: 80,
    viewportWidth: 240,
    viewportHeight: 200,
    background: "#ffffff",
    borderWidth: 0,
    borderColor: "transparent",
    layers: [
      { offsetX: 0, offsetY: 4, blurRadius: 6, spreadRadius: -1, color: "rgba(0, 0, 0, 0.1)" },
      { offsetX: 0, offsetY: 10, blurRadius: 15, spreadRadius: -3, color: "rgba(0, 0, 0, 0.15)" },
    ],
  },
]
