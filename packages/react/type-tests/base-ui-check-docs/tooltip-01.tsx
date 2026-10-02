// Base UI documentation: docs/src/app/(docs)/react/components/tooltip/page.mdx — Anatomy
import { Tooltip } from '@base-ui/react/tooltip';


function DocsExample() {

return (<>
<Tooltip.Provider>
  <Tooltip.Root>
    <Tooltip.Trigger />
    <Tooltip.Portal>
      <Tooltip.Positioner>
        <Tooltip.Popup>
          <Tooltip.Arrow />
          <Tooltip.Viewport />
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>;
</>);
}
