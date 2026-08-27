/**
 * Canvas command stream version 1.
 *
 * This file mirrors `packages/native/src/canvas/opcodes.rs`, which is the
 * canonical contract and arity documentation. Keep numeric changes atomic
 * across both files.
 */
export const CANVAS_STREAM_MAGIC = 0x47584332
export const CANVAS_STREAM_VERSION = 1

export const CANVAS_OPCODES = {
  save: 0x01,
  restore: 0x02,
  translate: 0x10,
  scale: 0x11,
  rotate: 0x12,
  transform: 0x13,
  setTransform: 0x14,
  resetTransform: 0x15,
  fillStyle: 0x20,
  strokeStyle: 0x21,
  lineWidth: 0x22,
  globalAlpha: 0x23,
  lineCap: 0x24,
  lineJoin: 0x25,
  miterLimit: 0x26,
  setLineDash: 0x27,
  lineDashOffset: 0x28,
  fillRect: 0x30,
  strokeRect: 0x31,
  clearRect: 0x32,
  beginPath: 0x40,
  moveTo: 0x41,
  lineTo: 0x42,
  bezierCurveTo: 0x43,
  quadraticCurveTo: 0x44,
  arc: 0x45,
  arcTo: 0x46,
  ellipse: 0x47,
  rect: 0x48,
  closePath: 0x49,
  fill: 0x4a,
  stroke: 0x4b,
  drawImage3: 0x50,
  drawImage5: 0x51,
  drawImage9: 0x52,
} as const
