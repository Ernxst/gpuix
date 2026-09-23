/**
 * Compile the GPUIX chat example into a standalone Bun binary.
 * On macOS also wraps it in a .app so Finder and Dock can show a custom icon.
 *
 * CI sets COMPILE_OUT, COMPILE_TARGET, COMPILE_SKIP_ICONS, COMPILE_SKIP_APP.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'dist')
const SVG = path.join(ROOT, 'assets', 'icons', 'openai-mark.svg')
const PNG = path.join(DIST, 'app-icon.png')
const ICO = path.join(DIST, 'app-icon.ico')
const ICNS = path.join(DIST, 'app-icon.icns')
const COMPILE_TARGET = process.env.COMPILE_TARGET
const WINDOWS =
  process.platform === 'win32' || (COMPILE_TARGET ?? '').includes('windows')
const BINARY = path.join(DIST, outputName())
const APP_NAME = 'GPUIX Chat'
const APP_BUNDLE = path.join(DIST, `${APP_NAME}.app`)
const NATIVE_DIR = path.join(ROOT, '..', 'packages', 'native')
const APP_ENTRY_SOURCE = path.join(ROOT, '.app-entry.generated.ts')

// The `.node` napi-rs picks for this host. `wrapMacApp` only runs when
// compiling on macOS for macOS, so the running process's arch is the one
// that matters here.
function nativeAddonFileName(): string {
  return `gpuix-native.darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}.node`
}

function outputName(): string {
  const requested = process.env.COMPILE_OUT
  if (requested) {
    return WINDOWS && !requested.endsWith('.exe') ? `${requested}.exe` : requested
  }
  return WINDOWS ? 'chat.exe' : 'chat'
}

function log(message: string): void {
  console.log(`[compile-chat] ${message}`)
}

function hasCommand(command: string): boolean {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return result.status === 0
}

function run(command: string, args: string[], opts: { cwd?: string } = {}): void {
  log(`run: ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()
  if (stdout && command !== 'sips') console.log(stdout)
  if (stderr && command !== 'sips') console.error(stderr)
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit ${result.status}`)
  }
}

async function buildIcons(): Promise<void> {
  if (process.env.COMPILE_SKIP_ICONS === '1') {
    log('skipping icons')
    return
  }
  if (!hasCommand('rsvg-convert') || !hasCommand('magick')) {
    log('rsvg-convert or magick missing, skipping icons')
    return
  }

  log(`building icons from ${path.relative(ROOT, SVG)}`)
  const svg = (await Bun.file(SVG).text()).replace(
    'fill="currentColor"',
    'fill="#ffffff"',
  )
  const whiteSvg = path.join(DIST, 'app-icon.svg')
  await Bun.write(whiteSvg, svg)

  run('rsvg-convert', [
    '-w',
    '1024',
    '-h',
    '1024',
    '--background-color',
    '#10a37f',
    whiteSvg,
    '-o',
    PNG,
  ])
  log(`wrote ${path.relative(ROOT, PNG)}`)

  run('magick', [PNG, '-define', 'icon:auto-resize=256,128,64,48,32,16', ICO])
  log(`wrote ${path.relative(ROOT, ICO)}`)

  if (process.platform !== 'darwin') return

  const iconset = path.join(DIST, 'app-icon.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ] as const
  for (const [px, name] of sizes) {
    run('sips', ['-z', String(px), String(px), PNG, '--out', path.join(iconset, name)])
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', ICNS])
  log(`wrote ${path.relative(ROOT, ICNS)}`)
}

async function compileBinary(): Promise<void> {
  log('bundling chat.tsx into a standalone binary')
  const compile: {
    outfile: string
    target?: string
    windows?: {
      icon?: string
      hideConsole: boolean
      title: string
      publisher: string
      version: string
      description: string
    }
  } = {
    outfile: BINARY,
  }
  if (COMPILE_TARGET) {
    compile.target = COMPILE_TARGET
    log(`target ${COMPILE_TARGET}`)
  }
  if (WINDOWS) {
    compile.windows = {
      hideConsole: true,
      title: APP_NAME,
      publisher: 'GPUIX',
      version: '0.1.0',
      description: 'Native GPUIX chat example',
    }
    if (process.platform === 'win32' && existsSync(ICO)) {
      compile.windows.icon = ICO
    }
  }

  const result = await Bun.build({
    entrypoints: [path.join(ROOT, 'chat.tsx')],
    compile,
    minify: true,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  })
  if (!result.success) {
    for (const message of result.logs) console.error(message)
    throw new Error('bun build --compile failed')
  }
  const output = result.outputs[0]?.path ?? BINARY
  log(`wrote ${path.relative(ROOT, output)}`)
}

/**
 * Compile the `.app`'s executable so it does not embed the native addon.
 *
 * `bun build --compile` embeds any `.node` file it finds statically required
 * from the entrypoint, extracting it to `$TMPDIR` on first launch and paying
 * a Gatekeeper scan there every time that extraction is purged. Marking
 * `.node` files external stops the embedding; the addon then ships beside
 * the executable instead, in `Contents/Frameworks`.
 *
 * A plain `require('@gpuix/native')` can't find that file relative to a
 * bundled, single-file executable, so this writes a small entry file that
 * points `NAPI_RS_NATIVE_LIBRARY_PATH` — the environment variable napi-rs's
 * generated loader checks before anything else — at the addon's real path
 * next to the running executable, then loads the real entry. An app author
 * can reproduce this without any GPUIX-internal knowledge: set the env var
 * before importing anything that loads `@gpuix/native`, from `node:path`
 * and `process.execPath` alone.
 */
