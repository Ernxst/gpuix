// Base UI documentation: docs/src/app/(docs)/react/components/dialog/page.mdx — Multiple triggers within the Root part
import { Dialog } from '@base-ui/react/dialog';


function DocsExample() {
return (<>
<Dialog.Root>
  <Dialog.Trigger>Trigger 1</Dialog.Trigger>
  <Dialog.Trigger>Trigger 2</Dialog.Trigger>
  ...
</Dialog.Root>
</>);
}
