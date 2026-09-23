import { cn as mergeClassNames } from "cn"
import { UNRESOLVED_CLASS_NAMES, unresolvedClassNames } from "./class-names.js"
import type { StyleDesc } from "./types/host.js"

type ClassNameValue = string | false | null | undefined
type StyleValue = StyleDesc | false | null | undefined

/**
 * Merge class names the way the running build represents them.
 *
 * A web build resolves `.module.css` imports to class-name strings, so this
 * behaves exactly like the `cn` package it re-exports, Tailwind conflict
 * resolution included. A GPUIX build compiles those imports to native styles
 * with `@gpuix/plugins/css`, so the same call merges style objects instead,
 * later values winning. One call site works on both.
 *
 * The two forms cannot be mixed: a literal class name has no native meaning
 * and an inline style object has no web class to become. Literal class names
 * reaching a GPUIX build are kept on the result for the renderer to report.
 */
export function cn(...inputs: ClassNameValue[]): string
export function cn(...inputs: StyleValue[]): StyleDesc
export function cn(...inputs: (ClassNameValue | StyleValue)[]): string | StyleDesc {
  const classNames: string[] = []
  let styles: Record<string, unknown> | undefined

  for (const input of inputs) {
    if (input === null || input === undefined || input === false || input === "") continue
    if (typeof input === "string") {
      classNames.push(input)
      continue
    }
    if (typeof input !== "object") continue
    classNames.push(...(unresolvedClassNames(input) ?? []))
    styles = Object.assign(styles ?? {}, input)
  }

  if (styles === undefined) return mergeClassNames(...classNames)

  if (classNames.length > 0) {
    Object.defineProperty(styles, UNRESOLVED_CLASS_NAMES, {
      value: classNames,
      enumerable: false,
    })
  }
  return styles as StyleDesc
}

export default cn