async function compileAppExecutable(executable: string): Promise<void> {
  const addonFileName = nativeAddonFileName()
  writeFileSync(
    APP_ENTRY_SOURCE,
    [
      "import path from 'node:path'",
      '',
      '// Contents/MacOS/chat -> ../Frameworks/<addon>.node',
      'const addon = path.join(',
      '  path.dirname(process.execPath),',
      "  '..',",
      "  'Frameworks',",
      `  ${JSON.stringify(addonFileName)},`,
      ')',
      'process.env.NAPI_RS_NATIVE_LIBRARY_PATH ??= addon',
      '',
      "await import('./chat.tsx')",
      '',
    ].join('\n'),
  )
  try {
    log(`bundling ${path.basename(APP_ENTRY_SOURCE)} into ${path.relative(ROOT, executable)}`)
    const result = await Bun.build({
      entrypoints: [APP_ENTRY_SOURCE],
      compile: { outfile: executable },
      external: ['*.node'],
      minify: true,
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    })
    if (!result.success) {
      for (const message of result.logs) console.error(message)
      throw new Error('bun build --compile failed for the .app executable')
    }
  } finally {
    rmSync(APP_ENTRY_SOURCE, { force: true })
  }
  run('chmod', ['+x', executable])
}

async function wrapMacApp(): Promise<void> {
  if (process.env.COMPILE_SKIP_APP === '1') return
  if (process.platform !== 'darwin') return
  if (COMPILE_TARGET && !COMPILE_TARGET.includes('darwin')) return

  log(`wrapping chat.tsx in ${path.basename(APP_BUNDLE)}`)
  rmSync(APP_BUNDLE, { recursive: true, force: true })
  const macos = path.join(APP_BUNDLE, 'Contents', 'MacOS')
  const resources = path.join(APP_BUNDLE, 'Contents', 'Resources')
  const frameworks = path.join(APP_BUNDLE, 'Contents', 'Frameworks')
  mkdirSync(macos, { recursive: true })
  mkdirSync(resources, { recursive: true })
  mkdirSync(frameworks, { recursive: true })

  const addonFileName = nativeAddonFileName()
  const addon = path.join(frameworks, addonFileName)
  run('cp', [path.join(NATIVE_DIR, addonFileName), addon])
  run('codesign', ['--force', '--sign', '-', addon])

  const executable = path.join(macos, 'chat')
  await compileAppExecutable(executable)
  if (existsSync(ICNS)) {
    run('cp', [ICNS, path.join(resources, 'AppIcon.icns')])
  }

  const iconEntries = existsSync(ICNS)
    ? ['  <key>CFBundleIconFile</key>', '  <string>AppIcon</string>']
    : []
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>CFBundleDevelopmentRegion</key>',
    '  <string>en</string>',
    '  <key>CFBundleDisplayName</key>',
    `  <string>${APP_NAME}</string>`,
    '  <key>CFBundleExecutable</key>',
    '  <string>chat</string>',
    ...iconEntries,
    '  <key>CFBundleIdentifier</key>',
    '  <string>dev.gpuix.chat</string>',
    '  <key>CFBundleInfoDictionaryVersion</key>',
    '  <string>6.0</string>',
    '  <key>CFBundleName</key>',
    `  <string>${APP_NAME}</string>`,
    '  <key>CFBundlePackageType</key>',
    '  <string>APPL</string>',
    '  <key>CFBundleShortVersionString</key>',
    '  <string>0.1.0</string>',
    '  <key>CFBundleVersion</key>',
    '  <string>1</string>',
    '  <key>LSMinimumSystemVersion</key>',
    '  <string>13.0</string>',
    '  <key>NSHighResolutionCapable</key>',
    '  <true/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
  writeFileSync(path.join(APP_BUNDLE, 'Contents', 'Info.plist'), plist)
  run('touch', [APP_BUNDLE])

  // Ad-hoc: there is no Developer ID certificate in this environment. This
  // reseals Contents/_CodeSignature over the addon now sitting in
  // Frameworks, which the earlier per-file signature alone doesn't cover.
  run('codesign', ['--force', '--deep', '--sign', '-', APP_BUNDLE])
  log(`wrote ${path.relative(ROOT, APP_BUNDLE)}`)
}

async function main(): Promise<void> {
  log(`output dir ${path.relative(ROOT, DIST) || '.'}`)
  rmSync(DIST, { recursive: true, force: true })
  mkdirSync(DIST, { recursive: true })
  await buildIcons()
  await compileBinary()
  await wrapMacApp()
  log('done')
  if (process.platform === 'darwin' && existsSync(APP_BUNDLE)) {
    log(`run: open "${APP_BUNDLE}"`)
  } else {
    log(`run: ${BINARY}`)
  }
}

await main()
