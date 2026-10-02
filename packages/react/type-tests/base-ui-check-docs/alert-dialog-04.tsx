// Base UI documentation: docs/src/app/(docs)/react/components/alert-dialog/page.mdx — Multiple detached triggers
import { AlertDialog } from '@base-ui/react/alert-dialog';


function DocsExample() {
const demoAlertDialog = AlertDialog.createHandle();

return (<>
<AlertDialog.Trigger handle={demoAlertDialog}>Trigger 1</AlertDialog.Trigger>
<AlertDialog.Trigger handle={demoAlertDialog}>Trigger 2</AlertDialog.Trigger>
<AlertDialog.Root handle={demoAlertDialog}>
  ...
</AlertDialog.Root>
</>);
}
