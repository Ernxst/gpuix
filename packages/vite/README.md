# @gpuix/vite

Use Vite's Environment API to run a native GPUIX app in development. The Vite
process runs under Bun, so the native N-API binding and Vite share one runtime.

Install this package alongside `@gpuix/react` and Vite, then enable Bun's
package-script shim in `bunfig.toml`:

```toml
[run]
bun = true
```

Configure Vite with an application entry point:

```ts
import { defineConfig } from "vite"
import { gpuix } from "@gpuix/vite"

export default defineConfig({
  appType: "custom",
  plugins: [gpuix({ entry: "app.tsx" })],
})
```

Use the ordinary Vite command in `package.json`:

```json
{ "scripts": { "dev": "vite" } }
```

## Shared native and web config

When one Vite config also serves a browser entry, keep the React plugin enabled
and add `gpuix()` only in native mode:

```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { gpuix } from "@gpuix/vite"

export default defineConfig(({ mode }) => {
  const native = mode === "native"

  return {
    appType: native ? "custom" : "spa",
    plugins: [
      react({ jsxImportSource: "@gpuix/react" }),
      native && gpuix({ entry: "src/native.tsx" }),
    ],
  }
})
```

The React plugin refreshes Vite's client environment. GPUIX refreshes the
native environment, so the two plugins do not apply two Refresh wrappers to the
native app. `bunfig.toml` can remain in the project: it runs Vite under Bun but
does not change the browser bundle.

Component-only React edits use Fast Refresh and preserve state. Changes to a
module with incompatible exports, such as a TanStack Router route module,
perform Vite's ordinary reload and remount the native React tree. Rebuild and
restart Bun after changing Rust or the native binding.

For complete setup and packaging instructions, see the repository README.
