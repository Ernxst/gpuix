import type { EventPayload } from "@gpuix/native"
import type { GpuixDataTransfer, GpuixFile, GpuixFileList } from "./synthetic-event.js"

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".zip": "application/zip",
}

function fileMetadata(path: string): Pick<GpuixFile, "size" | "lastModified"> {
  if (typeof process === "undefined") return { size: 0, lastModified: 0 }
  try {
    const getBuiltinModule = (
      process as NodeJS.Process & { getBuiltinModule?: (name: string) => unknown }
    ).getBuiltinModule
    const fs = getBuiltinModule?.("node:fs") as
      | typeof import("node:fs")
      | undefined
    if (!fs) return { size: 0, lastModified: 0 }
    const stats = fs.statSync(path)
    return { size: stats.size, lastModified: stats.mtimeMs }
  } catch {
    return { size: 0, lastModified: 0 }
  }
}

function basename(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return path.slice(separator + 1)
}

function extensionForPath(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "" : name.slice(dot).toLowerCase()
}

function fileForPath(path: string): GpuixFile {
  const extension = extensionForPath(path)
  return {
    name: basename(path),
    path,
    ...fileMetadata(path),
    type: MIME_TYPES[extension] ?? "",
  }
}

function fileList(files: GpuixFile[]): GpuixFileList {
  return Object.assign(files, {
    item(index: number): GpuixFile | null {
      return files[index] ?? null
    },
  })
}

export function createGpuixDataTransfer(
  nativeEvent: EventPayload,
  includeFiles: boolean
): GpuixDataTransfer {
  const files = includeFiles ? (nativeEvent.paths ?? []).map(fileForPath) : []
  return {
    files: fileList(files),
    types: ["Files"],
    dropEffect: "none",
    effectAllowed: "all",
    getData(): "" {
      return ""
    },
  }
}
