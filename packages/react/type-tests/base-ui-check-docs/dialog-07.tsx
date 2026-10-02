// Base UI documentation: docs/src/app/(docs)/react/components/dialog/page.mdx — Multiple detached triggers
import { Dialog } from '@base-ui/react/dialog';


function DocsExample() {
const demoDialog = Dialog.createHandle();

return (<>
<Dialog.Trigger handle={demoDialog}>Trigger 1</Dialog.Trigger>
<Dialog.Trigger handle={demoDialog}>Trigger 2</Dialog.Trigger>
<Dialog.Root handle={demoDialog}>
  ...
</Dialog.Root>
</>);
}
