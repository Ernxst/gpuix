/** Inspect the live React DOM page and Chromium accessibility tree via bb browser CDP. */

import { readFile } from "node:fs/promises"

interface ConnectionFile {
  wsEndpoint: string
}

const connectionPath = process.argv.at(-1)
if (!connectionPath) throw new Error("Pass the private JSON path from `bb browser connection`")

const connection = JSON.parse(await readFile(connectionPath, "utf8")) as ConnectionFile
const socket = new WebSocket(connection.wsEndpoint)
await new Promise<void>((resolve, reject) => {
  socket.addEventListener("open", () => resolve(), { once: true })
  socket.addEventListener("error", () => reject(new Error("Could not connect to the leased bb browser")), { once: true })
})

let commandId = 0
const pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: Error): void }>()
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(String(data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } }
  if (message.id === undefined) return
  const promise = pending.get(message.id)
  if (!promise) return
  pending.delete(message.id)
  if (message.error) promise.reject(new Error(message.error.message))
  else promise.resolve(message.result ?? {})
})

function send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
  const id = ++commandId
  const promise = new Promise<Record<string, unknown>>((resolve, reject) => pending.set(id, { resolve, reject }))
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  return promise
}

try {
  const { targetInfos } = await send("Target.getTargets") as { targetInfos: Array<{ targetId: string; type: string; url: string }> }
  const target = targetInfos.find((item) => item.url.includes("localhost:4174"))
  if (!target) throw new Error(`No React DOM comparison page is open in the leased bb browser: ${JSON.stringify(targetInfos)}`)
  const { sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }) as { sessionId: string }

  const { result: remote } = await send("Runtime.evaluate", {
    expression: `new Promise(resolve => {
      const inspect = () => {
        if (document.getElementById("report")?.textContent?.startsWith("Waiting")) return requestAnimationFrame(inspect);
        const table = document.querySelector('[role="table"]');
        const list = document.querySelector("virtual-list");
        const rows = list ? [...list.querySelectorAll('[role="row"]')] : [];
        resolve({
          url: location.href,
          tableRole: table?.getAttribute("role"),
          ariaLabel: table?.getAttribute("aria-label"),
          ariaRowCount: table?.getAttribute("aria-rowcount"),
          rowgroupRole: list?.getAttribute("role"),
          itemCountAttribute: list?.getAttribute("itemcount"),
          mountedRows: rows.length,
          firstRowIndex: rows[0]?.getAttribute("aria-rowindex"),
          lastRowIndex: rows.at(-1)?.getAttribute("aria-rowindex"),
          scrollHeight: list?.scrollHeight,
          clientHeight: list?.clientHeight,
          summary: document.getElementById("report")?.textContent,
        });
      };
      inspect();
    })`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId) as { result: { value: Record<string, unknown> } }
  const dom = remote.value

  const { nodes } = await send("Accessibility.getFullAXTree", {}, sessionId) as { nodes: Array<{
    role?: { value?: string }
    name?: { value?: string }
    properties?: Array<{ name: string; value?: { value?: unknown } }>
    childIds?: string[]
  }> }
  const roles = new Set(["table", "rowgroup", "row", "columnheader", "cell", "button"])
  const ax = nodes
    .filter((node) => roles.has(node.role?.value ?? ""))
    .map((node) => ({
      role: node.role?.value,
      name: node.name?.value,
      properties: node.properties
        ?.filter((property) => ["rowCount", "rowIndex"].includes(property.name))
        .map((property) => ({ name: property.name, value: property.value?.value })),
      childIds: node.childIds?.length,
    }))

  console.log(JSON.stringify({ dom, axNodes: ax }, null, 2))
} finally {
  socket.close()
}
