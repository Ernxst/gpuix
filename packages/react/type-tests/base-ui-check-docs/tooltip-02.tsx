// Base UI documentation: docs/src/app/(docs)/react/components/tooltip/page.mdx — Detached triggers
import { Tooltip } from '@base-ui/react/tooltip';


function DocsExample() {
const demoTooltip = Tooltip.createHandle();
return (<>
<Tooltip.Trigger handle={demoTooltip}>Button</Tooltip.Trigger>
<Tooltip.Root handle={demoTooltip}>
  ...
</Tooltip.Root>
</>);
}
