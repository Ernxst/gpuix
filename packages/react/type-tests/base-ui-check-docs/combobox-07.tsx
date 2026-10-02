// Base UI documentation: docs/src/app/(docs)/react/components/combobox/page.mdx — Limiting visible chips
import { Combobox } from '@base-ui/react/combobox';


function DocsExample() {
const CHIP_LIMIT = 3;

return (<>
<Combobox.Root<string, true> multiple value={[]}>
<Combobox.Value>
  {(selectedValue: string[]) => {
    const visibleValue = selectedValue.slice(0, CHIP_LIMIT);
    const hiddenCount = selectedValue.length - visibleValue.length;
    return (
      <>
        {visibleValue.map((item) => (
          <Combobox.Chip key={item} aria-description="Press Backspace or Delete to remove">
            {item}
            <Combobox.ChipRemove aria-label={`Remove ${item}`} />
          </Combobox.Chip>
        ))}
        {/* @highlight-start */}
        {hiddenCount > 0 && <span>{`+${hiddenCount} more`}</span>}
        {/* @highlight-end */}
        <Combobox.Input
          aria-description={
            selectedValue.length > 0
              ? `${selectedValue.length} selected. From the start of the input, press Left Arrow to focus the selected items`
              : undefined
          }
        />
      </>
    );
  }}
</Combobox.Value>
</Combobox.Root>
</>);
}
