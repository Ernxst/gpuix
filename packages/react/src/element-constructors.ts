/**
 * Runtime `Node`, `Element`, `HTMLElement`, and common `HTML*Element`
 * constructors for `@gpuix/react/globals`.
 *
 * They exist so browser-oriented guards such as `value instanceof HTMLElement`
 * can run against GPUIX refs. They are identity only: the prototypes carry no
 * DOM members, and constructing one throws, as it does in a browser. A ref's
 * members come from `PublicInstance`, not from these classes.
 *
 * `instanceof` reads the authored host type from the reconciler's registry, not
 * the object's prototype chain. A `<button>` is an `HTMLButtonElement` even
 * though the native renderer paints it through a GPUI `div`, and a plain object
 * with a matching `type` is not an element.
 */
import { hostElementType } from "./reconciler/host-config.js"

export class Node {
  constructor() {
    throw new TypeError("Illegal constructor")
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return hostElementType(value) !== null
  }
}

// Inherits `Node`'s check: every host node a ref can reach is an element.
export class Element extends Node {}

export class HTMLElement extends Element {
  // `<svg>` is an `SVGElement` in the DOM. Every other host type is an
  // `HTMLElement`, including GPUIX's own names: a browser gives an unknown tag
  // `HTMLUnknownElement` and a hyphenated one `HTMLElement`, both subclasses.
  static [Symbol.hasInstance](value: unknown): boolean {
    const type = hostElementType(value)
    return type !== null && type !== "svg"
  }
}

export class HTMLDivElement extends HTMLElement {
  static [Symbol.hasInstance](value: unknown): boolean {
    return hostElementType(value) === "div"
  }
}

export class HTMLButtonElement extends HTMLElement {
  static [Symbol.hasInstance](value: unknown): boolean {
    return hostElementType(value) === "button"
  }
}

export class HTMLInputElement extends HTMLElement {
  static [Symbol.hasInstance](value: unknown): boolean {
    return hostElementType(value) === "input"
  }
}

export class HTMLTextAreaElement extends HTMLElement {
  static [Symbol.hasInstance](value: unknown): boolean {
    return hostElementType(value) === "textarea"
  }
}
