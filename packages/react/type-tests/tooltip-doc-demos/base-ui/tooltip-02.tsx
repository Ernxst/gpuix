'use client';
import * as React from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
const demoTooltip = Tooltip.createHandle<React.ReactNode>();

export default function TooltipDetachedTriggersFullDemo() {
  return (
    <Tooltip.Provider>
      <div className={""}>
        <Tooltip.Trigger
          className={""}
          handle={demoTooltip}
          payload="Listen to audio preview"
          aria-label="Listen to audio preview"
        >
          <HeadphonesIcon aria-hidden="true" />
        </Tooltip.Trigger>

        <Tooltip.Trigger
          className={""}
          handle={demoTooltip}
          payload="Set a timer"
          aria-label="Set a timer"
        >
          <StopwatchIcon aria-hidden="true" />
        </Tooltip.Trigger>

        <Tooltip.Trigger
          className={""}
          handle={demoTooltip}
          payload="Delete: This action cannot be undone"
          aria-label="Delete: This action cannot be undone"
        >
          <TrashIcon aria-hidden="true" />
        </Tooltip.Trigger>
      </div>

      <Tooltip.Root handle={demoTooltip}>
        {({ payload }) => (
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={11} className={""}>
              <Tooltip.Popup className={""}>
                <Tooltip.Arrow className={""} />

                <Tooltip.Viewport className={""}>{payload}</Tooltip.Viewport>
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        )}
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
