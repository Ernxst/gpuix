---
title: GPUIX on iOS
description: >
  Ship a GPUIX React app as an App Store IPA by embedding Hermes
  (bytecode, no JIT), loading @gpuix/native through Hermes Node-API,
  and painting with upstream gpui_ios. Not a Bun compile. Not Flutter AOT.
---

# GPUIX on iOS

Ship a **React + TypeScript** GPUIX app as a normal **IPA**.

This design **avoids JIT** and is **consistent with guideline 2.5.2** when
all JS bytecode ships inside the reviewed IPA. That is not an App Review
guarantee. Apple says the guidelines do not guarantee approval
([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)).

The architecture is **plausible**. The parts exist separately. They have
**not** been proven together on iOS:

```
Hermes static_h + Node-API + napi-rs staticlib + UIKit loop + React timers
```

Do that **phase-zero spike first**, on the simulator, **before** waiting
on [zed-industries/zed#63068](https://github.com/zed-industries/zed/pull/63068).
A Hermes+napi-rs host can fail without GPUI. Do not write `init_ios`
until the spike loads a `#[napi]` function from `.hbc` and a TSFN
round-trips.

`gpui_ios` still must land, or be cherry-picked onto the `gpuix` Zed
branch, before any GPUIX window on a phone.

## Gist

```
Today (desktop)                         iOS (this plan)

  bun / node                              tiny ObjC runner
       ►  process.dlopen                       ►  libhermes (interpreter)
       ►  gpuix-native.node                    ►  app.hbc  (React bytecode)
       ►  gpui_macos                           ►  libgpuix.a  (same napi-rs crate)
                                               ►  gpui_ios + Metal
```

Three facts make the **shape** legal and buildable. Each is proven
alone. The combination is the work:

1. **Hermes** compiles JS to `.hbc` bytecode on the Mac. The phone
   **interprets** it. No JIT. App Store
   [guideline 2.5.2](https://developer.apple.com/app-store/review/guidelines/#software-requirements)
   is satisfied the same way React Native is
   ([Using Hermes](https://reactnative.dev/docs/hermes)).
2. **Hermes Node-API** on the [`static_h`](https://github.com/facebook/hermes/tree/static_h)
   branch implements `napi_*` including `napi_create_threadsafe_function`
   ([API/napi](https://github.com/facebook/hermes/tree/static_h/API/napi),
   [COMPATIBILITY.md](https://github.com/facebook/hermes/blob/static_h/API/napi/COMPATIBILITY.md)).
   `@gpuix/native` already speaks that ABI. The Bun/`process.dlopen` loader
   does not come along.
3. **`gpui_ios`** is a real UIKit app: `UIWindow` → `GPUIViewController`
   → `GPUIMetalView` (`CAMetalLayer`). See
   [`window.rs` on `gpui-ios-platform`](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/src/ios/window.rs)
   and the example
   [`main.m`](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/examples/ios/app/main.m).
   GPUIX already embeds GPUI with `Application::run_embedded` on macOS
   (`packages/native/src/renderer.rs` `init_macos`). Same call, different
   platform.

Flutter AOT is **not** the model. Dart emits ARM
([Flutter engine in AOT mode](https://github.com/flutter/engine/blob/main/docs/Flutter-engine-operation-in-AOT-Mode.md),
[iOS application bundle](https://flutter.dev/blog/flutters-ios-application-bundle)).
Hermes emits bytecode
([Building and Running](https://github.com/facebook/hermes/blob/static_h/doc/BuildingAndRunning.md#compiling-and-executing-javascript-with-bytecode)).
Peak JS is slower than Bun. Startup is still fast. The GPU path is GPUI,
not Impeller.

## Why the App Store accepts this

Apple forbids **writable and executable** memory except inside WebKit.
On iOS / iPadOS, ARM **Execute Never (XN)** marks pages non-executable.
Memory that is both writable and executable is allowed only under
tightly controlled conditions, and **Safari** is the documented JIT
user ([Security of runtime process](https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web)).
The `MAP_JIT` / `com.apple.security.cs.allow-jit` entitlement is a
**macOS Hardened Runtime** exception
([Allow execution of JIT-compiled code](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-jit)),
not an iOS App Store entitlement third-party apps get.

That kills V8 JIT, Bun-with-JSC-JIT, and `bun build --compile` on iOS.

Guideline **2.5.2** is the other half
([App Review Guidelines, Software Requirements](https://developer.apple.com/app-store/review/guidelines/#software-requirements)):

> Apps should be self-contained in their bundles, and may not read or
> write data outside the designated container area, nor may they
> download, install, or execute code which introduces or changes
> features or functionality of the app.

Bundled interpreters that only run code **shipped in the IPA** are how
React Native, Flutter's Dart AOT, and Unity ship. Downloaded JS that
changes features is what 2.5.2 rejects.

The **interpreter-only** Hermes build does not need writable-executable
pages. Confirm the selected CMake flags have no JIT / machine-code
generation. Do not claim "Hermes never needs W^X" for every Hermes
configuration.

```
Mac (CI / Xcode build)

  app.tsx + @gpuix/react
       ►  bundler (one JS file, no Node builtins)
       ►  hermesc / hermes -emit-binary
          https://github.com/facebook/hermes/blob/static_h/doc/BuildingAndRunning.md
       ►  app.hbc          data, not machine code

Phone

  libhermes reads app.hbc as bytes
  interpreter runs it
  no page is marked executable by us
```

React Native ships this every day
([Using Hermes](https://reactnative.dev/docs/hermes),
[Bundled Hermes](https://reactnative.dev/architecture/bundled-hermes)).
GPUIX would ship the same engine, not RN, and paint with GPUI instead
of UIKit views.

Flutter is the contrast, not the copy. iOS cannot mark pages executable
at runtime, so Flutter links four `gen_snapshot` blobs into
`App.framework` as **ARM machine code**
([Flutter engine in AOT mode](https://github.com/flutter/engine/blob/main/docs/Flutter-engine-operation-in-AOT-Mode.md),
[custom embedding in AOT mode](https://github.com/flutter/engine/blob/main/docs/Custom-Flutter-Engine-Embedding-in-AOT-Mode.md),
[Flutter's iOS application bundle](https://flutter.dev/blog/flutters-ios-application-bundle)).
Hermes does not emit ARM. It emits `.hbc` that `hvm` interprets
([hermesc vs hvm](https://github.com/facebook/hermes/blob/static_h/doc/BuildingAndRunning.md#other-tools)).

What **fails** review if we ship it:

| Ship this | Why it dies |
|---|---|
| Bun / Node / V8 JIT | XN / W^X. No iOS JIT entitlement |
| `bun build --compile` | embeds a JIT runtime |
| A `.node` loaded with `dlopen` at runtime | iOS code signing + no Node |
| JS source evaluated with `eval` of **downloaded** code | [2.5.2](https://developer.apple.com/app-store/review/guidelines/#software-requirements) |
| An empty dummy binary that downloads the real app | 2.5.2 |
| WKWebView as the app UI with a JS bridge that changes native features from a remote URL | 2.5.2 + [2.5.6 WebKit](https://developer.apple.com/app-store/review/guidelines/#software-requirements) |

What is **consistent with this policy**, if we do it like RN:

- Hermes and `libgpuix` **statically linked** into the app binary
- `app.hbc` in the bundle, compiled at **build** time from the submitted
  source
- No download-and-eval of new JS
- Camera / IAP / whatever through **public** iOS APIs
  ([2.5.1 public APIs](https://developer.apple.com/app-store/review/guidelines/#software-requirements))

Hermes bytecode in the IPA is the same **kind** of artifact as RN's
`main.jsbundle` as `.hbc`. That is evidence by analogy, not a policy
guarantee. RN docs prove RN builds bytecode into iOS apps
([Using Hermes](https://reactnative.dev/docs/hermes)). They do not prove
a custom Hermes host is accepted.

`.hbc` in the bundle also does not cover 2.5.1 public APIs, privacy
strings, IAP, hidden features, or review notes. It only covers the
downloaded-code half of 2.5.2.

## Architecture

```
                          IPA
  ┌─────────────────────────────────────────────────────────────────┐
  │  GpuixApp.app                                                   │
  │                                                                 │
  │   main.m / AppDelegate.swift                                    │
  │        ►  UIApplicationMain                                     │
  │        ►  UIWindowScene                                         │
  │                                                                 │
  │   libhermes.a          interpreter, no JIT                      │
  │   libhermesNapi.a      napi_* + hermes_napi_create_env          │
  │   libgpuix.a           packages/native, cdylib → staticlib      │
  │   gpui_ios             UIKit + Metal                            │
  │   app.hbc              React tree + @gpuix/react                │
  │                                                                 │
  │   optional Swift       Camera.present(from: vc)                 │
  └─────────────────────────────────────────────────────────────────┘
```

Runtime once the scene connects:

```
UIKit run loop
    ►  CADisplayLink
    ►  gpui_ios_request_frame
    ►  GpuixView::render        GPUI / Taffy / Metal

Hermes on the same thread as JS today (Node main thread analogue)
    ►  hermes_run_bytecode(app.hbc)
    ►  JS calls napi GpuixRenderer
    ►  applyBatch JSON          same protocol as desktop

GPU / UIKit thread → JS
    ►  napi_call_threadsafe_function
    ►  hermes_napi_host.post_task onto the JS thread
    ►  onClick in React
```

The mutation protocol does not change. `applyBatch`, styles, events,
`<virtual-list>` stay. Only the **JS host** and the **GPUI platform**
swap.

## The three pieces

### 1. gpui_ios

Upstream PR: [zed-industries/zed#63068](https://github.com/zed-industries/zed/pull/63068)
(`gpui_ios: Add iOS platform backend`, open, branch
[`gpui-ios-platform`](https://github.com/zed-industries/zed/tree/gpui-ios-platform)).
Touch / insets / IME **API surface** already merged:
[zed#60496](https://github.com/zed-industries/zed/pull/60496).
Official tracker:
[mikayla-maki/gpui-projects/projects/mobile.md](https://github.com/mikayla-maki/gpui-projects/blob/main/projects/mobile.md)
(iOS first, Android later as
[#12](https://github.com/mikayla-maki/gpui-projects/issues/12)).

History, so we do not wait on dead PRs:

- [zed#43206](https://github.com/zed-industries/zed/issues/43206) GPUI on iOS.
  Closed as not planned, then work moved to Mikayla's tracker.
- [zed#43655](https://github.com/zed-industries/zed/pull/43655) first iOS PR.
  Closed Dec 2025: no Zed **editor** use case
  (comment from [mikayla-maki](https://github.com/zed-industries/zed/pull/43655#issuecomment-3647663410)).
- [zed#11889](https://github.com/zed-industries/zed/issues/11889) /
  [zed#12039](https://github.com/zed-industries/zed/issues/12039) Zed-the-editor
  on iPad / Android. Community demand, not a Zed product roadmap item.
- [gpui-ce/gpui-ce#13](https://github.com/gpui-ce/gpui-ce/pull/13) is that
  rejected PR on the community fork. Still open. Not ahead of Zed.
- Third-party wgpu port: [itsbalamurali/gpui-mobile](https://github.com/itsbalamurali/gpui-mobile)
  (mentioned on #43655). Not what we vendor.

Key files on `gpui-ios-platform`:

| File | What |
|---|---|
| [`crates/gpui_ios/src/ios/window.rs`](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/src/ios/window.rs) | `UIWindow` + `GPUIViewController` + `GPUIMetalView` (`CAMetalLayer`) |
| [`crates/gpui_ios/src/ios/platform.rs`](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/src/ios/platform.rs) | `Platform` impl, `presentViewController` for `SFSafariViewController` |
| [`crates/gpui_ios/src/ios/ffi.rs`](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/src/ios/ffi.rs) | `gpui_ios_run`, scene lifecycle, `run_embedded` |
| [`crates/gpui_ios/examples/ios/app/main.m`](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/examples/ios/app/main.m) | `UIApplicationMain` + `CADisplayLink` |

The example already does what GPUIX does on Mac:

```
main.m
  gpui_ios_set_window_scene(scene)
  gpui_ios_example_run()          // Application::run_embedded
  CADisplayLink → gpui_ios_request_frame
```

`packages/native/src/renderer.rs` `init_macos` already calls
`Application::with_platform(...).run_embedded`. iOS is a second
`init_ios` that uses `gpui_ios` instead of `gpui_macos`.

Do **not** write a GPUIX UIKit backend. Bump the `zed/` submodule when
`gpui_ios` is on the `gpuix` branch.

### 2. Hermes + Node-API

RN docs ([Using Hermes](https://reactnative.dev/docs/hermes)) only say
"bytecode, default engine". The embed API is in
[facebook/hermes](https://github.com/facebook/hermes) on branch
**[`static_h`](https://github.com/facebook/hermes/tree/static_h)**, not in
the RN-bundled copy ([Bundled Hermes](https://reactnative.dev/architecture/bundled-hermes)).

Node-API landed 12 May 2026:
[ff31291 Add Node-API implementation for Hermes](https://github.com/facebook/hermes/commit/ff31291e60e43c7fef4084bf7bf2b2ea98026515).
GitHub PRs show `CLOSED` because Meta lands via Phabricator
(`fbshipit-source-id`). The code is on the branch.

| Source | What |
|---|---|
| [facebook/hermes#1377](https://github.com/facebook/hermes/pull/1377) | First Node-API PR (from [microsoft/hermes-windows](https://github.com/microsoft/hermes-windows)). Closed, not GitHub-merged |
| [facebook/hermes#1610](https://github.com/facebook/hermes/issues/1610) | Tracker: Node-API on Static Hermes. Still **open** |
| [facebook/hermes#1074](https://github.com/facebook/hermes/discussions/1074) | 2023 discussion. Team first refused Node-API (no internal users) |
| [API/napi/README.md](https://github.com/facebook/hermes/blob/static_h/API/napi/README.md) | N-API v10, VM internals not JSI |
| [API/napi/COMPATIBILITY.md](https://github.com/facebook/hermes/blob/static_h/API/napi/COMPATIBILITY.md) | Full `napi_*` matrix. TSFN **Yes**, needs host event loop |
| [API/napi/hermes_napi.h](https://github.com/facebook/hermes/blob/static_h/API/napi/hermes_napi.h) | `hermes_napi_create_env`, `hermes_run_bytecode`, `hermes_napi_host` |
| [NapiTsfnTest.cpp](https://github.com/facebook/hermes/blob/static_h/unittests/napi/NapiTsfnTest.cpp) | TSFN tests |
| [tools/napi-runner](https://github.com/facebook/hermes/blob/static_h/tools/napi-runner/napi-runner.cpp) | Host that loads addons without Node |
| [#2044](https://github.com/facebook/hermes/pull/2044) / [da69c31](https://github.com/facebook/hermes/commit/da69c31361) | Export `hermes_napi_*` |
| [#2106](https://github.com/facebook/hermes/pull/2106) / [efcf68e](https://github.com/facebook/hermes/commit/efcf68e285) | `extern "C"` so symbols actually export |
| [150a15c](https://github.com/facebook/hermes/commit/150a15c19d) | Runtime owns `napi_env`, no `destroy_env` |
| [33a9e00](https://github.com/facebook/hermes/commit/33a9e00dd5) | TSFN `ref_loop` / `unref_loop` |
| [Node-API spec](https://nodejs.org/api/n-api.html) | The ABI we already compile against (`napi` crate, NAPI 8 in `Cargo.toml`) |
| [JSI HostObject](https://github.com/facebook/hermes/blob/static_h/API/jsi/jsi/jsi.h) | The **other** FFI. RN TurboModules. Do not rewrite onto this |
| [What is Codegen?](https://reactnative.dev/docs/the-new-architecture/what-is-codegen) | RN still generates JSI glue, not napi |
| [tmikov/hermes-jsi-demos](https://github.com/tmikov/hermes-jsi-demos) | Embed Hermes **without** RN, JSI path |
| [serishema/hermes-host-starter](https://github.com/serishema/hermes-host-starter) | Minimal JSI host. Hermes has almost no JS stdlib |

Host API:

```c
hermes_napi_create_env(hermes_runtime, &host);
hermes_napi_load_module(env, path, &exports);   // dlopen path; iOS will not use this
hermes_run_bytecode(env, hbc, size, ...);
```

`hermes_napi_host` is the event loop **we** own
([struct in hermes_napi.h](https://github.com/facebook/hermes/blob/static_h/API/napi/hermes_napi.h),
[napi_create_threadsafe_function](https://github.com/facebook/hermes/blob/static_h/API/napi/hermes_napi_tsfn.cpp)):

| Hook | GPUIX need |
|---|---|
| `post_task` | **Required.** TSFN dispatch. napi-rs also creates a TSFN inside `napi_register_module_v1` ([module_register.rs](https://github.com/napi-rs/napi-rs/blob/napi-v3.8.3/crates/napi/src/bindgen_runtime/module_register.rs)). Install `post_task` **before** registration, not only before `GpuixRenderer` |
| `post_work` / `cancel_work` | Needed if any `#[napi] async` / `napi_queue_async_work` (camera Promise) |
| `ref_loop` / `unref_loop` | Optional. Without them, TSFN ref state does not keep the loop alive |
| `uv_loop` | leave null. Hermes has no libuv (COMPATIBILITY note 11) |

`post_task` must queue, not call inline. It must run only on the
Hermes-owning thread. After each JS callback the host must
`runtime.drainJobs()` so Promise `.then` and `queueMicrotask` run
([COMPATIBILITY notes 5 and 8](https://github.com/facebook/hermes/blob/static_h/API/napi/COMPATIBILITY.md),
[ConsoleHost](https://github.com/facebook/hermes/blob/static_h/lib/ConsoleHost/ConsoleHost.cpp)).

One UIKit-driven serial queue owns:

```
post_task  +  setTimeout  +  queueMicrotask  +  drainJobs  +  CADisplayLink
```

Vendor **Hermes `static_h`**, not `react-native`'s Hermes. RN still
talks JSI / TurboModules. We need Node-API.

Bytecode compile on the host
([Building and Running](https://github.com/facebook/hermes/blob/static_h/doc/BuildingAndRunning.md)):

```
hermes -emit-binary -out app.hbc app.js
# or hermesc, compiler-only, no VM
```

### 3. @gpuix/native over Node-API, without Node

napi-rs emits a `.node` plus `index.js` that calls `process.dlopen`
([napi-rs](https://napi.rs/),
[support / compatibility](https://napi.rs/docs/more/support-compatibility)).
Hermes has no `process`. iOS also should not `dlopen` an unsigned
addon.

Keep the **Rust crate**. Change the **artifact**. Adding `staticlib` is
**not** enough.

```
desktop     crate-type = ["cdylib"]     gpuix-native.node
            napi default features (dyn-symbols)

iOS         one final static archive, force-loaded
            libgpuix_ios.a = gpuix-native rlib + gpui + gpui_ios
            napi default-features = false, features = ["napi8", "serde-json"]
            no dyn-symbols: napi_sys::setup() dlopen/dlsym will not
            see statically linked napi_*
            ([napi-rs iOS issue](https://github.com/napi-rs/napi-rs/issues/1868))
```

Do **not** also link a second `gpui_ios.a`. Duplicate Rust symbols.

Xcode must `-Wl,-force_load,libgpuix_ios.a`. napi-rs registers
`#[napi]` exports with `ctor` constructors. A static archive drops
"unused" members. Without force-load, `napi_register_module_v1` can
exist and return an **empty** exports object.

Registration sketch (not `dlopen`):

```c
napi_open_handle_scope(env, &scope);
napi_create_object(env, &exports);
registered = napi_register_module_v1(env, exports);
napi_set_named_property(env, global, "__gpuixNative", registered);
// persist registered; then close scope
```

Same `#[napi]` functions. Same `ThreadsafeFunction<EventPayload>`
(`packages/native/src/renderer.rs`). napi-rs **3.8.3** already creates
a custom-GC TSFN during `napi_register_module_v1`. Host must be live
first.

The current
`[target.'cfg(not(target_family = "wasm"))'.dependencies]`
pulls `gpui_platform` with `wayland` + `x11`. That must not apply to
iOS. `renderer.rs` also has macOS / Windows / Linux branches and an
"unsupported OS" fallback. Inventory those APIs; `init_ios` alone
leaves most of them dead.

Do **not** rewrite the addon in JSI. Node-API is still the reuse path.
napi-rs WASI
([WebAssembly and WASI](https://napi.rs/docs/concepts/webassembly))
is a **browser/Node fallback**, not an iOS IPA. Ignore it.
Do not enable the napi-rs `noop` feature; that kills registration.

## JS bundle

Hermes is not Node. There is no `fs`, `require`, `process`, or bun APIs.

The iOS bundle is **one file**, with a **defined** native contract.
Do not leave "global or require shim" open.

`packages/react/src/reconciler/renderer.ts` does
`import { GpuixRenderer } from "@gpuix/native"`. The published
`@gpuix/native` loader is Node/`process.dlopen`. A normal bundle of
`@gpuix/react` will pull that loader and die.

Concrete contract:

- alias `@gpuix/native` to a tiny iOS module that reads
  `globalThis.__gpuixNative`
- do **not** start the desktop frame loop (`instanceof GpuixRenderer`
  + `process` in `renderer.ts`)
- fail the build if the bundle still contains `process.dlopen`,
  `node:fs`, or bun APIs

Hermes also has almost no host stdlib
([hermes-host-starter](https://github.com/serishema/hermes-host-starter)).
The runner must install, before `hermes_run_bytecode`:

| Required for GPUIX / React | Later / app |
|---|---|
| `console` | `fetch` |
| `setTimeout` / `clearTimeout` (host config uses them) | `URL` |
| `queueMicrotask` (Select / Combobox) | `TextEncoder` / `TextDecoder` |
| `performance.now` | `AbortController`, `WebSocket`, `crypto.getRandomValues` |

Metro or `bun build` to a single IIFE, then `hermesc` to `.hbc`.

## Native iOS APIs and Swift screens

`gpui_ios` is UIKit. A camera is a **presented view controller**, not a
GPUI element.

The PR already presents [`SFSafariViewController`](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller)
from `IosPlatform::open_url` via `presentViewController`
([`platform.rs`](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/src/ios/platform.rs)).
Camera is the same call with
[`UIImagePickerController`](https://developer.apple.com/documentation/uikit/uiimagepickercontroller)
or
[`PHPickerViewController`](https://developer.apple.com/documentation/photokit/phpickerviewcontroller).

```
<button onClick={() => Camera.present()}>
```

```
JS  ►  napi Camera.present({ onResult })
    ►  Xcode host (not IosPlatform::root_view_controller; that is private)
    ►  Swift / ObjC GpuixCamera.present(from: scene.rootVC)
    ►  UIImagePickerController
    ►  completion: image | cancel | permission denied
```

`IosPlatform::root_view_controller` in
[`platform.rs`](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/src/ios/platform.rs)
is **private**. `packages/native` cannot call it. v1 keeps presentation
in the Xcode host, which already has the scene.

Swift **can** call a C / ObjC bridge around Hermes. The useful rule:
keep Node-API in C or Objective-C++, expose a small Swift-facing
bridge. Do not put Swift inside `crates/gpui_ios` or
`packages/native`. `gpui_ios` has no Swift build.

A camera API is not `Camera.present()` with no result. v1 needs a
callback or Promise (selected image, cancel, permission). A Promise
may need `post_work`, not only `post_task`.

Do **not** embed a live camera `UIView` inside a GPUI `div` in v1.
That is Flutter
[PlatformView](https://docs.flutter.dev/platform-integration/ios/platform-views) /
RN native component: a hole in the Metal layer plus a UIKit subview.
The PR only `addSubview`s the hidden 1×1 keyboard view in
[`window.rs`](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/src/ios/window.rs).
Present a full screen. Inline native views are a later element.

Privacy strings for camera:
[`NSCameraUsageDescription`](https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription).

## App Store packaging

```
Xcode GpuixApp.xcodeproj

  GpuixApp (UIKit runner)
    main.m / SceneDelegate
    Info.plist, icons, privacy strings
    Swift Camera / Share / whatever

  libhermes.a + libhermesNapi.a     built for aarch64-apple-ios
  libgpuix.a                        cargo --target aarch64-apple-ios
  app.hbc                           hermesc in a Run Script phase

  Signing
    Apple Distribution cert
    embedded.mobileprovision
    no JIT entitlement (none exists; we do not need one)
```

CI:

1. `hermesc` the app → `app.hbc`
2. `cargo build -p gpuix-native --target aarch64-apple-ios --release`
   with `staticlib` + `gpui_ios`
3. CMake/build Hermes `static_h` for iOS
4. `xcodebuild -archive` → `.xcarchive`, then
   `xcodebuild -exportArchive` → IPA
5. Upload with Xcode, Transporter, or App Store Connect. `altool` is
   the old path. Do not use `notarytool` (that is Mac notarization)

Simulator is `aarch64-apple-ios-sim` (Apple Silicon) or
`x86_64-apple-ios-sim`. Device is `aarch64-apple-ios`. Same three
triples RN uses.

Code signing: one binary, all static libs linked in. Hermes and GPUIX
are not downloaded. Bitcode is dead; ignore it.

Privacy: camera and photos need
[`NSCameraUsageDescription`](https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription)
/ photo-library keys. Generic HTTPS has no usage-description key.
Local-network discovery is `NSLocalNetworkUsageDescription`. Guideline
[2.5.14](https://developer.apple.com/app-store/review/guidelines/#software-requirements)
requires consent and a visible or audible recording indicator. A
system camera UI already provides that; do not invent a second light.

## What we implement in this repo

Order. Do not skip.

0. **Phase-zero spike** (simulator, **no GPUI**). Proves the reuse
   path or kills it:
   1. Hermes `static_h` for `aarch64-apple-ios-sim`
   2. napi-rs with `default-features = false`, `napi8`
   3. force-load the archive; `napi_register_module_v1` returns a
      **non-empty** exports object in a **release** build
   4. JS in `.hbc` calls a Rust `#[napi]` function
   5. Rust TSFN → `post_task` → JS callback
   6. that callback schedules a Promise; `drainJobs` runs it
   7. teardown with a live TSFN does not crash
1. **Wait / bump** `zed/` to a commit that has `gpui_ios` on the
   `gpuix` branch. Cherry-pick from `gpui-ios-platform` if upstream
   stalls. Do not build GPUIX APIs on the PR's **private** details
   (Anthony-Eid still needs to review architecture on #63068).
2. **Register a GPUI app callback** and let `gpui_ios` own startup:
   `gpui_ios::ios::ffi::set_app_callback` then `run_app()`
   ([ffi.rs](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/src/ios/ffi.rs),
   [example](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/examples/ios/src/gpui_ios_example.rs)).
   Do **not** copy `init_macos`'s `Application::with_platform` and
   skip the FFI wrapper. That drops the stored `ApplicationHandle`.
   One scene per process in v1. Pause `CADisplayLink` in background.
3. **iOS runner** that:
   - creates Hermes with microtasks on
   - installs `hermes_napi_host` **then** `napi_env`
   - creates exports, `napi_register_module_v1`, roots
     `globalThis.__gpuixNative`
   - installs `console` / timers / `queueMicrotask` / `performance`
   - runs `app.hbc`, `drainJobs`
   - forwards scene lifecycle to `gpui_ios_*`
4. **Cargo iOS target**: one `libgpuix_ios.a`, no `wayland`/`x11`,
   no `dyn-symbols`, no `test-support`. Inventory `renderer.rs`
   public methods for iOS.
5. **JS bundle script**: alias `@gpuix/native`, one file in, `.hbc`
   out. Fail if `process.dlopen` remains.
6. **Native modules as napi**: camera completion in the Xcode host.
7. **Docs + changeset** when any of this is user-facing. Until then
   this file is the plan.

Out of scope for v1:

- Android (`gpui_android` does not exist; tracker lists it as later)
- Inline UIView-in-div
- Fast Refresh on device (RN has it; we do not need it to ship)
- Sharing the desktop Bun host with Hermes
- Rewriting `@gpuix/native` in JSI / TurboModules
- `bun build --compile` for iOS

## Desktop stays Bun

iOS is a **second host**. Desktop keeps:

```
bun / node  ►  gpuix-native.node  ►  gpui_macos / gpui_linux / gpui_windows
```

Do not embed Hermes on desktop. napi-rs + Node/Bun already works.
One addon, two loaders.

## Risks

- **`gpui_ios` is not merged.** Foundational. The PR says it includes
  native text input; **IME completeness is unproven**, not "absent
  until UITextInput exists". File picker and RN-quality momentum
  scroll are still missing. Author notes the PR was agentically
  created and still needs architecture review
  ([#63068](https://github.com/zed-industries/zed/pull/63068)).
- **Hermes Node-API claims v10** ([COMPATIBILITY.md](https://github.com/facebook/hermes/blob/static_h/API/napi/COMPATIBILITY.md)).
  Landing commit said 1–9. Tracker [#1610](https://github.com/facebook/hermes/issues/1610)
  is still open. Vendored Node tests: 33 pass, 31 skip, 0 fail. CTS
  coverage is one test. Say "claims Node-API 10", not "full proven".
  napi8 addons are ABI-compatible with a conforming N-API 10 runtime.
- **TSFN needs our event loop.** If `post_task` is wrong, clicks never
  reach React, or they re-enter the GPU thread. This is the hardest
  host bug. Test it before any UI work.
- **iOS `dlopen` of a `.node` is the wrong design** even if it builds
  in the simulator. Static link from day one.
- **Bundle size.** Hermes + GPUI + Syntect is larger than a RN hello
  world. Measure before promising Flutter-like IPAs.
- **No nested scroll, no DOM.** iOS users will expect Safari gestures.
  GPUIX still has one scroll parent. That constraint does not go away
  on a phone.

## How to tell it worked

A simulator build that:

1. Shows a GPUIX `<div>` with a button
2. Fires `onClick` through Hermes TSFN
3. Re-renders through `applyBatch`
4. Presents `UIImagePickerController` from that click
5. Contains **no** JIT in the **device** archive (linked symbols,
   entitlements, `vmmap` on device). Simulator `vmmap` proves little
6. `xcodebuild -archive` + `-exportArchive` produces an IPA Xcode
   will upload

Until that exists, this is a plan, not a feature.

## Sources

Primary documents this plan is built from. Prefer these over chat
summaries.

### Apple

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
  especially [2.5 Software Requirements](https://developer.apple.com/app-store/review/guidelines/#software-requirements)
  (2.5.1 public APIs, 2.5.2 self-contained / no downloaded code, 2.5.6 WebKit)
- [Security of runtime process (XN, Safari JIT)](https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web)
- [Allow execution of JIT-compiled code entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-jit)
  (macOS Hardened Runtime, not iOS App Store)
- [Porting JIT compilers to Apple silicon](https://developer.apple.com/documentation/apple-silicon/porting-just-in-time-compilers-to-apple-silicon)
- [UIImagePickerController](https://developer.apple.com/documentation/uikit/uiimagepickercontroller)
- [SFSafariViewController](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller)
- [NSCameraUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription)

### Hermes / React Native

- [facebook/hermes](https://github.com/facebook/hermes) default branch `static_h`
- [Using Hermes (RN docs)](https://reactnative.dev/docs/hermes)
- [Bundled Hermes](https://reactnative.dev/architecture/bundled-hermes)
- [Building and Running](https://github.com/facebook/hermes/blob/static_h/doc/BuildingAndRunning.md)
  (`hermes -emit-binary`, `hermesc`, `hvm`)
- [Hermes Design.md](https://github.com/facebook/hermes/blob/static_h/doc/Design.md)
- [API/napi](https://github.com/facebook/hermes/tree/static_h/API/napi)
- [API/napi/README.md](https://github.com/facebook/hermes/blob/static_h/API/napi/README.md)
- [API/napi/COMPATIBILITY.md](https://github.com/facebook/hermes/blob/static_h/API/napi/COMPATIBILITY.md)
- [hermes_napi.h](https://github.com/facebook/hermes/blob/static_h/API/napi/hermes_napi.h)
- [ff31291 Node-API implementation](https://github.com/facebook/hermes/commit/ff31291e60e43c7fef4084bf7bf2b2ea98026515)
- [hermes#1377](https://github.com/facebook/hermes/pull/1377) [hermes#1610](https://github.com/facebook/hermes/issues/1610)
  [hermes#1074](https://github.com/facebook/hermes/discussions/1074)
  [hermes#2042](https://github.com/facebook/hermes/issues/2042)
  [hermes#2044](https://github.com/facebook/hermes/pull/2044)
  [hermes#2106](https://github.com/facebook/hermes/pull/2106)
- [Node-API](https://nodejs.org/api/n-api.html)
- [What is Codegen?](https://reactnative.dev/docs/the-new-architecture/what-is-codegen)
- [tmikov/hermes-jsi-demos](https://github.com/tmikov/hermes-jsi-demos)
- [serishema/hermes-host-starter](https://github.com/serishema/hermes-host-starter)

### GPUI / Zed

- [zed#63068 gpui_ios](https://github.com/zed-industries/zed/pull/63068)
- [zed#60496 mobile/touch API](https://github.com/zed-industries/zed/pull/60496)
- [branch gpui-ios-platform](https://github.com/zed-industries/zed/tree/gpui-ios-platform)
- [window.rs](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/src/ios/window.rs)
- [platform.rs](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/src/ios/platform.rs)
- [ffi.rs](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/src/ios/ffi.rs)
- [example main.m](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/examples/ios/app/main.m)
- [Mikayla mobile tracker](https://github.com/mikayla-maki/gpui-projects/blob/main/projects/mobile.md)
- [zed#43206](https://github.com/zed-industries/zed/issues/43206)
  [zed#43655](https://github.com/zed-industries/zed/pull/43655)
  [zed#11889](https://github.com/zed-industries/zed/issues/11889)
  [zed#12039](https://github.com/zed-industries/zed/issues/12039)
- [gpui-ce](https://github.com/gpui-ce/gpui-ce) [gpui-ce#13](https://github.com/gpui-ce/gpui-ce/pull/13)
- [itsbalamurali/gpui-mobile](https://github.com/itsbalamurali/gpui-mobile)

### Flutter (contrast only)

- [Flutter engine in AOT mode](https://github.com/flutter/engine/blob/main/docs/Flutter-engine-operation-in-AOT-Mode.md)
- [Custom Flutter engine embedding in AOT mode](https://github.com/flutter/engine/blob/main/docs/Custom-Flutter-Engine-Embedding-in-AOT-Mode.md)
- [Flutter's iOS application bundle](https://flutter.dev/blog/flutters-ios-application-bundle)
- [Flutter FAQ](https://docs.flutter.dev/resources/faq)
- [Platform views on iOS](https://docs.flutter.dev/platform-integration/ios/platform-views)

### napi-rs / this repo

- [napi.rs](https://napi.rs/)
- [napi-rs support](https://napi.rs/docs/more/support-compatibility)
- [napi-rs WASI](https://napi.rs/docs/concepts/webassembly)
- [napi-rs iOS support issue](https://github.com/napi-rs/napi-rs/issues/1868)
- [napi-rs 3.8.3 module_register.rs](https://github.com/napi-rs/napi-rs/blob/napi-v3.8.3/crates/napi/src/bindgen_runtime/module_register.rs)
- `packages/native/Cargo.toml`, `packages/native/src/renderer.rs` `init_macos`
- [gpui_ios example.rs](https://github.com/zed-industries/zed/blob/gpui-ios-platform/crates/gpui_ios/examples/ios/src/gpui_ios_example.rs)
