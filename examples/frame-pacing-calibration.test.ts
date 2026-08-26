import { describe, expect, it } from "vitest"
import {
  calibrateFramePacingWork,
  isDisplayLinkProgressing,
  isTimerPacingDegraded,
} from "./frame-pacing-calibration"

describe("frame pacing workload calibration", () => {
  it("crosses the refresh deadline when the fixed floor would remain below it", () => {
    const refreshPeriodMs = 1_000 / 60
    const tickP50Ms = 4.1
    const marginMs = 5
    const floorMs = 12

    expect(floorMs + tickP50Ms).toBeLessThan(refreshPeriodMs)

    const calibration = calibrateFramePacingWork(
      refreshPeriodMs,
      tickP50Ms,
      marginMs,
      floorMs
    )
    expect(calibration.workMs + tickP50Ms).toBeGreaterThanOrEqual(
      refreshPeriodMs + marginMs
    )
  })

  it("retains the workload floor when the measured tick is already slow", () => {
    const calibration = calibrateFramePacingWork(1_000 / 60, 12, 5, 12)
    expect(calibration.workMs).toBe(12)
  })

  it("judges the timer control against display-link or refresh instead of an absolute rate", () => {
    expect(isTimerPacingDegraded(60.1, 60, 60, 15, 0.75)).toBe(false)
    expect(isTimerPacingDegraded(40, 56, 60, 15, 0.75)).toBe(true)
    expect(isTimerPacingDegraded(45, 55, 60, 15, 0.75)).toBe(true)
  })

  it("accepts degraded display-link pacing while rejecting stalls and timer regressions", () => {
    expect(isDisplayLinkProgressing(30, 26.1, 60, 0.5)).toBe(true)
    expect(isDisplayLinkProgressing(0, 26.1, 60, 0.5)).toBe(false)
    expect(isDisplayLinkProgressing(30, 31, 60, 0.5)).toBe(false)
  })
})
