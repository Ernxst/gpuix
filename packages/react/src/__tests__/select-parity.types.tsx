import React from "react"
import * as BaseSelect from "@base-ui/react/select"
import * as GpuixSelect from "../../dist/components/select.js"
import type { Props } from "../../dist/index.js"

type Product = { sku: string; title: string }
const product: Product = { sku: "a-1", title: "Alpha" }
const edge = { x: 0, y: 0, width: 320, height: 640 }

const baseFixture = (
  <BaseSelect.Select.Root<Product>
    value={product}
    defaultValue={product}
    onValueChange={(value, details) => {
      value?.sku
      details.reason
      details.event
    }}
    onOpenChange={(open, details) => {
      open.valueOf()
      details.reason
    }}
    items={[{ value: product, label: "Alpha" }]}
  >
    <BaseSelect.Select.Label className={undefined} style={undefined} />
    <BaseSelect.Select.Trigger render={<button />} className={(state) => state.open ? "open" : undefined} />
    <BaseSelect.Select.Value placeholder="Choose" />
    <BaseSelect.Select.Portal container={null}>
      <BaseSelect.Select.Backdrop />
      <BaseSelect.Select.Positioner
        anchor={null}
        side="bottom"
        align="end"
        sideOffset={({ anchor: size }) => size.height}
        alignOffset={2}
        positionMethod="fixed"
        collisionBoundary={edge}
        collisionPadding={{ top: 8, right: 12, bottom: 8, left: 12 }}
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}
        sticky
        arrowPadding={4}
        disableAnchorTracking
        alignItemWithTrigger
        style={(state) => state.open ? { opacity: 1 } : {}}
      >
        <BaseSelect.Select.Popup finalFocus={false}>
          <BaseSelect.Select.List>
            <BaseSelect.Select.Group>
              <BaseSelect.Select.GroupLabel>Products</BaseSelect.Select.GroupLabel>
              <BaseSelect.Select.Item value={product} label="Alpha" render={<div />} />
            </BaseSelect.Select.Group>
            <BaseSelect.Select.ItemIndicator keepMounted />
            <BaseSelect.Select.ItemText>Alpha</BaseSelect.Select.ItemText>
            <BaseSelect.Select.Arrow />
            <BaseSelect.Select.ScrollUpArrow keepMounted />
            <BaseSelect.Select.ScrollDownArrow keepMounted />
            <BaseSelect.Select.Separator orientation="vertical" />
          </BaseSelect.Select.List>
        </BaseSelect.Select.Popup>
      </BaseSelect.Select.Positioner>
    </BaseSelect.Select.Portal>
  </BaseSelect.Select.Root>
)

const gpuixFixture = (
  <GpuixSelect.Root<Product>
    value={product}
    defaultValue={product}
    onValueChange={(value, details) => {
      value?.sku
      details.reason
      details.event
    }}
    onOpenChange={(open, details) => {
      open.valueOf()
      details.reason
    }}
    items={[{ value: product, label: "Alpha" }]}
  >
    <GpuixSelect.Label className={undefined} style={undefined} />
    <GpuixSelect.Trigger render={<button />} className={(state) => state.open ? "open" : undefined} />
    <GpuixSelect.Value placeholder="Choose" />
    <GpuixSelect.Portal container={null}>
      <GpuixSelect.Backdrop />
      <GpuixSelect.Positioner
        anchor={null}
        side="bottom"
        align="end"
        sideOffset={({ anchor: size }) => size.height}
        alignOffset={2}
        positionMethod="fixed"
        collisionBoundary={edge}
        collisionPadding={{ top: 8, right: 12, bottom: 8, left: 12 }}
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}
        sticky
        arrowPadding={4}
        disableAnchorTracking
        alignItemWithTrigger
        style={(state) => state.open ? { opacity: 1 } : {}}
      >
        <GpuixSelect.Popup finalFocus={false}>
          <GpuixSelect.List>
            <GpuixSelect.Group>
              <GpuixSelect.GroupLabel>Products</GpuixSelect.GroupLabel>
              <GpuixSelect.Item value={product} label="Alpha" render={<div />} />
            </GpuixSelect.Group>
            <GpuixSelect.ItemIndicator keepMounted />
            <GpuixSelect.ItemText>Alpha</GpuixSelect.ItemText>
            <GpuixSelect.Arrow />
            <GpuixSelect.ScrollUpArrow keepMounted />
            <GpuixSelect.ScrollDownArrow keepMounted />
            <GpuixSelect.Separator orientation="vertical" />
          </GpuixSelect.List>
        </GpuixSelect.Popup>
      </GpuixSelect.Positioner>
    </GpuixSelect.Portal>
  </GpuixSelect.Root>
)

const nativeHostProp: Props["style"] = { width: 240 }
void baseFixture
void gpuixFixture
void nativeHostProp
