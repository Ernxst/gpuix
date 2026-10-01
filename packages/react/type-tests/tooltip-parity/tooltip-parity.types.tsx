import React from "react"
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip"
import { Tooltip as GpuixTooltip } from "@gpuix/react/tooltip"

const bounds = { x: 0, y: 0, width: 320, height: 240 }

const baseHandle = BaseTooltip.createHandle<{ source: string }>()
const gpuixHandle = GpuixTooltip.createHandle<{ source: string }>()

const baseFixture = (
  <BaseTooltip.Provider delay={600} closeDelay={90} timeout={400}>
    <BaseTooltip.Root
      open={false}
      defaultOpen={false}
      disabled={false}
      disableHoverablePopup={false}
      trackCursorAxis="none"
      handle={baseHandle}
      triggerId="base-trigger"
      defaultTriggerId={null}
      onOpenChange={(open, details) => {
        open.valueOf()
        details.reason
        details.event
        details.preventUnmountOnClose()
      }}
      onOpenChangeComplete={(open) => open.valueOf()}
    >
      <BaseTooltip.Trigger
        id="base-trigger"
        handle={baseHandle}
        payload={{ source: "trigger" }}
        delay={250}
        closeDelay={30}
        closeOnClick
        disabled={false}
        render={<button />}
        className={(state) => state.open ? "open" : undefined}
      >Copy
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal container={null} keepMounted>
        <BaseTooltip.Positioner
          anchor={null}
          side="top"
          align="end"
          sideOffset={({ anchor }) => anchor.height}
          alignOffset={2}
          positionMethod="fixed"
          collisionBoundary={bounds}
          collisionPadding={{ top: 8, right: 12, bottom: 8, left: 12 }}
          collisionAvoidance={{ side: "flip", align: "shift" }}
          sticky
          arrowPadding={4}
          disableAnchorTracking
          style={(state) => state.open && state.instant !== "dismiss" ? { opacity: 1 } : { opacity: 0 }}
        >
          <BaseTooltip.Viewport>
            <BaseTooltip.Popup render={(props, state) => <div {...props} data-state={state.transitionStatus} />}>
              <BaseTooltip.Arrow data-testid="arrow" />
              Copy the message
            </BaseTooltip.Popup>
          </BaseTooltip.Viewport>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  </BaseTooltip.Provider>
)

const gpuixFixture = (
  <GpuixTooltip.Provider delay={600} closeDelay={90} timeout={400}>
    <GpuixTooltip.Root
      open={false}
      defaultOpen={false}
      disabled={false}
      disableHoverablePopup={false}
      trackCursorAxis="none"
      handle={gpuixHandle}
      triggerId="gpuix-trigger"
      defaultTriggerId={null}
      onOpenChange={(open, details) => {
        open.valueOf()
        details.reason
        details.event
        details.preventUnmountOnClose()
      }}
      onOpenChangeComplete={(open) => open.valueOf()}
    >
      <GpuixTooltip.Trigger
        id="gpuix-trigger"
        handle={gpuixHandle}
        payload={{ source: "trigger" }}
        delay={250}
        closeDelay={30}
        closeOnClick
        disabled={false}
        render={<button />}
        className={(state) => state.open ? "open" : undefined}
      >Copy
      </GpuixTooltip.Trigger>
      <GpuixTooltip.Portal container={null} keepMounted>
        <GpuixTooltip.Positioner
          anchor={null}
          side="top"
          align="end"
          sideOffset={({ anchor }) => anchor.height}
          alignOffset={2}
          positionMethod="fixed"
          collisionBoundary={bounds}
          collisionPadding={{ top: 8, right: 12, bottom: 8, left: 12 }}
          collisionAvoidance={{ side: "flip", align: "shift" }}
          sticky
          arrowPadding={4}
          disableAnchorTracking
          style={(state) => state.open && state.instant !== "dismiss" ? { opacity: 1 } : { opacity: 0 }}
        >
          <GpuixTooltip.Viewport>
            <GpuixTooltip.Popup render={(props, state) => <div {...props} data-state={state.transitionStatus} />}>
              <GpuixTooltip.Arrow data-testid="arrow" />
              Copy the message
            </GpuixTooltip.Popup>
          </GpuixTooltip.Viewport>
        </GpuixTooltip.Positioner>
      </GpuixTooltip.Portal>
    </GpuixTooltip.Root>
  </GpuixTooltip.Provider>
)

void baseFixture
void gpuixFixture
