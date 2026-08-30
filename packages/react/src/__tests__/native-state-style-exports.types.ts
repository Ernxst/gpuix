import type { CSSProperties } from "react"
import type { NativeStateStyle, NativeStateStyleKey, StyleDesc } from "@gpuix/react"

type SharedStyle = {
  [Property in keyof CSSProperties & keyof StyleDesc]?: Exclude<
    CSSProperties[Property],
    undefined
  > &
    Exclude<StyleDesc[Property], undefined>
}

type WidenedShared = SharedStyle & Pick<StyleDesc, NativeStateStyleKey>

const focusable: WidenedShared = {
  opacity: 0.5,
  focusVisible: { opacity: 1 },
}

const stateDeclaration: NativeStateStyle = { opacity: 1 }

void focusable
void stateDeclaration
