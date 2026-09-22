/**
 * Startup/memory/bundle-size fixture for `scripts/app-bench.ts`.
 *
 * One window, one line of text, ~400x300 — the same shape as
 * `packages/native/examples/hello_bench.rs`, the plain-GPUI baseline this
 * fixture is measured against. Deliberately small so the numbers reflect
 * GPUIX's own overhead, not app complexity.
 *
 * `react` and `@gpuix/react` are loaded with a dynamic `import()` rather than
 * a static one. A static import is resolved before any code in this module
 * runs, so it cannot be timed from inside the module; the dynamic import
 * gives the harness a real "import" phase to report alongside "render" and
 * "to-frame". JSX needs a statically-imported `jsx-runtime`, so this file
 * uses `React.createElement` directly instead.
 *
 * Run standalone: cd examples/bench && bun hello-gpuix.tsx
 * Compiled, as the harness runs it: bun build --compile hello-gpuix.tsx
 */

async function main(): Promise<void> {
  const tImportStart = performance.now()
  const [{ default: React }, { render, requestAnimationFrame }] = await Promise.all([
    import('react'),
    import('@gpuix/react'),
  ])
  const tImportEnd = performance.now()

  function App() {
    return React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 400,
          height: 300,
          backgroundColor: '#1e1e2e',
        },
      },
      React.createElement('div', { style: { color: '#cdd6f4', fontSize: 20 } }, 'Hello, GPUIX'),
    )
  }

  const tBeforeRender = performance.now()
  render(React.createElement(App), {
    title: 'GPUIX Bench Hello',
    width: 400,
    height: 300,
    // GPUIX_BENCH_BACKGROUND=1 opens the window unfocused, for a manual run
    // that must not steal focus. scripts/app-bench.ts does not set it: an
    // unfocused window opens behind the active app, and requestAnimationFrame
    // pauses while it is covered. See examples/bench/README.md.
    focus: process.env.GPUIX_BENCH_BACKGROUND !== '1',
  })
  const tAfterRender = performance.now()

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const tFrame = performance.now()
      const marker = {
        event: 'ready',
        readyAtEpochMs: performance.timeOrigin + tFrame,
        sinceStartMs: tFrame,
        phases: {
          import: tImportEnd - tImportStart,
          render: tAfterRender - tBeforeRender,
          toFrame: tFrame - tAfterRender,
        },
      }
      console.log(`GPUIX_BENCH ${JSON.stringify(marker)}`)
    })
  })
}

void main()
