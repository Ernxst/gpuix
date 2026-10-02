import React from "react"
import { Select as BaseSelect } from "@base-ui/react/select"
import { Select as GpuixSelect } from "@gpuix/react/select"
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip"
import { Tooltip as GpuixTooltip } from "@gpuix/react/tooltip"
import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { Dialog as GpuixDialog } from "@gpuix/react/dialog"
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog"
import { AlertDialog as GpuixAlertDialog } from "@gpuix/react/alert-dialog"
import type { SelectItemProps, SelectItemTextProps } from "@gpuix/react/select"

type Product = { sku: string; title: string }
const product: Product = { sku: "a-1", title: "Alpha" }

type Part<Props, State> = { props: Props; state: State }

type SelectPartTypes = {
  Root: Part<BaseSelect.Root.Props<Product>, BaseSelect.Root.State>
  Label: Part<BaseSelect.Label.Props, BaseSelect.Label.State>
  Trigger: Part<BaseSelect.Trigger.Props, BaseSelect.Trigger.State>
  Value: Part<BaseSelect.Value.Props, BaseSelect.Value.State>
  Icon: Part<BaseSelect.Icon.Props, BaseSelect.Icon.State>
  Portal: Part<BaseSelect.Portal.Props, BaseSelect.Portal.State>
  Backdrop: Part<BaseSelect.Backdrop.Props, BaseSelect.Backdrop.State>
  Positioner: Part<BaseSelect.Positioner.Props, BaseSelect.Positioner.State>
  Popup: Part<BaseSelect.Popup.Props, BaseSelect.Popup.State>
  List: Part<BaseSelect.List.Props, BaseSelect.List.State>
  Item: Part<BaseSelect.Item.Props, BaseSelect.Item.State>
  ItemIndicator: Part<BaseSelect.ItemIndicator.Props, BaseSelect.ItemIndicator.State>
  ItemText: Part<BaseSelect.ItemText.Props, BaseSelect.ItemText.State>
  Arrow: Part<BaseSelect.Arrow.Props, BaseSelect.Arrow.State>
  ScrollDownArrow: Part<BaseSelect.ScrollDownArrow.Props, BaseSelect.ScrollDownArrow.State>
  ScrollUpArrow: Part<BaseSelect.ScrollUpArrow.Props, BaseSelect.ScrollUpArrow.State>
  Group: Part<BaseSelect.Group.Props, BaseSelect.Group.State>
  GroupLabel: Part<BaseSelect.GroupLabel.Props, BaseSelect.GroupLabel.State>
  Separator: Part<BaseSelect.Separator.Props, BaseSelect.Separator.State>
}
type SelectRootTypes = { actions: BaseSelect.Root.Actions; changeEventReason: BaseSelect.Root.ChangeEventReason; changeEventDetails: BaseSelect.Root.ChangeEventDetails }

type TooltipPartTypes = {
  Root: Part<BaseTooltip.Root.Props, BaseTooltip.Root.State>
  Trigger: Part<BaseTooltip.Trigger.Props, BaseTooltip.Trigger.State>
  Portal: Part<BaseTooltip.Portal.Props, BaseTooltip.Portal.State>
  Positioner: Part<BaseTooltip.Positioner.Props, BaseTooltip.Positioner.State>
  Popup: Part<BaseTooltip.Popup.Props, BaseTooltip.Popup.State>
  Arrow: Part<BaseTooltip.Arrow.Props, BaseTooltip.Arrow.State>
  Viewport: Part<BaseTooltip.Viewport.Props, BaseTooltip.Viewport.State>
  Provider: Part<BaseTooltip.Provider.Props, BaseTooltip.Provider.State>
}
type TooltipRootTypes = { actions: BaseTooltip.Root.Actions; changeEventReason: BaseTooltip.Root.ChangeEventReason; changeEventDetails: BaseTooltip.Root.ChangeEventDetails }

type DialogPartTypes = {
  Root: Part<BaseDialog.Root.Props, BaseDialog.Root.State>
  Trigger: Part<BaseDialog.Trigger.Props, BaseDialog.Trigger.State>
  Portal: Part<BaseDialog.Portal.Props, BaseDialog.Portal.State>
  Popup: Part<BaseDialog.Popup.Props, BaseDialog.Popup.State>
  Backdrop: Part<BaseDialog.Backdrop.Props, BaseDialog.Backdrop.State>
  Title: Part<BaseDialog.Title.Props, BaseDialog.Title.State>
  Description: Part<BaseDialog.Description.Props, BaseDialog.Description.State>
  Close: Part<BaseDialog.Close.Props, BaseDialog.Close.State>
  Viewport: Part<BaseDialog.Viewport.Props, BaseDialog.Viewport.State>
}
type DialogRootTypes = { actions: BaseDialog.Root.Actions; changeEventReason: BaseDialog.Root.ChangeEventReason; changeEventDetails: BaseDialog.Root.ChangeEventDetails }

