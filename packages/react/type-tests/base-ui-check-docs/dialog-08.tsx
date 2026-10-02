// Base UI documentation: docs/src/app/(docs)/react/components/dialog/page.mdx — Detached triggers with payload
import { Dialog } from '@base-ui/react/dialog';

declare const open: boolean;
const setOpen = (_: boolean) => {};

function DocsExample() {
const demoDialog = Dialog.createHandle<{ text: string }>();
return (<>
<Dialog.Trigger handle={demoDialog} payload={{ text: 'Trigger 1' }}>
  Trigger 1
</Dialog.Trigger>
<Dialog.Trigger handle={demoDialog} payload={{ text: 'Trigger 2' }}>
  Trigger 2
</Dialog.Trigger>

<Dialog.Root handle={demoDialog}>
  {({ payload }) => ( // @highlight-text "payload"
    <Dialog.Portal>
      <Dialog.Popup>
        <Dialog.Title>Dialog</Dialog.Title>
        {payload !== undefined && ( // @highlight-text "payload"
          <Dialog.Description>
            This has been opened by {payload.text} 
          </Dialog.Description>
        )}
      </Dialog.Popup>
    </Dialog.Portal>
  )}
</Dialog.Root>
</>);
}
