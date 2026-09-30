/** Serve the React DOM comparison for inspection in the BB browser. */

import page from "./accessible-windowed-table.web.html"

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4174),
  routes: { "/": page },
  development: { hmr: true, console: true },
})

console.log(`React DOM comparison: ${server.url}`)
