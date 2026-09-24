---
'@gpuix/plugins': minor
---

Inline `@import` and resolve custom properties in CSS modules without being asked.

The native transform rejects every at-rule and removes custom-property declarations rather than substituting them, so a CSS module that shares tokens with a web build never compiled unless the caller supplied `postcss-import` and `postcss-custom-properties` itself. `@gpuix/plugins/preload` could not: it registers `gpuixCssModulesBun()` with no options, so a `bun --preload @gpuix/plugins/preload` run failed on the first `@import` while the same file built fine through `Bun.build()` with the plugins passed by hand.

The transform now runs both itself, before validation, and the package depends on them. A `plugins` option adds to those built-in plugins and runs after them:

```ts
gpuixCssModules({ plugins: [myOwnPlugin()] })
```

Projects that pass `postcss-import` and `postcss-custom-properties` explicitly can drop them and keep the same output.
