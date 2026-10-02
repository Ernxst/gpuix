// Base UI documentation: docs/src/app/(docs)/react/components/alert-dialog/page.mdx — Multiple triggers within the Root part
import { AlertDialog } from '@base-ui/react/alert-dialog';


function DocsExample() {
return (<>
<AlertDialog.Root>
  <AlertDialog.Trigger>Trigger 1</AlertDialog.Trigger>
  <AlertDialog.Trigger>Trigger 2</AlertDialog.Trigger>
  ...
</AlertDialog.Root>
</>);
}
