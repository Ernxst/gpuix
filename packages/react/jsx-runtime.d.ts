/// GPUIX JSX runtime types — maps intrinsic elements to GPUIX Props
/// instead of DOM types. Activated via "jsxImportSource": "@gpuix/react".
///
/// `key` is declared on `Props`, not on `IntrinsicAttributes` below.
/// TypeScript 5 ignores `IntrinsicAttributes` for intrinsic elements.

import type * as React from "react"
import type {
  AnchoredProps,
  CanvasProps,
  CodeProps,
  DiffProps,
  ImgProps,
  InputProps,
  MarkdownProps,
  Props,
  SvgProps,
  TextareaProps,
  VirtualListProps,
} from "./dist/types/host"

export { jsx, jsxs, Fragment } from "react/jsx-runtime"

export namespace JSX {
  type ElementType = React.JSX.ElementType
  type Element = React.JSX.Element
  type ElementClass = React.JSX.ElementClass
  type ElementAttributesProperty = React.JSX.ElementAttributesProperty
  type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute
  type IntrinsicAttributes = React.JSX.IntrinsicAttributes
  type IntrinsicClassAttributes<T> = React.JSX.IntrinsicClassAttributes<T>

  interface IntrinsicElements {
    div: Props
    text: Props
    main: Props
    header: Props
    footer: Props
    nav: Props
    section: Props
    article: Props
    aside: Props
    h1: Props
    h2: Props
    h3: Props
    h4: Props
    h5: Props
    h6: Props
    p: Props
    span: Props
    strong: Props
    em: Props
    ul: Props
    ol: Props
    li: Props
    a: Props & { href?: string; target?: string }
    button: Props & { type?: "button" | "submit" | "reset" }
    kbd: Props
    img: ImgProps
    svg: SvgProps
    canvas: CanvasProps
    input: InputProps
    textarea: TextareaProps
    anchored: AnchoredProps
    code: CodeProps
    diff: DiffProps
    markdown: MarkdownProps
    "virtual-list": VirtualListProps
  }
}
