import React from "react"
import { Select as BaseSelect } from "@base-ui/react/select"
import { Combobox as BaseCombobox } from "@base-ui/react/combobox"
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip"
import * as GpuixSelect from "@gpuix/react/select"
import { Combobox as GpuixCombobox } from "@gpuix/react/combobox"
import { Tooltip as GpuixTooltip } from "@gpuix/react/tooltip"

const boundary = { x: 0, y: 0, width: 320, height: 240 }
const collisionPadding = { top: 8, right: 12, bottom: 8, left: 12 }

export function FloatingPositionerParityFixture() {
  return (
    <>
      <BaseSelect.Positioner anchor={null} side="inline-start" sideOffset={6} align="end" alignOffset={3} collisionBoundary={boundary} collisionPadding={collisionPadding} collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}><BaseSelect.Popup /></BaseSelect.Positioner>
      <BaseCombobox.Positioner anchor={null} side="inline-start" sideOffset={6} align="end" alignOffset={3} collisionBoundary={boundary} collisionPadding={collisionPadding} collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}><BaseCombobox.Popup /></BaseCombobox.Positioner>
      <BaseTooltip.Positioner anchor={null} side="inline-start" sideOffset={6} align="end" alignOffset={3} collisionBoundary={boundary} collisionPadding={collisionPadding} collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}><BaseTooltip.Popup>Tip</BaseTooltip.Popup></BaseTooltip.Positioner>
      <GpuixSelect.Positioner anchor={null} side="inline-start" sideOffset={6} align="end" alignOffset={3} collisionBoundary={boundary} collisionPadding={collisionPadding} collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}><GpuixSelect.Popup /></GpuixSelect.Positioner>
      <GpuixCombobox.Positioner anchor={null} side="inline-start" sideOffset={6} align="end" alignOffset={3} collisionBoundary={boundary} collisionPadding={collisionPadding} collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}><GpuixCombobox.Popup /></GpuixCombobox.Positioner>
      <GpuixTooltip.Positioner anchor={null} side="inline-start" sideOffset={6} align="end" alignOffset={3} collisionBoundary={boundary} collisionPadding={collisionPadding} collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}><GpuixTooltip.Popup>Tip</GpuixTooltip.Popup></GpuixTooltip.Positioner>
    </>
  )
}
