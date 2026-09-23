import { cn as mergeClassNames, type ClassValue } from "cn"
import {
  COMPILED_STYLE,
  UNRESOLVED_CLASS_NAMES,
  isCompiledStyle,
  unresolvedClassNames,
  type CompiledStyle,
} from "./class-names.js"

/**
 * Merge class names the way the running build represents them.
 *
 * A web build resolves `.module.css` imports to class-name strings, so this
 * delegates to the `cn` package it re-exports, including Tailwind conflict
 * resolution. A GPUIX build compiles those imports to tagged native styles
 * with `@gpuix/plugins/css`, so this merges compiled styles with later values
 * winning and carries unresolved class names for the renderer to report.
 */
export function cn(...inputs: ClassValue[]): string
export function cn(...inputs: (ClassValue | CompiledStyle)[]): string | CompiledStyle
export function cn(...inputs: (ClassValue | CompiledStyle)[]): string | CompiledStyle {
  const classNames: string[] = []
  let styles: Record<string, unknown> | undefined

  const collect = (input: ClassValue | CompiledStyle): void => {
    if (isCompiledStyle(input)) {
      classNames.push(...(unresolvedClassNames(input) ?? []))
      styles = Object.assign(styles ?? {}, input)
      return
    }

    if (Array.isArray(input)) {
      for (const nested of input) collect(nested)
      return
    }

    const className = mergeClassNames(input)
    if (className !== "") classNames.push(className)
  }

  for (const input of inputs) collect(input)

  if (styles === undefined) return mergeClassNames(...inputs)

  Object.defineProperty(styles, COMPILED_STYLE, { value: true })
  if (classNames.length > 0) {
    Object.defineProperty(styles, UNRESOLVED_CLASS_NAMES, {
      value: classNames,
      enumerable: false,
    })
  }
  return styles as unknown as CompiledStyle
}

export default cn
