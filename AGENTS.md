# GPU-IX

React/TypeScript renderers backed by GPUI, with native and browser targets. Match react-dom behavior for shared APIs; upstream divergences do not override this fork’s DOM-parity goal.

## Where to look

- `packages/react/src/`: React reconciler, components, browser integration and tests.
- `packages/native/src/`: Rust renderer and napi bridge.
- `zed/`: GPUI submodule; consult the relevant implementation when changing GPUI integration.
- `README.md`: public API reference. Read the sections relevant to the task.
- `skills/gpuix/`: the agent skill app authors install to build on GPU-IX. Its `SKILL.md` holds the rules and traps; `references/` maps the feature surface.
- `examples/`: runnable usage examples. `scripts/`: build and release entry points.

## Build and verification

Use Bun and the checked-in lockfile. In a new checkout, install with `bun install --frozen-lockfile` when dependencies are absent.

- Build: `bun run build` from the repository root builds every package through Turbo in dependency order: native, then React, then plugins. For one package and what it depends on, run `bunx turbo run build --filter=@gpuix/react`. Turbo restores a cached build when the inputs are unchanged.
- Tests: `bun run test` from the repository root, or `bunx turbo run test --filter=@gpuix/react` for one package. Turbo builds the package and its dependencies first, so tests never run against a stale `dist`. Examples load `packages/react/dist`, so source-only test results do not establish that an example uses the change.
- Typecheck: `bun run typecheck` from the repository root. React's types depend on `packages/native/dist/index.d.ts`, which only the native build produces. React checks ten programs, listed in `packages/react/tsconfig.typecheck.json`; add a new type-test config there.
- Dev loop: `bun run dev` from the repository root runs `example-app` under `turbo watch`. An edit to a file the native build names as an input rebuilds the debug addon and restarts the app; a React or plugin edit hot-reloads it. It leaves a debug addon in `packages/native/dist` until the next `bun run build` or `bun run test`. If `turbo watch` stops at startup with `FSEvents failed during file-watcher startup` and never starts the app, check the macOS `fseventsd` process in Activity Monitor: the error appeared while that process was stuck at 100% CPU and stopped once it was restarted.
- Native build: `napi build` with `test-support`, written to `packages/native/dist`. Restart the app after rebuilding; hot reload cannot replace a loaded native binary.
- Native build cache: Turbo hashes the files Cargo compiles and the Cargo and compiler environment; `packages/native/turbo.json` lists both. Git worktrees on one machine share a local cache, so a worktree restores the addon without running Cargo when another checkout has already built the same inputs. The `zed` submodule must be checked out, because its sources are part of the hash. A file whose contents differ between checkouts, such as one holding an absolute path, gives every worktree its own hash; keep such files out of the inputs.
- Rust edits: an edit under `packages/native/src` recompiles only the addon's own crate; mbx returns the dependencies from its cache. That crate compiles incrementally, so the first build in a checkout takes most of a minute and later edits take under ten seconds. `packages/native/.mbx.toml` hands incremental compilation to Cargo, and the profiles in `packages/native/Cargo.toml` turn it on for the addon's crate alone; mbx's own incremental modes skip the crate because it is both a `cdylib` and an `rlib`. CI sets `CARGO_INCREMENTAL=0`, so the addons it builds are not compiled incrementally. `lto = true` in `Cargo.toml` adds nothing to the link: Cargo passes no `-C lto` flag for a crate with those two types, so neither local nor released addons are link-time optimised. Check with `cargo build --release --features test-support -v` in `packages/native`.
- Browser build: `bun scripts/web.ts --build-only` from the repository root.
- Target directory: don't set `CARGO_TARGET_DIR` or pass `--target-dir`, including for one-off review builds. Cargo runs through mbx, which already gives each checkout its own target directory and deletes it when unused; a custom target directory bypasses mbx and is never cleaned up. Before the first native build in a new checkout, run `mkdir -p packages/native/target && mbx adopt packages/native`. Otherwise `napi build` creates `target/` as a plain directory before Cargo runs, and mbx stops the build in a terminal to ask whether to move it, which an unattended run cannot answer.

The CI workflow is enabled. Pushes to `main` and pull requests build on macOS, Linux and Windows, then test on all three and typecheck on macOS. Linux has no test renderer, so `packages/react/vitest.config.ts` leaves out the files that need one there. GPUI's own tests (`bun run test:gpui`, which runs `cargo test -p gpui` in `zed`) run on macOS as a turbo task whose inputs are the `zed` submodule, so the cache replays them until the submodule changes. A change that touches only `docs/`, `.changeset/`, `website/`, `.agents/` or Markdown outside `skills/` starts no run. Each platform's tests wait only for that platform's build. Three more jobs cover what the build and test tasks leave out. On Linux, `check:no-default-features` compiles the addon and the Rust examples without `test-support`, the feature set `build:release` ships. On macOS, `test:fault-injection` runs `native-binding.test.ts` against an addon built to fail renderer initialisation. On a `workflow_dispatch` run, `compile` builds the standalone chat binary for each platform and uploads it as an `example-chat-<target>` artifact. A branch with no pull request gets a run only from `workflow_dispatch`. Do not disable the workflow.

