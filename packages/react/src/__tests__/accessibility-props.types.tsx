import React from "react"
import type { Props } from "../types/host.js"

const aliases = [
  <div
    aria-label="Settings"
    aria-description="Opens application settings"
    aria-checked
    aria-expanded
    aria-current="page"
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
  "aria-current": "page",
  "aria-selected": true,
  "aria-valuetext": "Medium",
  "aria-valuemin": 1,
  "aria-valuemax": 3,
  "aria-valuenow": 2,
  "aria-level": 2,
  "aria-disabled": true,
  "aria-hidden": false,
}
const currentTokens: Props[] = [
  { ariaCurrent: "page" },
  { ariaCurrent: "step" },
  { ariaCurrent: "location" },
  { ariaCurrent: "date" },
  { ariaCurrent: "time" },
  { ariaCurrent: "true" },
  { "aria-current": "false" },
]
// @ts-expect-error aria-busy has no supported GPUIX accessibility prop.
const unsupportedProps: Props = { "aria-busy": true }
// @ts-expect-error ariaCurrent accepts only the ARIA current-item token set.
const invalidCurrent: Props = { ariaCurrent: "chapter" }

void aliases
void aliasProps
void currentTokens
void unsupportedProps
void invalidCurrent
