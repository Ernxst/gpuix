---
'@gpuix/plugins': minor
---

Accept nested rules in CSS modules.

`postcss-nesting` joins the default plugins, so a native CSS module can be written the way its web counterpart is: an interaction state inside its class, and a hovered descendant inside its ancestor.

```css
.card {
  background-color: #111;

  &:hover {
    background-color: #222;
  }

  &:hover .label {
    color: #fff;
  }
}
```

Flattening runs before validation and hands the result to the same selector rules, so `&:hover` folds into the class style and `&:hover .label` becomes the `hoverGroup` and `hoverWithin` pair. Nesting widens how a stylesheet may be written, not what the native renderer supports: `.card { .label { … } }` flattens to `.card .label` and is still rejected, and a nested `@media` is still an at-rule.