type AlertDialogPartTypes = {
  Root: Part<BaseAlertDialog.Root.Props, BaseAlertDialog.Root.State>
  Trigger: Part<BaseAlertDialog.Trigger.Props, BaseAlertDialog.Trigger.State>
  Portal: Part<BaseAlertDialog.Portal.Props, BaseAlertDialog.Portal.State>
  Popup: Part<BaseAlertDialog.Popup.Props, BaseAlertDialog.Popup.State>
  Backdrop: Part<BaseAlertDialog.Backdrop.Props, BaseAlertDialog.Backdrop.State>
  Title: Part<BaseAlertDialog.Title.Props, BaseAlertDialog.Title.State>
  Description: Part<BaseAlertDialog.Description.Props, BaseAlertDialog.Description.State>
  Close: Part<BaseAlertDialog.Close.Props, BaseAlertDialog.Close.State>
  Viewport: Part<BaseAlertDialog.Viewport.Props, BaseAlertDialog.Viewport.State>
}
type AlertDialogRootTypes = { actions: BaseAlertDialog.Root.Actions; changeEventReason: BaseAlertDialog.Root.ChangeEventReason; changeEventDetails: BaseAlertDialog.Root.ChangeEventDetails }

type GpuixSelectPartTypes = {
  Root: Part<GpuixSelect.Root.Props<Product>, GpuixSelect.Root.State>
  Label: Part<GpuixSelect.Label.Props, GpuixSelect.Label.State>
  Trigger: Part<GpuixSelect.Trigger.Props, GpuixSelect.Trigger.State>
  Value: Part<GpuixSelect.Value.Props, GpuixSelect.Value.State>
  Icon: Part<GpuixSelect.Icon.Props, GpuixSelect.Icon.State>
  Portal: Part<GpuixSelect.Portal.Props, GpuixSelect.Portal.State>
  Backdrop: Part<GpuixSelect.Backdrop.Props, GpuixSelect.Backdrop.State>
  Positioner: Part<GpuixSelect.Positioner.Props, GpuixSelect.Positioner.State>
  Popup: Part<GpuixSelect.Popup.Props, GpuixSelect.Popup.State>
  List: Part<GpuixSelect.List.Props, GpuixSelect.List.State>
  Item: Part<GpuixSelect.Item.Props, GpuixSelect.Item.State>
  ItemIndicator: Part<GpuixSelect.ItemIndicator.Props, GpuixSelect.ItemIndicator.State>
  ItemText: Part<GpuixSelect.ItemText.Props, GpuixSelect.ItemText.State>
  Arrow: Part<GpuixSelect.Arrow.Props, GpuixSelect.Arrow.State>
  ScrollDownArrow: Part<GpuixSelect.ScrollDownArrow.Props, GpuixSelect.ScrollDownArrow.State>
  ScrollUpArrow: Part<GpuixSelect.ScrollUpArrow.Props, GpuixSelect.ScrollUpArrow.State>
  Group: Part<GpuixSelect.Group.Props, GpuixSelect.Group.State>
  GroupLabel: Part<GpuixSelect.GroupLabel.Props, GpuixSelect.GroupLabel.State>
  Separator: Part<GpuixSelect.Separator.Props, GpuixSelect.Separator.State>
}
type GpuixSelectRootTypes = { actions: GpuixSelect.Root.Actions; changeEventReason: GpuixSelect.Root.ChangeEventReason; changeEventDetails: GpuixSelect.Root.ChangeEventDetails }

type GpuixTooltipPartTypes = {
  Root: Part<GpuixTooltip.Root.Props, GpuixTooltip.Root.State>
  Trigger: Part<GpuixTooltip.Trigger.Props, GpuixTooltip.Trigger.State>
  Portal: Part<GpuixTooltip.Portal.Props, GpuixTooltip.Portal.State>
  Positioner: Part<GpuixTooltip.Positioner.Props, GpuixTooltip.Positioner.State>
  Popup: Part<GpuixTooltip.Popup.Props, GpuixTooltip.Popup.State>
  Arrow: Part<GpuixTooltip.Arrow.Props, GpuixTooltip.Arrow.State>
  Viewport: Part<GpuixTooltip.Viewport.Props, GpuixTooltip.Viewport.State>
  Provider: Part<GpuixTooltip.Provider.Props, GpuixTooltip.Provider.State>
}
type GpuixTooltipRootTypes = { actions: GpuixTooltip.Root.Actions; changeEventReason: GpuixTooltip.Root.ChangeEventReason; changeEventDetails: GpuixTooltip.Root.ChangeEventDetails }

