// Base UI documentation: docs/src/app/(docs)/react/components/tooltip/page.mdx — Multiple detached triggers
import { Tooltip } from '@base-ui/react/tooltip';


function DocsExample() {
const demoTooltip = Tooltip.createHandle();

return (<>
<Tooltip.Trigger handle={demoTooltip}>
  Trigger 1
</Tooltip.Trigger>

<Tooltip.Trigger handle={demoTooltip}>
  Trigger 2
</Tooltip.Trigger>

<Tooltip.Root handle={demoTooltip}>
  ...
</Tooltip.Root>
</>);
}
