# GPU-IX

React/TypeScript renderers backed by GPUI, with native and browser targets. Match react-dom behavior for shared APIs; upstream divergences do not override this fork’s DOM-parity goal.

## Where to look

- `packages/react/src/`: React reconciler, components, browser integration and tests.
- `packages/native/src/`: Rust renderer and napi bridge.
- `zed/`: GPUI submodule; consult the relevant implementation when changing GPUI integration.
- `README.md`: public API reference. Read the sections relevant to the task.
- `examples/`: runnable usage examples. `scripts/` and `.github/workflows/`: build and release entry points.

## Build and verification

Use Bun and the checked-in lockfile. In a new checkout, install with `bun install --frozen-lockfile` when dependencies are absent.

- React build: `bun run build:react` from the repository root. Examples load `packages/react/dist`, so source-only test results do not establish that an example uses the change.
- React tests: `bun run test` in `packages/react`; target the affected tests when appropriate.
- Native build: `bun run build:native` from the repository root. This produces the release binary with `test-support`. Restart the app after rebuilding; hot reload cannot replace a loaded native binary.
- Browser build: `bun run web:wasm` from the repository root.

Verify the target changed: TypeScript checks do not compile Rust, and native checks do not validate the browser renderer. Consult the relevant package scripts or CI job for additional checks required by the change.

## Repository constraints

- `packages/native/index.js`, `index.d.ts` and `*.node` are generated. Change Rust declarations and rebuild instead of editing generated output by hand.
- Update the relevant README API section for user-facing fixes or features.
- This fork ships package tarballs attached to GitHub releases, stamped and packed by hand. It does not publish the upstream package names to npm. Do not publish locally.
- Preserve attribution headers and `THIRD_PARTY_NOTICES.md` when changing ported code.

## Pull request bodies

When an agent writes the change, the PR body carries a sanitized record of what drove
it, not the raw conversation: the repository is public, and a verbatim prompt log
tends to carry local paths and workflow detail that don't belong there. This does not
apply to PRs against the Zed submodule repo.

Open with a three-line block naming the harness, agent, and model:

- **Harness:** the product that ran the agent (`Claude Code`, `OpenCode`, `Kimaki`,
  `Cursor`, `Codex`).
- **Agent:** the named agent if the harness has one (`build`, `plan`, `opus`); write
  `none` if there is no named agent.
- **Model:** the exact model id from the session (`anthropic/claude-opus-5`,
  `xai/grok-4.6`); do not guess a shorter marketing name.

Follow it with a collapsed `<details><summary>Task statements</summary>` block
listing, in order, what each user turn asked for in effect terms — the outcome
requested, not the literal wording or the working directory and workflow
instructions that got there. End each statement with "(Working-directory and
workflow instructions omitted.)":

```md
**Harness:** Claude Code
**Agent:** none
**Model:** anthropic/claude-opus-5

<details>
<summary>Task statements</summary>

1. Add an optional peer dependency and update its README section. (Working-directory
   and workflow instructions omitted.)

2. Fix a regression where a hovered ancestor lost its hover state. (Working-directory
   and workflow instructions omitted.)

</details>
```

## Consumer bug fixes

When fixing a consumer-reported bug, read and execute [the surface-audit procedure](.agents/skills/audit-surface/SKILL.md) before declaring the fix complete. This is part of the fixing task; do not wait for a separate user request or skill invocation. Group reports touching the same behavior and implementation into one audit. Include the audit results and any verification gaps in the handoff.
