#!/usr/bin/env python3
"""Compare two prepared checkouts in load-matched baseline/candidate pairs."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time


spec = importlib.util.spec_from_file_location(
    "quiet_app_bench", Path(__file__).with_name("run-app-bench.py")
)
assert spec is not None and spec.loader is not None
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    roots = {"baseline": args.baseline.resolve(), "candidate": args.candidate.resolve()}
    for label, root in roots.items():
        if not (root / "scripts" / "app-bench.ts").is_file():
            parser.error(f"{label} is not a prepared GPU-IX checkout: {root}")

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    pair_dirs = sorted(output.glob("pair-*"))
    existing = sorted(output.glob("pair-*/pair.json"))
    if pair_dirs and not args.resume:
        parser.error("output already contains pairs; pass --resume")

    bench.LIMIT = 6.0
    # The paired protocol uses a short preflight gate, then rejects the whole
    # pair if either revision sees a one-minute load of six or more.
    bench.QUIET_SECONDS = 60
    accepted = sum(json.loads(path.read_text()).get("accepted", False) for path in existing)
    next_pair = max((int(path.name.split("-")[1]) for path in pair_dirs), default=0) + 1
    print(f"[paired-bench] starting pair {next_pair} with {accepted} accepted", flush=True)

    for number in range(next_pair, next_pair + 25):
        bench.wait_for_quiet()
        pair_dir = output / f"pair-{number}"
        pair_dir.mkdir()
        loads = [(time.time(), os.getloadavg()[0])]
        results = {}

        for label in ("baseline", "candidate"):
            if any(load >= bench.LIMIT for _, load in loads):
                break
            side_dir = pair_dir / label
            side_dir.mkdir()
            bench.ROOT = roots[label]
            print(f"[paired-bench] pair {number}: {label}", flush=True)
            results[label] = bench.run_attempt(side_dir, number, False)
            loads.append((time.time(), os.getloadavg()[0]))
            if not results[label]:
                break

        valid = (
            results.get("baseline", False)
            and results.get("candidate", False)
            and all(load < bench.LIMIT for _, load in loads)
        )
        record = {"accepted": valid, "loads": loads, "revisions": {}}
        for label, root in roots.items():
            record["revisions"][label] = {
                "checkout": root.as_posix(),
                "gpuix": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
                "zed": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root / "zed", text=True).strip(),
            }
        (pair_dir / "pair.json").write_text(json.dumps(record, indent=2) + "\n")
        print(f"[paired-bench] pair {number}: {'accepted' if valid else 'discarded'}", flush=True)
        if valid:
            accepted += 1
            if accepted == 5:
                print("[paired-bench] completed five accepted pairs", flush=True)
                return 0

    print(f"[paired-bench] only {accepted} accepted pairs after 25 more attempts", flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
