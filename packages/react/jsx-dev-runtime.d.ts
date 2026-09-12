/// GPUIX JSX dev-runtime types — mirrors jsx-runtime.d.ts for development builds.
///
/// React 19's `react/jsx-dev-runtime` exports only `jsxDEV`, so the aliases here
/// must match jsx-dev-runtime.js instead of re-exporting `jsx` and `jsxs`.

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

export { jsxDEV, jsxDEV as jsx, jsxDEV as jsxs, Fragment } from "react/jsx-dev-runtime"

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
    abbr: Props
    address: Props
    b: Props
    blockquote: Props
    cite: Props
    del: Props
    dfn: Props
    figure: Props
    figcaption: Props
    i: Props
    ins: Props
    mark: Props
    menu: Props
    pre: Props
    s: Props
    samp: Props
    small: Props
    sub: Props
    sup: Props
    time: Props
    u: Props
    var: Props
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
