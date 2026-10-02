import * as React from 'react';
import { Tooltip } from '@gpuix/react/tooltip';

export default function ExampleTooltip() {
  return (
    <Tooltip.Provider>
      <div className="flex border border-neutral-950 bg-white dark:border-white dark:bg-neutral-950">
        <Tooltip.Root>
          <Tooltip.Trigger className={triggerClass} aria-label="Bold">
            <BoldIcon aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={11}>
              <Tooltip.Popup className={popupClass}>
                <Tooltip.Arrow className={arrowClass} />
                Bold
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger className={triggerClass} aria-label="Italic">
            <ItalicIcon aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={11}>
              <Tooltip.Popup className={popupClass}>
                <Tooltip.Arrow className={arrowClass} />
                Italic
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger className={triggerClass} aria-label="Underline">
            <UnderlineIcon aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={11}>
              <Tooltip.Popup className={popupClass}>
                <Tooltip.Arrow className={arrowClass} />
                Underline
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    </Tooltip.Provider>
  );
}

const triggerClass =
  'flex size-8 items-center justify-center border-0 bg-transparent text-neutral-950 select-none data-popup-open:bg-neutral-100 focus-visible:relative focus-visible:z-1 focus-visible:bg-transparent focus-visible:outline-2 focus-visible:outline-neutral-950 dark:focus-visible:outline-white hover:bg-neutral-100 active:bg-neutral-200 dark:text-white dark:data-popup-open:bg-neutral-800 dark:hover:bg-neutral-800 dark:active:bg-neutral-700';
const popupClass =
  'relative flex flex-col border border-neutral-950 bg-white px-2 py-1 text-sm text-neutral-950 origin-[var(--transform-origin)] shadow-[0.25rem_0.25rem_0] shadow-black/12 transition-[transform,opacity] duration-100 ease-out data-ending-style:opacity-0 data-ending-style:[transform:scale(0.98)] data-instant:transition-none data-starting-style:opacity-0 data-starting-style:[transform:scale(0.98)] dark:border-white dark:bg-neutral-950 dark:text-white dark:shadow-none';
const arrowClass =
  "relative block w-3 h-1.5 overflow-clip data-[side=bottom]:top-[-6px] data-[side=left]:right-[-9px] data-[side=left]:rotate-90 data-[side=right]:left-[-9px] data-[side=right]:-rotate-90 data-[side=top]:bottom-[-6px] data-[side=top]:rotate-180 before:content-[''] before:absolute before:bottom-0 before:left-1/2 before:w-[calc(6px*sqrt(2))] before:h-[calc(6px*sqrt(2))] before:bg-white dark:before:bg-neutral-950 before:border before:border-neutral-950 dark:before:border-white before:[transform:translate(-50%,50%)_rotate(45deg)]";

function BoldIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      {...props}
      style={{ display: 'block', ...props.style }}
    >
    </svg>
  );
}

function ItalicIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      {...props}
      style={{ display: 'block', ...props.style }}
    >
    </svg>
  );
}

function UnderlineIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      {...props}
      style={{ display: 'block', ...props.style }}
    >
    </svg>
  );
}
