/**
 * Run from any shell with `bun /absolute/path/to/this-file.ts`.
 * Starts the already-built accessible-windowed-table example, records real
 * VoiceOver speech to /private/tmp/gpuix-695-voiceover-phrases.jsonl, and exits.
 */

import { appendFile, writeFile } from "node:fs/promises"
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { voiceOver } from "@guidepup/guidepup"

const examplesDir = import.meta.dir
const examplePath = join(examplesDir, "accessible-windowed-table.tsx")
const axProbePath = join(examplesDir, "dump-accessible-table-ax.swift")
const logPath = "/private/tmp/gpuix-695-voiceover-phrases.jsonl"
const TABLE_NAME = "Satisfactory item balance table"
const COMMAND_TIMEOUT_MS = 4_000
const OVERALL_TIMEOUT_MS = 150_000
const commandOptions = { timeout: COMMAND_TIMEOUT_MS, retries: 0 }

const pause = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms))
async function log(record: Record<string, unknown>) {
  await appendFile(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`)
}

async function record(action: string) {
  await pause()
  const phrase = await voiceOver.lastSpokenPhrase()
  await log({ action, phrase })
  return phrase
}

async function probeAccessibility(pid: number) {
  const probe = Bun.spawn(
    ["swift", axProbePath, String(pid), "--probe-only", "--timeout-ms=750"],
    { stdout: "pipe", stderr: "pipe" },
  )
  const output = Promise.all([probe.stdout.text(), probe.stderr.text()])
  const result = await Promise.race([
    probe.exited.then((exitCode) => ({ exitCode, timedOut: false })),
    pause(12_000).then(() => {
      probe.kill()
      return { exitCode: null, timedOut: true }
    }),
  ])
  const [stdout, stderr] = await output
  await log({
    axProbe: true,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  })
}

async function main() {
  await writeFile(logPath, "")
  const app = Bun.spawn([process.execPath, "--hot", examplePath], {
    cwd: examplesDir,
    stdout: "pipe",
    stderr: "pipe",
  })
  let stdout = ""
  let stderr = ""
  const capture = async (stream: ReadableStream<Uint8Array>, kind: string) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      if (kind === "stdout") stdout += chunk
      else stderr += chunk
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) await log({ app: kind, line })
    }
  }
  const appOutput = Promise.all([capture(app.stdout, "stdout"), capture(app.stderr, "stderr")])
  let started = false
  const watchdog = setTimeout(() => {
    appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), error: `Overall timeout after ${OVERALL_TIMEOUT_MS}ms` })}\n`)
    app.kill()
    if (started) {
      void voiceOver.stop(commandOptions).finally(() => process.exit(124))
      setTimeout(() => process.exit(124), 5_000)
    } else {
      process.exit(124)
    }
  }, OVERALL_TIMEOUT_MS)
  try {
    const deadline = Date.now() + 60_000
    while (!stdout.includes("[gpuix] mount complete")) {
      if (app.exitCode !== null) throw new Error(`Example exited before mounting (${app.exitCode}): ${stderr}`)
      if (Date.now() > deadline) throw new Error(`Timed out waiting for example to mount: ${stdout}\n${stderr}`)
      await pause(100)
    }
    await pause(750)
    await probeAccessibility(app.pid)
    await voiceOver.start({ ...commandOptions, capture: true })
    started = true
    await voiceOver.perform(voiceOver.commanderCommands.BRING_WINDOW_TO_FRONT, commandOptions)
    await record("front-window")

    await voiceOver.perform(voiceOver.commanderCommands.FIND_NEXT_TABLE, commandOptions)
    const tablePhrase = await record("find-next-table")
    await log({ expectedTable: TABLE_NAME, tablePhrase })
    if (!tablePhrase.toLowerCase().includes(TABLE_NAME.toLowerCase())) {
      throw new Error(`VoiceOver's next-table command did not expose ${JSON.stringify(TABLE_NAME)}: ${tablePhrase}`)
    }
    await voiceOver.interact(commandOptions)
    await record("interact-table")
    for (let i = 0; i < 24; i += 1) {
      await voiceOver.perform(voiceOver.commanderCommands.MOVE_DOWN, commandOptions)
      await record(`VO-Down:${i + 1}`)
    }
    for (let i = 0; i < 8; i += 1) {
      await voiceOver.perform(voiceOver.commanderCommands.MOVE_UP, commandOptions)
      await record(`VO-Up:${i + 1}`)
    }
    await voiceOver.stopInteracting(commandOptions)
    await record("stop-interacting")

    await voiceOver.perform(voiceOver.commanderCommands.FIND_NEXT_CONTROL, commandOptions)
    await record("find-next-row-control")
    await voiceOver.perform(voiceOver.commanderCommands.MOVE_KEYBOARD_FOCUS_TO_VOICEOVER_CURSOR, commandOptions)
    await record("keyboard-focus-to-row-control")
    for (let i = 0; i < 32; i += 1) {
      await voiceOver.press("Tab", commandOptions)
      await record(`Tab:${i + 1}`)
    }
    await log({ spokenPhraseLog: await voiceOver.spokenPhraseLog() })
  } catch (error) {
    await log({ error: error instanceof Error ? error.stack : String(error) })
    throw error
  } finally {
    clearTimeout(watchdog)
    if (started) await voiceOver.stop(commandOptions)
    app.kill()
    await appOutput
    await log({ result: "finished", logPath })
  }
}

main().catch((error) => {
  console.error(`Guidepup check failed; see ${logPath}`, error)
  process.exitCode = 1
})
