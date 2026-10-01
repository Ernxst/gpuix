import { useRef } from "react"
import { Dialog as GpuixDialog, type DialogRootActions as GpuixDialogRootActions } from "@gpuix/react/dialog"
import { AlertDialog as GpuixAlertDialog } from "@gpuix/react/alert-dialog"
import { Dialog as BaseDialog, type DialogRootActions as BaseDialogRootActions } from "@base-ui/react/dialog"
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog"

function GpuixDialogFixture() {
  const handle = GpuixDialog.createHandle<string>()
  const actions = useRef<GpuixDialogRootActions | null>(null)
  return (
    <>
    <GpuixDialog.Root
      handle={handle}
      actionsRef={actions}
      modal="trap-focus"
      onOpenChange={(open, details) => {
        const reason: string = details.reason
        void details.event
        void details.trigger
        details.cancel()
        details.allowPropagation()
        const canceled: boolean = details.isCanceled
        const propagationAllowed: boolean = details.isPropagationAllowed
        if (!open) details.preventUnmountOnClose()
        void [reason, canceled, propagationAllowed]
      }}
      onOpenChangeComplete={(open) => void open}
      triggerId={undefined}
      defaultTriggerId={null}
    >
      <GpuixDialog.Trigger
        id="trigger"
        payload="payload"
        className={(state) => state.open ? "open" : undefined}
        style={(state) => ({ opacity: state.open ? 1 : 0.5 })}
      />
      <GpuixDialog.Portal container={null}>
        <GpuixDialog.Backdrop forceRender data-testid="backdrop" />
        <GpuixDialog.Viewport data-testid="viewport">
          <GpuixDialog.Popup
            initialFocus={() => true}
            finalFocus={() => false}
            className={(state) => state.open ? "open" : undefined}
            style={(state) => ({ opacity: state.open ? 1 : 0.5 })}
            data-testid="popup"
          >
            <GpuixDialog.Title>Title</GpuixDialog.Title>
            <GpuixDialog.Description>Description</GpuixDialog.Description>
            <GpuixDialog.Close>Close</GpuixDialog.Close>
          </GpuixDialog.Popup>
        </GpuixDialog.Viewport>
      </GpuixDialog.Portal>
    </GpuixDialog.Root>
    <GpuixDialog.Root children={({ payload }) => <span>{String(payload)}</span>} />
    </>
  )
}

function BaseDialogFixture() {
  const handle = BaseDialog.createHandle<string>()
  const actions = useRef<BaseDialogRootActions | null>(null)
  return (
    <>
    <BaseDialog.Root
      handle={handle}
      actionsRef={actions}
      modal="trap-focus"
      onOpenChange={(open, details) => {
        const reason: string = details.reason
        void details.event
        void details.trigger
        details.cancel()
        details.allowPropagation()
        const canceled: boolean = details.isCanceled
        const propagationAllowed: boolean = details.isPropagationAllowed
        if (!open) details.preventUnmountOnClose()
        void [reason, canceled, propagationAllowed]
      }}
      onOpenChangeComplete={(open) => void open}
      triggerId={undefined}
      defaultTriggerId={null}
    >
      <BaseDialog.Trigger
        id="trigger"
        payload="payload"
        className={(state) => state.open ? "open" : undefined}
        style={(state) => ({ opacity: state.open ? 1 : 0.5 })}
      />
      <BaseDialog.Portal container={null}>
        <BaseDialog.Backdrop forceRender data-testid="backdrop" />
        <BaseDialog.Viewport data-testid="viewport">
          <BaseDialog.Popup
            initialFocus={() => true}
            finalFocus={() => false}
            className={(state) => state.open ? "open" : undefined}
            style={(state) => ({ opacity: state.open ? 1 : 0.5 })}
            data-testid="popup"
          >
            <BaseDialog.Title>Title</BaseDialog.Title>
            <BaseDialog.Description>Description</BaseDialog.Description>
            <BaseDialog.Close>Close</BaseDialog.Close>
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
    <BaseDialog.Root children={({ payload }) => <span>{String(payload)}</span>} />
    </>
  )
}

function GpuixAlertDialogFixture() {
  const handle = GpuixAlertDialog.createHandle<string>()
  return (
    <GpuixAlertDialog.Root
      handle={handle}
      defaultOpen
      onOpenChange={(open, details) => {
        const reason: string = details.reason
        void details.event
        void details.trigger
        details.cancel()
        details.allowPropagation()
        const canceled: boolean = details.isCanceled
        const propagationAllowed: boolean = details.isPropagationAllowed
        if (!open) details.preventUnmountOnClose()
        void [reason, canceled, propagationAllowed]
      }}
      onOpenChangeComplete={(open) => void open}
    >
      <GpuixAlertDialog.Trigger payload="payload" />
      <GpuixAlertDialog.Portal>
        <GpuixAlertDialog.Backdrop />
        <GpuixAlertDialog.Viewport>
          <GpuixAlertDialog.Popup>
            <GpuixAlertDialog.Title>Alert</GpuixAlertDialog.Title>
            <GpuixAlertDialog.Description>Confirm action</GpuixAlertDialog.Description>
            <GpuixAlertDialog.Close>Confirm</GpuixAlertDialog.Close>
          </GpuixAlertDialog.Popup>
        </GpuixAlertDialog.Viewport>
      </GpuixAlertDialog.Portal>
    </GpuixAlertDialog.Root>
  )
}

function BaseAlertDialogFixture() {
  const handle = BaseAlertDialog.createHandle<string>()
  return (
    <BaseAlertDialog.Root
      handle={handle}
      defaultOpen
      onOpenChange={(open, details) => {
        const reason: string = details.reason
        void details.event
        void details.trigger
        details.cancel()
        details.allowPropagation()
        const canceled: boolean = details.isCanceled
        const propagationAllowed: boolean = details.isPropagationAllowed
        if (!open) details.preventUnmountOnClose()
        void [reason, canceled, propagationAllowed]
      }}
      onOpenChangeComplete={(open) => void open}
    >
      <BaseAlertDialog.Trigger payload="payload" />
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop />
        <BaseAlertDialog.Viewport>
          <BaseAlertDialog.Popup>
            <BaseAlertDialog.Title>Alert</BaseAlertDialog.Title>
            <BaseAlertDialog.Description>Confirm action</BaseAlertDialog.Description>
            <BaseAlertDialog.Close>Confirm</BaseAlertDialog.Close>
          </BaseAlertDialog.Popup>
        </BaseAlertDialog.Viewport>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  )
}

const gpuixDialogHandle = new GpuixDialog.Handle<string>()
const baseDialogHandle = new BaseDialog.Handle<string>()
const gpuixAlertDialogHandle = new GpuixAlertDialog.Handle<string>()
const baseAlertDialogHandle = new BaseAlertDialog.Handle<string>()
void gpuixDialogHandle
void baseDialogHandle
void gpuixAlertDialogHandle
void baseAlertDialogHandle

void GpuixDialogFixture
void BaseDialogFixture
void GpuixAlertDialogFixture
void BaseAlertDialogFixture
