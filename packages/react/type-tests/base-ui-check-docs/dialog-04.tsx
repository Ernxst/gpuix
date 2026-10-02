// Base UI documentation: docs/src/app/(docs)/react/components/dialog/page.mdx — Running code when dialog state changes
import { Dialog } from '@base-ui/react/dialog';

declare const open: boolean;
const setOpen = (_: boolean) => {};
declare function doStuff(): void;

function DocsExample() {
return (<>
<Dialog.Root
  open={open}
  onOpenChange={(open) => {
    // Do stuff when the dialog is closed
    if (!open) {
      doStuff();
    }
    // Set the new state
    setOpen(open);
  }}
>
</Dialog.Root>
</>);
}
