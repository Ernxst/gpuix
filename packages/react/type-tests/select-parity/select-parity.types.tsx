import React from "react"
import { Select as BaseSelect } from "@base-ui/react/select"
import { Select as GpuixSelect } from "@gpuix/react/select"

type Product = { sku: string; title: string }
const product: Product = { sku: "a-1", title: "Alpha" }

const baseUiFixture = (
  <BaseSelect.Root<Product> value={null} defaultValue={product} items={[{ value: product, label: "Alpha" }]}>
    <BaseSelect.Label />
    <BaseSelect.Trigger />
    <BaseSelect.Value placeholder="Choose" />
    <BaseSelect.Icon />
    <BaseSelect.Portal>
      <BaseSelect.Backdrop />
      <BaseSelect.Positioner>
        <BaseSelect.Popup>
          <BaseSelect.List>
            <BaseSelect.Group>
              <BaseSelect.GroupLabel>Products</BaseSelect.GroupLabel>
              <BaseSelect.Item value={product} label="Alpha">
                <BaseSelect.ItemIndicator />
                <BaseSelect.ItemText>Alpha</BaseSelect.ItemText>
              </BaseSelect.Item>
            </BaseSelect.Group>
            <BaseSelect.Arrow />
            <BaseSelect.ScrollUpArrow />
            <BaseSelect.ScrollDownArrow />
            <BaseSelect.Separator />
          </BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  </BaseSelect.Root>
)

const gpuixFixture = (
  <GpuixSelect.Root<Product> value={null} defaultValue={product} items={[{ value: product, label: "Alpha" }]}>
    <GpuixSelect.Label />
    <GpuixSelect.Trigger />
    <GpuixSelect.Value placeholder="Choose" />
    <GpuixSelect.Icon />
    <GpuixSelect.Portal>
      <GpuixSelect.Backdrop />
      <GpuixSelect.Positioner>
        <GpuixSelect.Popup>
          <GpuixSelect.List>
            <GpuixSelect.Group>
              <GpuixSelect.GroupLabel>Products</GpuixSelect.GroupLabel>
              <GpuixSelect.Item value={product} label="Alpha">
                <GpuixSelect.ItemIndicator />
                <GpuixSelect.ItemText>Alpha</GpuixSelect.ItemText>
              </GpuixSelect.Item>
            </GpuixSelect.Group>
            <GpuixSelect.Arrow />
            <GpuixSelect.ScrollUpArrow />
            <GpuixSelect.ScrollDownArrow />
            <GpuixSelect.Separator />
          </GpuixSelect.List>
        </GpuixSelect.Popup>
      </GpuixSelect.Positioner>
    </GpuixSelect.Portal>
  </GpuixSelect.Root>
)

void React
void baseUiFixture
void gpuixFixture
