/// Shared fixtures for the CSS 135deg repeating-hatch geometry: one plain
/// array consumed by both the Chromium golden generator
/// (`scripts/hatch-goldens.ts`) and the native pixel-comparison test
/// (`background-hatch-goldens.test.tsx`), so the two never drift apart.
///
/// Every case is run at both DPR 1 and DPR 2 by its consumers; this file only
/// declares the CSS-pixel (logical) geometry.

export interface HatchCase {
  name: string
  left: number
  top: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  background: string
  borderTopWidth: number
  borderRightWidth: number
  borderBottomWidth: number
  borderLeftWidth: number
}

export const hatchCases: readonly HatchCase[] = [
  {
    name: "base",
    left: 13,
    top: 17,
    width: 113,
    height: 79,
    viewportWidth: 160,
    viewportHeight: 120,
    background: "repeating-linear-gradient(135deg, #ff0000 0 4px, transparent 4px 12px)",
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
  },
  {
    name: "fractional",
    left: 13.25,
    top: 17.75,
    width: 113.5,
    height: 79.25,
    viewportWidth: 160,
    viewportHeight: 120,
    background: "repeating-linear-gradient(135deg, #ff0000 0 4px, transparent 4px 12px)",
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
  },
  {
    name: "transparent-border",
    left: 13.25,
    top: 17.75,
    width: 113.5,
    height: 79.25,
    viewportWidth: 160,
    viewportHeight: 120,
    background: "repeating-linear-gradient(135deg, #ff0000 0 4px, transparent 4px 12px)",
    borderTopWidth: 5,
    borderRightWidth: 7,
    borderBottomWidth: 11,
    borderLeftWidth: 3,
  },
  {
    name: "alpha",
    left: 13,
    top: 17,
    width: 113,
    height: 79,
    viewportWidth: 160,
    viewportHeight: 120,
    background:
      "repeating-linear-gradient(135deg, rgb(255 0 0 / 50%) 0 2px, transparent 2px 5px)",
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
  },
  {
    name: "tiny",
    left: 13,
    top: 17,
    width: 113,
    height: 79,
    viewportWidth: 160,
    viewportHeight: 120,
    background: "repeating-linear-gradient(135deg, #ff0000 0 0.25px, transparent 0.25px 0.75px)",
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
  },
  {
    name: "wide",
    left: 13,
    top: 17,
    width: 640,
    height: 480,
    viewportWidth: 680,
    viewportHeight: 520,
    background: "repeating-linear-gradient(135deg, #ff0000 0 200px, transparent 200px 500px)",
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
  },
]
