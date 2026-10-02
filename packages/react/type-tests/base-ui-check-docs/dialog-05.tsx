// Base UI documentation: docs/src/app/(docs)/react/components/dialog/page.mdx — Detached triggers
import { Dialog } from '@base-ui/react/dialog';


function DocsExample() {
const demoDialog = Dialog.createHandle();
return (<>
<Dialog.Trigger handle={demoDialog}>Open</Dialog.Trigger> 
<Dialog.Root handle={demoDialog}>
  ...
</Dialog.Root>
</>);
}
