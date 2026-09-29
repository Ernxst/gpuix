---
name: expose-gpui-capability
description: Wire a style, accessibility prop or role mapping, or element event through GPU-IX when GPUI, Taffy or AccessKit already supports it.
metadata:
  internal: true
---

# Expose an existing GPUI capability

Use this when a consumer issue shows that GPU-IX drops behaviour available in its lower layer. Confirm the gap against the public React/DOM contract, reproduce it at the renderer boundary, and add a test that fails before changing implementation.

First prove the lower layer supports the requested behaviour. Inspect the `zed/` revision pinned by this checkout and link the source at that commit. For AccessKit, check its version in the pinned [`zed/Cargo.lock`](https://github.com/Ernxst/zed/blob/85cc48f6b594ab25d13d54031594ae7ea7b84f8f/Cargo.lock#L6-L12) and use matching versioned docs. For example, GPUI had [`flex_row_reverse` and `flex_col_reverse` at #720's base pin](https://github.com/Ernxst/zed/blob/98664454daeb950300daaa667b4634b3d3a19729/crates/gpui/src/styled.rs#L193-L212); those APIs remain in the [current pinned source](https://github.com/Ernxst/zed/blob/85cc48f6b594ab25d13d54031594ae7ea7b84f8f/crates/gpui/src/styled.rs#L193-L212). AccessKit 0.24.1 defines [`SortDirection`](https://docs.rs/accesskit/0.24.1/accesskit/enum.SortDirection.html); [Ernxst/zed#12](https://github.com/Ernxst/zed/pull/12) added the GPUI builder and debug output at the current pinned [div API](https://github.com/Ernxst/zed/blob/85cc48f6b594ab25d13d54031594ae7ea7b84f8f/crates/gpui/src/elements/div.rs) and [a11y debug output](https://github.com/Ernxst/zed/blob/85cc48f6b594ab25d13d54031594ae7ea7b84f8f/crates/gpui/src/window/a11y/debug.rs). See [#720](https://github.com/Ernxst/gpuix/issues/720) and [#721](https://github.com/Ernxst/gpuix/issues/721) for examples of describing dropped public behaviour, proving lower-layer support, tracing the missing GPU-IX path, and stating observable completion criteria.

Read the matching checklist before editing:

- [Style properties and values](references/style.md)
- [Accessibility props and role mappings](references/accessibility.md)
- [Element events](references/event.md)

Search for every comparison, match, switch, allow-list and derived type that uses the property, value or event. If GPUI needs a new API, work in a separate Zed worktree based on `origin/gpuix`, push the feature branch to Ernxst/zed, merge its PR, then bump GPU-IX's `zed` pointer to that reachable commit. Test public behaviour, strict-mode diagnostics and the compiled CSS-module path where applicable. Update the README API section and the relevant `skills/gpuix/` reference, then add a changeset for user-facing support. Verify the package and runtime boundary the change touches; a parser or type test alone does not prove rendered behaviour.
