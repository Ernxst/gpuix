import React from "react"
import type { Props } from "../types/host.js"

const aliases = [
  <div aria-label="Settings" aria-hidden={false} />,
  <img aria-label="Preview" aria-hidden />,
]

const aliasProps: Props = { "aria-label": "Settings", "aria-hidden": false }
// @ts-expect-error aria-current has no supported GPUIX accessibility prop.
const unsupportedProps: Props = { "aria-current": "page" }

void aliases
void aliasProps
void unsupportedProps