type GpuixDialogPartTypes = {
  Root: Part<GpuixDialog.Root.Props, GpuixDialog.Root.State>
  Trigger: Part<GpuixDialog.Trigger.Props, GpuixDialog.Trigger.State>
  Portal: Part<GpuixDialog.Portal.Props, GpuixDialog.Portal.State>
  Popup: Part<GpuixDialog.Popup.Props, GpuixDialog.Popup.State>
  Backdrop: Part<GpuixDialog.Backdrop.Props, GpuixDialog.Backdrop.State>
  Title: Part<GpuixDialog.Title.Props, GpuixDialog.Title.State>
  Description: Part<GpuixDialog.Description.Props, GpuixDialog.Description.State>
  Close: Part<GpuixDialog.Close.Props, GpuixDialog.Close.State>
  Viewport: Part<GpuixDialog.Viewport.Props, GpuixDialog.Viewport.State>
}
type GpuixDialogRootTypes = { actions: GpuixDialog.Root.Actions; changeEventReason: GpuixDialog.Root.ChangeEventReason; changeEventDetails: GpuixDialog.Root.ChangeEventDetails }

type GpuixAlertDialogPartTypes = {
  Root: Part<GpuixAlertDialog.Root.Props, GpuixAlertDialog.Root.State>
  Trigger: Part<GpuixAlertDialog.Trigger.Props, GpuixAlertDialog.Trigger.State>
  Portal: Part<GpuixAlertDialog.Portal.Props, GpuixAlertDialog.Portal.State>
  Popup: Part<GpuixAlertDialog.Popup.Props, GpuixAlertDialog.Popup.State>
  Backdrop: Part<GpuixAlertDialog.Backdrop.Props, GpuixAlertDialog.Backdrop.State>
  Title: Part<GpuixAlertDialog.Title.Props, GpuixAlertDialog.Title.State>
  Description: Part<GpuixAlertDialog.Description.Props, GpuixAlertDialog.Description.State>
  Close: Part<GpuixAlertDialog.Close.Props, GpuixAlertDialog.Close.State>
  Viewport: Part<GpuixAlertDialog.Viewport.Props, GpuixAlertDialog.Viewport.State>
}
type GpuixAlertDialogRootTypes = { actions: GpuixAlertDialog.Root.Actions; changeEventReason: GpuixAlertDialog.Root.ChangeEventReason; changeEventDetails: GpuixAlertDialog.Root.ChangeEventDetails }

const typedValueChild = (value: string | string[] | undefined) => value

function WrappedItemText({ children }: { children: SelectItemProps["children"] }) {
  const itemTextProps: SelectItemTextProps = { children }
  return <GpuixSelect.ItemText {...itemTextProps} />
}
type ItemChildSupportsRenderFunction = Extract<
  SelectItemProps["children"],
  (state: GpuixSelect.Item.State) => React.ReactNode
> extends never
  ? false
  : true

const baseUiFixture = (
  <BaseSelect.Root<Product> value={null} defaultValue={product} items={[{ value: product, label: "Alpha" }]}>
    <BaseSelect.Label />
    <BaseSelect.Trigger />
    <BaseSelect.Value placeholder="Choose">{typedValueChild}</BaseSelect.Value>
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
    <GpuixSelect.Value placeholder="Choose">{typedValueChild}</GpuixSelect.Value>
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
void (null as unknown as SelectPartTypes)
void (null as unknown as SelectRootTypes)
void (null as unknown as TooltipPartTypes)
void (null as unknown as TooltipRootTypes)
void (null as unknown as DialogPartTypes)
void (null as unknown as DialogRootTypes)
void (null as unknown as AlertDialogPartTypes)
void (null as unknown as AlertDialogRootTypes)
void (null as unknown as GpuixSelectPartTypes)
void (null as unknown as GpuixSelectRootTypes)
void (null as unknown as GpuixTooltipPartTypes)
void (null as unknown as GpuixTooltipRootTypes)
void (null as unknown as GpuixDialogPartTypes)
void (null as unknown as GpuixDialogRootTypes)
void (null as unknown as GpuixAlertDialogPartTypes)
void (null as unknown as GpuixAlertDialogRootTypes)
void typedValueChild
void WrappedItemText
void (null as unknown as ItemChildSupportsRenderFunction)
void typedValueChild
void WrappedItemText
