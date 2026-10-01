import React from "react"
import { Select } from "@base-ui/react/select"

type Product = { sku: string; title: string }
const product: Product = { sku: "a-1", title: "Alpha" }

const fixture = (
  <Select.Root<Product> value={null} defaultValue={product} items={[{ value: product, label: "Alpha" }]}>
    <Select.Label />
    <Select.Trigger />
    <Select.Value placeholder="Choose" />
    <Select.Icon />
    <Select.Portal>
      <Select.Backdrop />
      <Select.Positioner>
        <Select.Popup>
          <Select.List>
            <Select.Group>
              <Select.GroupLabel>Products</Select.GroupLabel>
              <Select.Item value={product} label="Alpha">
                <Select.ItemIndicator />
                <Select.ItemText>Alpha</Select.ItemText>
              </Select.Item>
            </Select.Group>
            <Select.Arrow />
            <Select.ScrollUpArrow />
            <Select.ScrollDownArrow />
            <Select.Separator />
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>
)

void React
void fixture
