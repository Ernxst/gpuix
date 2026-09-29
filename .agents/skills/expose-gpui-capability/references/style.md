# Style property checklist

Use this checklist when a style property or one of its values parses or types but does not affect native layout or paint.

- [ ] In `packages/native/src/style.rs`, add the property/value to the style description and parser allow-list. Add a native parser test for accepted values and retain a malformed-value assertion where the parser supports it.
- [ ] In `packages/native/src/renderer.rs`, map each parsed value to the matching GPUI/Taffy API in `apply_styles`.
- [ ] Search the repository for the property, enum/type and each value. Update comparisons, `match` arms, axis or direction checks, defaults and other derived behaviour; add coverage for each affected calculation. #720 needed the content-sized main-axis check to treat both `column` and `column-reverse` as vertical.
- [ ] Update the public style type in `packages/react/src/types/host.ts` and any other public style-value declarations found by search.
- [ ] Add a rendered-output regression in `packages/react/src/__tests__/style-coverage.test.tsx` (or the nearest existing behaviour test). Assert actual bounds, paint or other public result. Observe it fail before the implementation change.
- [ ] In `packages/react/src/__tests__/style-diagnostics.test.tsx`, cover strict mode for a `style` prop and for a compiled CSS module when the compiler passes through the value. Use `transformGpuixCssModule` and mark returned styles compiled as the neighbouring tests do. Assert valid values are diagnostic-free; keep malformed values diagnostic.
- [ ] Update `README.md`'s style API section and `skills/gpuix/references/styles.md`'s supported property/value surface.
- [ ] Add a changeset for every affected package, normally `@gpuix/native` and `@gpuix/react` when both parser and public React types change.
