import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} ${args.join(" ")} failed`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function parseArgs(args: string[]) {
  let target = process.env.CARGO_BUILD_TARGET ?? process.env.NAPI_RS_TARGET ?? "";
  let features = process.env.GPUX_NATIVE_FEATURES ?? "test-support";
  let dry = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--dry") {
      dry = true;
    } else if (argument === "--target" || argument === "--features") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--target") target = value;
      else features = value;
      index += 1;
    } else if (argument.startsWith("--target=")) {
      target = argument.slice("--target=".length);
    } else if (argument.startsWith("--features=")) {
      features = argument.slice("--features=".length);
    } else {
      throw new Error(`Unsupported build:native argument: ${argument}`);
    }
  }
  return { target, features, dry };
}

async function cargoConfigIdentity() {
  const configRoot = process.env.CARGO_HOME ?? path.join(process.env.HOME ?? "", ".cargo");
  const paths = [path.join(configRoot, "config"), path.join(configRoot, "config.toml")];
  const configs = await Promise.all(
    paths.map(async (file) => {
      try {
        return [path.basename(file), createHash("sha256").update(await readFile(file)).digest("hex")];
      } catch {
        return [path.basename(file), null];
      }
    }),
  );
  return configs;
}

function sdkIdentity() {
  if (process.platform === "darwin") {
    return {
      developerDir: run("xcode-select", ["-p"]),
      sdkPath: run("xcrun", ["--sdk", "macosx", "--show-sdk-path"]),
      sdkVersion: run("xcrun", ["--sdk", "macosx", "--show-sdk-version"]),
      sdkBuild: run("xcrun", ["--sdk", "macosx", "--show-sdk-build-version"]),
      xcode: run("xcodebuild", ["-version"]),
      linker: run("clang", ["--version"]),
    };
  }
  if (process.platform === "win32") {
    return {
      windowsSdkDir: process.env.WindowsSdkDir ?? null,
      windowsSdkVersion: process.env.WindowsSDKVersion ?? null,
      vcToolsVersion: process.env.VCToolsVersion ?? null,
      compiler: run("cl", ["/Bv"]),
      linker: run("link", ["/version"]),
    };
  }
  return {
    compiler: run("cc", ["--version"]),
    linker: run("ld", ["--version"]),
  };
}

const { target: requestedTarget, features, dry } = parseArgs(process.argv.slice(2));
const rustc = run("rustc", ["-Vv"]);
const cargo = run("cargo", ["-Vv"]);
const target = requestedTarget || rustc.match(/^host: (.+)$/m)?.[1];
if (!target) throw new Error("Could not determine the native build target");

const context = {
  os: process.platform,
  architecture: process.arch,
  target,
  features: features.split(/[\s,]+/).filter(Boolean).sort(),
  profile: "release",
  rustc,
  cargo,
  mbx: run("mbx", ["--version"]),
  bun: run("bun", ["--version"]),
  cargoConfig: await cargoConfigIdentity(),
  sdk: sdkIdentity(),
  buildEnvironment: Object.fromEntries(
    Object.entries(process.env)
      .filter(([name]) =>
      /^(CARGO|RUST|CC|CXX|AR|CFLAGS|CXXFLAGS|CPPFLAGS|LDFLAGS|SDKROOT|MACOSX_|IPHONEOS_|DEVELOPER_DIR|VCTOOLS|WINDOWSSDK|INCLUDE$|LIB$|PKG_CONFIG|VCPKG|ZIG|DEPLOYMENT_TARGET|NAPI_RS_)/i.test(name) &&
        !/(TOKEN|PASSWORD|SECRET|PRIVATE_KEY)/i.test(name),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  ),
};

const result = spawnSync(
  "bun",
  ["x", "turbo", "run", "//#native:build", ...(dry ? ["--dry=json"] : [])],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      GPUX_NATIVE_BUILD_CONTEXT: JSON.stringify(context),
      GPUX_NATIVE_FEATURES: features,
      GPUX_NATIVE_TARGET: target,
    },
  },
);
if (result.error || result.status !== 0) {
  throw result.error ?? new Error(`Turbo native build failed with status ${result.status}`);
}
