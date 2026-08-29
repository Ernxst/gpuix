import React from "react"
import type { Props } from "../types/host.js"

const aliases = [
  <div
    aria-label="Settings"
    aria-description="Opens application settings"
    aria-checked
    aria-expanded
    aria-selected
    aria-valuetext="Medium"
    aria-valuemin={1}
    aria-valuemax={3}
    aria-valuenow={2}
    aria-level={2}
    aria-disabled
    aria-hidden={false}
  />,
  <img aria-label="Preview" aria-hidden />,
]

const aliasProps: Props = {
  "aria-label": "Settings",
  "aria-description": "Opens application settings",
  "aria-checked": true,
  "aria-expanded": true,
  "aria-selected": true,
  "aria-valuetext": "Medium",
  "aria-valuemin": 1,
  "aria-valuemax": 3,
  "aria-valuenow": 2,
  "aria-level": 2,
  "aria-disabled": true,
  "aria-hidden": false,
}
// @ts-expect-error aria-current has no supported GPUIX accessibility prop.
const unsupportedProps: Props = { "aria-current": "page" }

void aliases
void aliasProps
void unsupportedProps
