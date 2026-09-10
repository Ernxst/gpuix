import { homedir } from "node:os"

import { latestAttachedContainer } from "./reconciler/event-registry.js"
import type { NativeRenderer } from "./types/host.js"

/** A browser-shaped file type declaration. GPUI's native picker does not enforce it. */
export type FilePickerAcceptType = {
  description?: string
  accept: Record<string, string[]>
}

export interface OpenFilePickerOptions {
  multiple?: boolean
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
  startIn?: string
}

export interface DirectoryPickerOptions {
  startIn?: string
}

export interface SaveFilePickerOptions {
  suggestedName?: string
  startIn?: string
  types?: FilePickerAcceptType[]
}

const NO_ROOT_ERROR = "No GPUIX root is mounted"

function rendererOrRejection(): NativeRenderer | undefined {
  const container = latestAttachedContainer()
  return container?.native
}

/** Open a native file picker and return absolute selected paths. */
export function showOpenFilePicker(options: OpenFilePickerOptions = {}): Promise<string[]> {
  const renderer = rendererOrRejection()
  if (!renderer) return Promise.reject(new Error(NO_ROOT_ERROR))
  if (!renderer.promptForPaths) {
    return Promise.reject(new Error("The renderer does not support file pickers"))
  }
  return renderer
    .promptForPaths({
      files: true,
      directories: false,
      multiple: options.multiple ?? false,
    })
    .then((paths) => paths ?? Promise.reject(abortError()))
}

/** Open a native directory picker and return the selected absolute path. */
export function showDirectoryPicker(options: DirectoryPickerOptions = {}): Promise<string> {
  void options
  const renderer = rendererOrRejection()
  if (!renderer) return Promise.reject(new Error(NO_ROOT_ERROR))
  if (!renderer.promptForPaths) {
    return Promise.reject(new Error("The renderer does not support file pickers"))
  }
  return renderer
    .promptForPaths({ files: false, directories: true, multiple: false })
    .then((paths) => {
      if (paths == null) return Promise.reject(abortError())
      return paths[0] ?? Promise.reject(new Error("The directory picker returned no path"))
    })
}

/** Open a native save picker and return the selected absolute path. */
export function showSaveFilePicker(options: SaveFilePickerOptions = {}): Promise<string> {
  void options.types
  const renderer = rendererOrRejection()
  if (!renderer) return Promise.reject(new Error(NO_ROOT_ERROR))
  if (!renderer.promptForNewPath) {
    return Promise.reject(new Error("The renderer does not support file pickers"))
  }
  return renderer
    .promptForNewPath(options.startIn ?? homedir(), options.suggestedName)
    .then((path) => path ?? Promise.reject(abortError()))
}

function abortError(): Error {
  if (typeof globalThis.DOMException === "function") {
    return new globalThis.DOMException("The user aborted a request.", "AbortError")
  }
  const error = new Error("The user aborted a request.")
  error.name = "AbortError"
  return error
}
