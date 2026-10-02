'use client';
import * as React from 'react';
import { Tooltip } from '@gpuix/react/tooltip';
const demoTooltip = Tooltip.createHandle();

export default function TooltipDetachedTriggersSimpleDemo() {
  return (
    <Tooltip.Provider>
      <Tooltip.Trigger className={""} handle={demoTooltip} aria-label="Delete">
        <TrashIcon aria-hidden="true" />
      </Tooltip.Trigger>

      <Tooltip.Root handle={demoTooltip}>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={11}>
            <Tooltip.Popup className={""}>
              <Tooltip.Arrow className={""} />
              Delete
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
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
