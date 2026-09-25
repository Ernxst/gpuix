#!/usr/bin/env python3
"""Interleave 10 launch-to-second-frame runs of baseline and candidate binaries.

From the repository root, build each binary from the requested zed revision:

    git -C zed checkout 7982bf8aea54e3537ba2823fe677bf0c47704a8b
    (cd packages/native && cargo build -p gpuix-native --release --example hello_bench)
    cp packages/native/target/release/examples/hello_bench /tmp/hello_bench_before
    git -C zed checkout 21008b55c3
    (cd packages/native && cargo build -p gpuix-native --release --example hello_bench)
    cp packages/native/target/release/examples/hello_bench /tmp/hello_bench_after
    python3 scripts/benchmark-599.py /tmp/hello_bench_before /tmp/hello_bench_after

Run when no other builds or tests are active. Each run opens a real window and
the script terminates it after `hello_bench` reports its second presented frame.
"""

import json
import selectors
import statistics
import subprocess
import sys
import time


def measure(binary):
    process = subprocess.Popen(
        [binary], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + 15
    output = []
    try:
        while time.monotonic() < deadline:
            if not selector.select(deadline - time.monotonic()):
                continue
            line = process.stdout.readline()
            if not line:
                break
            output.append(line.rstrip())
            if line.startswith("GPUIX_BENCH "):
                event = json.loads(line.removeprefix("GPUIX_BENCH "))
                return event["sinceStartMs"]
        raise RuntimeError("did not receive the second-frame GPUIX_BENCH event:\n" + "\n".join(output))
    finally:
        selector.close()
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main():
    if len(sys.argv) != 3:
        raise SystemExit(f"usage: {sys.argv[0]} BASELINE_BINARY CANDIDATE_BINARY")

    baseline_binary, candidate_binary = sys.argv[1:]
    baseline = []
    candidate = []
    for pair in range(10):
        order = (
            [("baseline", baseline_binary), ("candidate", candidate_binary)]
            if pair % 2 == 0
            else [("candidate", candidate_binary), ("baseline", baseline_binary)]
        )
        for label, binary in order:
            value = measure(binary)
            (baseline if label == "baseline" else candidate).append(value)
            print(f"{pair + 1:02d} {label}: {value:.2f} ms", flush=True)

    baseline_median = statistics.median(baseline)
    candidate_median = statistics.median(candidate)
    print(f"baseline median (10): {baseline_median:.2f} ms")
    print(f"candidate median (10): {candidate_median:.2f} ms")
    print(f"change: {candidate_median - baseline_median:+.2f} ms")


if __name__ == "__main__":
    main()
