// Base UI documentation: docs/src/app/(docs)/react/components/tooltip/page.mdx — Multiple triggers within the Root part
import { Tooltip } from '@base-ui/react/tooltip';


function DocsExample() {
return (<>
<Tooltip.Root>
  <Tooltip.Trigger>Trigger 1</Tooltip.Trigger>
  <Tooltip.Trigger>Trigger 2</Tooltip.Trigger>
  ...
</Tooltip.Root>
</>);
}
