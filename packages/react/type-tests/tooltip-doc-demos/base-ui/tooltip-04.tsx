import * as React from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
export default function ExampleTooltip() {
  return (
    <Tooltip.Provider>
      <div className={""}>
        <Tooltip.Root>
          <Tooltip.Trigger className={""} aria-label="Bold">
            <BoldIcon aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={11}>
              <Tooltip.Popup className={""}>
                <Tooltip.Arrow className={""} />
                Bold
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger className={""} aria-label="Italic">
            <ItalicIcon aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={11}>
              <Tooltip.Popup className={""}>
                <Tooltip.Arrow className={""} />
                Italic
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger className={""} aria-label="Underline">
            <UnderlineIcon aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={11}>
              <Tooltip.Popup className={""}>
                <Tooltip.Arrow className={""} />
                Underline
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    </Tooltip.Provider>
  );
}

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
