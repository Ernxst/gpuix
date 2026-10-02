// Base UI documentation: docs/src/app/(docs)/react/components/tooltip/page.mdx — Detached triggers with payload
import { Tooltip } from '@base-ui/react/tooltip';

declare const styles: Record<string, string>;

function DocsExample() {
const demoTooltip = Tooltip.createHandle<{ text: string }>();
return (<>
<Tooltip.Trigger handle={demoTooltip} payload={{ text: 'Trigger 1' }}>
  Trigger 1
</Tooltip.Trigger>
<Tooltip.Trigger handle={demoTooltip} payload={{ text: 'Trigger 2' }}>
  Trigger 2
</Tooltip.Trigger>

<Tooltip.Root handle={demoTooltip}>
  {({ payload }) => ( // @highlight-text "payload"
    <Tooltip.Portal>
      <Tooltip.Positioner sideOffset={8}>
        <Tooltip.Popup className={styles.Popup}>
          <Tooltip.Arrow className={styles.Arrow}>
            <span />
          </Tooltip.Arrow>
          {payload !== undefined && ( 
            <span>
              Tooltip opened by {payload.text} 
            </span>
          )}
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  )}
</Tooltip.Root>
</>);
}
