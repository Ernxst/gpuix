---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add `renderer.promptForPaths()` for opening the operating system's file picker.

```tsx
const paths = await renderer.promptForPaths({
  files: true,
  multiple: true,
  prompt: 'Attach',
})
```

The promise resolves with absolute paths, resolves with `null` on cancellation,
and rejects for invalid options, platform failures, or browsers where
operating-system paths are unavailable. Custom renderers can omit the optional
capability.

The current Windows GPUI backend reports `IFileDialog::Show` errors as
cancellation. Those cases also resolve with `null` until GPUI distinguishes the
system error code.
