'use client';
import * as React from 'react';
import { Tooltip } from '@gpuix/react/tooltip';
const demoTooltip = Tooltip.createHandle();

export default function TooltipDetachedTriggersControlledDemo() {
  const [open, setOpen] = React.useState(false);
  const [triggerId, setTriggerId] = React.useState<string | null>(null);

  const handleOpenChange = (isOpen: boolean, eventDetails: Tooltip.Root.ChangeEventDetails) => {
    setOpen(isOpen);
    setTriggerId(eventDetails.trigger?.id ?? null);
  };

  return (
    <Tooltip.Provider>
      <div className={""}>
        <div className={""}>
          <Tooltip.Trigger
            className={""}
            handle={demoTooltip}
            id="trigger-1"
            aria-label="Trigger 1"
          >
            <HeadphonesIcon aria-hidden="true" />
          </Tooltip.Trigger>

          <Tooltip.Trigger
            className={""}
            handle={demoTooltip}
            id="trigger-2"
            aria-label="Trigger 2"
          >
            <StopwatchIcon aria-hidden="true" />
          </Tooltip.Trigger>

          <Tooltip.Trigger
            className={""}
            handle={demoTooltip}
            id="trigger-3"
            aria-label="Trigger 3"
          >
            <TrashIcon aria-hidden="true" />
          </Tooltip.Trigger>
        </div>

        <button
          type="button"
          className={""}
          onClick={() => {
            setTriggerId('trigger-2');
            setOpen(true);
          }}
        >
          Open programmatically
        </button>
      </div>

      <Tooltip.Root
        handle={demoTooltip}
        open={open}
        onOpenChange={handleOpenChange}
        triggerId={triggerId}
      >
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={11} className={""}>
            <Tooltip.Popup className={""}>
              <Tooltip.Arrow className={""} />
              Controlled tooltip
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function HeadphonesIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      {...props}
      style={{ display: 'block', ...props.style }}
    >
    </svg>
  );
}

function StopwatchIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      {...props}
      style={{ display: 'block', ...props.style }}
    >
    </svg>
  );
}

function TrashIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      {...props}
      style={{ display: 'block', ...props.style }}
    >
    </svg>
  );
}