CI reuses work at two levels. The build jobs store the addon in the turbo remote cache, and the test and typecheck jobs restore it. Those jobs install no Rust toolchain, so they cannot build the addon themselves. The native build hashes the Cargo and compiler environment, so `.github/workflows/ci.yml` sets the variables the Rust setup action would export for every job; a variable set in one job only makes the others miss the cache. The native tasks also hash `GPUIX_HOST_TOOLS`, which `.github/actions/host-tools` sets to the versions of the compilers the runner image supplies: Xcode, the Windows SDK and MSVC, or the Linux release. A job that restores another job's build takes the value from that job's output, because its own image may differ. When the addon has to be rebuilt, mbx returns unchanged crates from the objects saved by the last run on the pull request or on `main`. Each job first asks turbo which of its tasks the cache does not hold, through a dry run in `.github/actions/turbo-cache`, and installs Rust, mbx, the system packages and Node only when a task that needs them will run. Each job lists its tasks with their cache status and time on its summary page and uploads turbo's run summaries as an artifact.

The React tests run as three shards on macOS and Windows and unsharded on Linux, selected by `VITEST_SHARD`, which the test task hashes and `packages/react/vitest.config.ts` reads. Pass a shard through that variable. An argument after `--` changes the hash of every task in the run, the build included, and `--only` leaves the build out of the test's hash, so turbo replays a result from another build or platform.

A task's hash covers its own package's files and the builds it depends on. When a test or build reads a file from anywhere else, add that file to the task's `inputs` in the package's `turbo.json`, as `packages/plugins/turbo.json` does for `skills/gpuix`. Otherwise the cache replays a stale result. Every build task lists the files it reads in its package's `turbo.json`, so an edit to a test, a golden image or a README does not rebuild the package or the packages that depend on it. A build that starts reading a new file needs that file added to the list.

Verify the target changed: TypeScript checks do not compile Rust, and native checks do not validate the browser renderer. Consult the relevant package scripts or CI job for additional checks required by the change.

The native renderer cannot start inside an agent sandbox: macOS denies it the window and system services it needs. React tests, native tests, the examples and anything else that loads it need an unsandboxed run, so request one on the first attempt instead of trying sandboxed first. In a bb thread that cannot request one, such as Codex, run the command in a bb terminal, which runs outside the sandbox. Start it, wait for it, read it and close it in one shell command, with a tool timeout that covers the wait, because each separate call re-sends the whole conversation: `id=$(bb terminal create --thread $BB_THREAD_ID --command "…" --json | jq -r .terminalId); bb terminal wait $id --exit --timeout 10m; bb terminal output $id | tail -n 40; bb terminal close $id`. The first line of the output gives the exit code.

## Repository constraints

- `packages/native/dist` (`index.js`, `index.d.ts` and `*.node`) is generated and not committed. Change Rust declarations and rebuild instead of editing generated output by hand.
- Update the relevant README API section for user-facing fixes or features.
- Update `skills/gpuix/` in the same PR when a change alters user-facing behaviour: a supported element, prop, style, selector, event, export or DOM API, a known gap closing or opening, or a testing behaviour. `bun run test` in `packages/plugins` checks the listed CSS module properties and selectors against the source and compiler, and the listed entry points against package exports. It does not find newly supported selectors omitted from the lists, so review the selector surface for those changes.
- This fork ships package tarballs attached to GitHub releases, stamped and packed by hand. Versions follow semver with a fixed `-fork` suffix. The three packages release in lockstep: React pins the exact native version, and plugins pins the exact React version. It does not publish the upstream package names to npm. Do not publish locally.
- Preserve attribution headers and `THIRD_PARTY_NOTICES.md` when changing ported code.

## Pull request bodies

When an agent writes the change, the PR body carries a sanitized record of what drove
it, not the raw conversation: the repository is public, and a verbatim prompt log
tends to carry local paths and workflow detail that don't belong there. This does not
apply to PRs against the Zed submodule repo.

## Built-in components follow Base UI

Headless controls in `@gpuix/react` (`select`, `combobox`, `tooltip`, and any
new primitive) should match [Base UI](https://base-ui.com/react/components/select)
first: same split between Root data and children.

For Select, `items` on Root is optional. It is only a label lookup for
`SelectValue` while the popup is closed. Keyboard nav and clicks read the mounted
`SelectItem` children. Do not walk `child.type`. Do not require `items` for the menu
to work.

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

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
