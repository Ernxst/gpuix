#!/usr/bin/env python3
"""Collect five quiet-host app-bench invocations with their raw outputs."""

import csv
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[2]
LIMIT = 4.0
QUIET_SECONDS = 300
POLL_SECONDS = 5
VALID_RUNS = 5
MAX_ATTEMPTS = 15


def log(message: str) -> None:
    print(f"[quiet-bench] {message}", flush=True)


def wait_for_quiet() -> None:
    quiet_since = None
    while True:
        load = os.getloadavg()[0]
        now = time.monotonic()
        quiet_since = now if load >= LIMIT or quiet_since is None else quiet_since
        if load >= LIMIT:
            quiet_since = None
        if quiet_since is not None and now - quiet_since >= QUIET_SECONDS:
            return
        if int(now) % 30 < POLL_SECONDS:
            elapsed = 0 if quiet_since is None else now - quiet_since
            log(f"waiting for five minutes below {LIMIT}: load={load:.2f}, quiet={elapsed:.0f}s")
        time.sleep(POLL_SECONDS)


def latest_result(after: float) -> Path | None:
    candidates = (ROOT / "tmp" / "app-bench").glob("*.json")
    return max((p for p in candidates if p.stat().st_mtime >= after), key=lambda p: p.stat().st_mtime, default=None)


def run_attempt(destination: Path, attempt: int, frame_only: bool) -> bool:
    if not frame_only and not run_app_attempt(destination, attempt):
        return False
    return run_frame_attempt(destination, attempt)


def run_app_attempt(destination: Path, attempt: int) -> bool:
    log_path = destination / f"attempt-{attempt}.log"
    load_path = destination / f"attempt-{attempt}-load.csv"
    started_at = time.time()
    with log_path.open("w") as output, load_path.open("w", newline="") as load_output:
        writer = csv.writer(load_output)
        writer.writerow(("epoch_seconds", "load_1m"))
        process = subprocess.Popen(
            ["bun", "examples/bench/app-bench.ts", "--runs", "5"],
            cwd=ROOT,
            stdout=output,
            stderr=subprocess.STDOUT,
            env={**os.environ, "CARGO_BUILD_JOBS": "1"},
        )
        noisy = False
        while process.poll() is None:
            load = os.getloadavg()[0]
            writer.writerow((time.time(), load))
            load_output.flush()
            noisy |= load >= LIMIT
            time.sleep(POLL_SECONDS)
        load = os.getloadavg()[0]
        writer.writerow((time.time(), load))
        noisy |= load >= LIMIT

    if process.returncode != 0:
        log(f"attempt {attempt} failed with exit {process.returncode}; see {log_path}")
        return False
    result = latest_result(started_at)
    if result is None:
        log(f"attempt {attempt} produced no JSON; see {log_path}")
        return False
    data = json.loads(result.read_text())
    complete = all(
        len(report.get("startupSamples", [])) == 5
        and len(report.get("startupRunDetails", [])) == 6
        and report.get("firstLaunchMs") is not None
        for report in data["reports"]
    )
    reported_loads = [
        detail[edge]["load1"]
        for report in data["reports"]
        for detail in report["startupRunDetails"] + (report.get("buildRunDetails") or [])
        for edge in ("hostLoadStart", "hostLoadEnd", "loadStart", "loadEnd")
        if edge in detail
    ]
    valid = complete and not noisy and all(load < LIMIT for load in reported_loads)
    suffix = "valid" if valid else "discarded"
    shutil.copy2(result, destination / f"attempt-{attempt}-{suffix}.json")
    log(f"attempt {attempt}: {suffix}; raw JSON {result}")
    return valid


def run_frame_attempt(destination: Path, attempt: int) -> bool:
    frame_log = destination / f"attempt-{attempt}-frame.log"
    frame_load = destination / f"attempt-{attempt}-frame-load.csv"
    with frame_log.open("w") as output, frame_load.open("w", newline="") as load_output:
        writer = csv.writer(load_output)
        writer.writerow(("epoch_seconds", "load_1m"))
        process = subprocess.Popen(
            ["bun", "examples/bench/frame-time.tsx"],
            cwd=ROOT,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        noisy = False
        deadline = time.monotonic() + 60
        while process.poll() is None and time.monotonic() < deadline:
            load = os.getloadavg()[0]
            writer.writerow((time.time(), load))
            load_output.flush()
            noisy |= load >= LIMIT
            time.sleep(1)
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        noisy |= os.getloadavg()[0] >= LIMIT
    if process.returncode != 0 or noisy:
        log(f"attempt {attempt}: frame fixture failed or load exceeded {LIMIT}; see {frame_log}")
        return False
    marker = next((line.split("GPUIX_FRAME_BENCH ", 1)[1].strip() for line in frame_log.read_text().splitlines() if "GPUIX_FRAME_BENCH " in line), None)
    if marker is None:
        log(f"attempt {attempt}: frame fixture produced no marker; see {frame_log}")
        return False
    frame = json.loads(marker)
    if any(frame[mode]["n"] != 120 for mode in ("scroll", "scrollCycle", "animation", "animationCycle")):
        log(f"attempt {attempt}: frame fixture had incomplete samples; see {frame_log}")
        return False
    (destination / f"attempt-{attempt}-frame.json").write_text(json.dumps(frame, indent=2))
    log(f"attempt {attempt}: frame fixture valid")
    return True


def main() -> int:
    options = sys.argv[2:]
    if len(sys.argv) < 2 or len(options) != len(set(options)) or set(options) - {"--frame-only", "--resume"}:
        print("usage: run-app-bench.py <output-directory> [--frame-only] [--resume]", file=sys.stderr)
        return 2
    destination = Path(sys.argv[1]).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    frame_only = "--frame-only" in options
    resume = "--resume" in options
    previous = [int(path.stem.split("-")[1]) for path in destination.glob("attempt-*.log")]
    if previous and not resume:
        log(f"existing attempts in {destination}; pass --resume to preserve them")
        return 2
    start_attempt = max(previous, default=0) + 1 if resume else 1
    completed = (
        destination.glob("attempt-*-frame.json")
        if frame_only
        else (
            path
            for path in destination.glob("attempt-*-valid.json")
            if (destination / path.name.replace("-valid.json", "-frame.json")).exists()
        )
    )
    valid = sum(1 for _ in completed) if resume else 0
    if valid >= VALID_RUNS:
        log(f"already completed {valid} valid invocations in {destination}")
        return 0
    log(f"starting at attempt {start_attempt} with {valid} valid invocations")
    for attempt in range(start_attempt, start_attempt + MAX_ATTEMPTS):
        wait_for_quiet()
        if run_attempt(destination, attempt, frame_only):
            valid += 1
            if valid == VALID_RUNS:
                log(f"completed {valid} valid invocations in {destination}")
                return 0
    log(f"only {valid} valid invocations after {MAX_ATTEMPTS} more attempts")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
