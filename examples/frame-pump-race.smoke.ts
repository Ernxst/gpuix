const child = Bun.spawn(["bun", "frame-pump-race.ts"], {
  cwd: import.meta.dir,
  stdout: "pipe",
  stderr: "pipe",
})

const outputPromise = Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
]).then((parts) => parts.join(""))

let timedOut = false
const timeout = setTimeout(() => {
  timedOut = true
  child.kill()
}, 2_000)
const exitCode = await child.exited
clearTimeout(timeout)
const output = await outputPromise

if (timedOut) {
  throw new Error(`Frame-pump race timed out before pump return or TSFN service\n${output}`)
}
if (exitCode !== 0) {
  throw new Error(`Frame-pump race child exited with ${exitCode}\n${output}`)
}
if (!output.includes("PUMP_RACE_RETURN ")) {
  throw new Error(`Frame-pump race did not report a bounded return\n${output}`)
}
if (!output.includes("PUMP_RACE_CALLBACK ")) {
  throw new Error(`Frame-pump race did not service the queued TSFN\n${output}`)
}

process.stdout.write(output)
