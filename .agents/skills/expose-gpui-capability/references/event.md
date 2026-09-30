# Element event checklist

Use this checklist when GPUI can report an interaction but a React element prop is missing, untyped, or never reaches its handler.

- [ ] Confirm the lower-layer event source and its payload at the pinned `zed/` commit. Check the corresponding GPUI event-handler API and the GPU-IX fork's existing event translation before adding a fork API.
- [ ] In `packages/react/src/reconciler/host-config.ts`, add the React prop to `EVENT_PROPS` with the right native event name, phase and any distinct registry key. Check listener registration/removal and native-only or JavaScript-synthesised paths.
- [ ] Add or update the public prop and callback/payload types in `packages/react/src/types/host.ts` and the synthetic event definitions in `packages/react/src/reconciler/synthetic-event.ts`. Search type re-exports and snapshot APIs as well.
- [ ] Trace the native path from GPUI event handling through retained-tree listener state and `packages/native/src/element_tree.rs` payload to the renderer callback. Add payload fields and conversion only when the event needs data not already represented. Search event-type comparisons and dispatch switches on both Rust and TypeScript sides.
- [ ] Add a public event regression in `packages/react/src/__tests__/events.test.tsx` or the nearest event suite. Cover registration, delivery, payload and propagation/phase semantics that apply; cover listener updates or removal if they exercise the missing path. Observe the test fail before changing the event wiring.
- [ ] Update `README.md`'s event API and `skills/gpuix/references/events-and-dom.md`. Add a changeset for user-facing support.
