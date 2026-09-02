/// The little PNG codec `toMatchScreenshot` needs, and nothing more.
///
/// The native renderer writes screenshots as files and compares them as files,
/// so the only pixels JavaScript has to touch are the ones a *clipped* capture
/// removes and the ones a diff image paints. Both need a decoder, and neither
/// justifies a dependency: this reads and writes exactly the 8-bit,
/// non-interlaced PNGs `captureScreenshot()` produces (colour type 6, RGBA),
/// plus the neighbouring 8-bit forms an externally produced golden might use,
/// and refuses everything else by name rather than guessing.

import { deflateSync, inflateSync } from "node:zlib"

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** A decoded image, always straight 8-bit RGBA regardless of the file's form. */
export interface RgbaImage {
  width: number
  height: number
  /** `width * height * 4` bytes, row-major. */
  data: Buffer
}

export interface PngSize {
  width: number
  height: number
}

function assertSignature(png: Buffer, label: string): void {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} is not a PNG`)
  }
}

/** Width and height from the IHDR alone — no inflate, no pixel work. */
export function readPngSize(png: Buffer, label = "image"): PngSize {
  assertSignature(png, label)
  if (png.length < 26 || png.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`${label} has no IHDR chunk`)
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

function channelsOf(colorType: number, label: string): number {
  switch (colorType) {
    case 0:
      return 1
    case 2:
      return 3
    case 4:
      return 2
    case 6:
      return 4
    default:
      throw new Error(
        `${label} uses PNG colour type ${colorType}; only 8-bit greyscale, RGB, and RGBA are supported`
      )
  }
}

/** Undo one scanline's filter in place, per the PNG spec's reconstruction rules. */
function unfilter(
  filter: number,
  current: Buffer,
  previous: Buffer,
  bytesPerPixel: number,
  label: string
): void {
  if (filter === 0) return
  if (filter > 4) throw new Error(`${label} uses unsupported PNG filter ${filter}`)

  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bytesPerPixel ? current[index - bytesPerPixel]! : 0
    const up = previous[index]!
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel]! : 0
    let addend = 0
    if (filter === 1) addend = left
    else if (filter === 2) addend = up
    else if (filter === 3) addend = (left + up) >> 1
    else {
      const predictor = left + up - upLeft
      const distanceLeft = Math.abs(predictor - left)
      const distanceUp = Math.abs(predictor - up)
      const distanceUpLeft = Math.abs(predictor - upLeft)
      addend =
        distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
          ? left
          : distanceUp <= distanceUpLeft
            ? up
            : upLeft
    }
    current[index] = (current[index]! + addend) & 0xff
  }
}

/** Decode a PNG into straight RGBA bytes. */
export function decodePng(png: Buffer, label = "image"): RgbaImage {
  assertSignature(png, label)

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = 0
  const idat: Buffer[] = []
  let offset = 8

  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset)
    const kind = png.subarray(offset + 4, offset + 8).toString("ascii")
    const data = png.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length

    if (kind === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]!
      colorType = data[9]!
      interlace = data[12]!
    } else if (kind === "IDAT") {
      idat.push(Buffer.from(data))
    } else if (kind === "IEND") {
      break
    }
  }

  if (bitDepth !== 8) throw new Error(`${label} uses PNG bit depth ${bitDepth}; only 8 is supported`)
  if (interlace !== 0) throw new Error(`${label} is interlaced; only non-interlaced PNGs are supported`)
  if (width === 0 || height === 0) throw new Error(`${label} has no pixels (${width}x${height})`)

  const channels = channelsOf(colorType, label)
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length < height * (stride + 1)) {
    throw new Error(`${label} is truncated: ${raw.length} bytes for ${height} rows of ${stride}`)
  }

  const rgba = Buffer.alloc(width * height * 4)
  let previous = Buffer.alloc(stride)
  let source = 0

  for (let row = 0; row < height; row += 1) {
    const filter = raw[source]!
    source += 1
    const line = Buffer.from(raw.subarray(source, source + stride))
    source += stride
    unfilter(filter, line, previous, channels, label)
    previous = line

    for (let column = 0; column < width; column += 1) {
      const from = column * channels
      const to = (row * width + column) * 4
      if (channels === 4) {
        line.copy(rgba, to, from, from + 4)
      } else if (channels === 3) {
        line.copy(rgba, to, from, from + 3)
        rgba[to + 3] = 255
      } else if (channels === 2) {
        rgba.fill(line[from]!, to, to + 3)
        rgba[to + 3] = line[from + 1]!
      } else {
        rgba.fill(line[from]!, to, to + 3)
        rgba[to + 3] = 255
      }
    }
  }

  return { width, height, data: rgba }
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value
  }
  return table
})()

function crc32(bytes: Buffer): number {
  let crc = -1
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ -1) >>> 0
}

function chunk(kind: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(kind, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/** Encode straight RGBA bytes as an 8-bit RGBA PNG, every scanline unfiltered. */
export function encodePng(image: RgbaImage): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(image.width, 0)
  header.writeUInt32BE(image.height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  const stride = image.width * 4
  const raw = Buffer.alloc(image.height * (stride + 1))
  for (let row = 0; row < image.height; row += 1) {
    raw[row * (stride + 1)] = 0 // filter: None
    image.data.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride)
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/** The sub-image inside `rect`, which must lie within the source. */
export function cropImage(image: RgbaImage, rect: PixelRect): RgbaImage {
  const { x, y, width, height } = rect
  if (
    width <= 0 ||
    height <= 0 ||
    x < 0 ||
    y < 0 ||
    x + width > image.width ||
    y + height > image.height
  ) {
    throw new RangeError(
      `Crop [x=${x}, y=${y}, width=${width}, height=${height}] does not fit inside ${image.width}x${image.height}`
    )
  }

  const data = Buffer.alloc(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * image.width + x) * 4
    image.data.copy(data, row * width * 4, from, from + width * 4)
  }
  return { width, height, data }
}

/**
 * A pixelmatch-shaped diff: pixels differing by more than `tolerance` in any
 * channel are painted red, everything else is the reference washed out, so the
 * differences read against a ghost of what was expected.
 */
export function diffImage(
  reference: RgbaImage,
  actual: RgbaImage,
  tolerance: number
): RgbaImage {
  if (reference.width !== actual.width || reference.height !== actual.height) {
    throw new RangeError(
      `Cannot diff ${reference.width}x${reference.height} against ${actual.width}x${actual.height}`
    )
  }

  const data = Buffer.alloc(reference.width * reference.height * 4)
  for (let pixel = 0; pixel < reference.width * reference.height; pixel += 1) {
    const at = pixel * 4
    let differs = false
    for (let channel = 0; channel < 4; channel += 1) {
      if (Math.abs(reference.data[at + channel]! - actual.data[at + channel]!) > tolerance) {
        differs = true
        break
      }
    }

    if (differs) {
      data[at] = 255
      data[at + 1] = 0
      data[at + 2] = 0
      data[at + 3] = 255
      continue
    }

    const luminance =
      0.2126 * reference.data[at]! + 0.7152 * reference.data[at + 1]! + 0.0722 * reference.data[at + 2]!
    // pixelmatch's `alpha: 0.1` wash: keep a tenth of the reference's contrast.
    const washed = Math.round(255 - (255 - luminance) * 0.1)
    data[at] = washed
    data[at + 1] = washed
    data[at + 2] = washed
    data[at + 3] = 255
  }

  return { width: reference.width, height: reference.height, data }
}
