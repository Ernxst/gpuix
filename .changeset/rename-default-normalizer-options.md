---
"@gpuix/react": major
---

BREAKING: rename the exported `NormalizerOptions` type to
`DefaultNormalizerOptions`. It is the argument of `getDefaultNormalizer`, so it
has the shape Testing Library gives `DefaultNormalizerOptions`
(`{ trim?, collapseWhitespace? }`), while Testing Library's `NormalizerOptions`
is a different type. Rename the import; the shape is unchanged.
