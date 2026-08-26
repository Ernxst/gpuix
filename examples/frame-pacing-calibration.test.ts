import { describe, expect, it } from "vitest"
import {
  calibrateFramePacingWork,
  isPacingProgressing,
  isPumpCadenceBounded,
  meetsRefreshRatio,
} from "./frame-pacing-calibration"

describe("frame pacing workload calibration", () => {
  it("keeps the target workload below the refresh deadline", () => {
    const refreshPeriodMs = 1_000 / 60
    const tickP50Ms = 2.61
    const deadlineMarginMs = 1.5
    const targetWorkMs = 12

    const calibration = calibrateFramePacingWork(
      refreshPeriodMs,
      tickP50Ms,
      deadlineMarginMs,
      targetWorkMs
    )
    expect(calibration.workMs).toBe(targetWorkMs)
    expect(calibration.workMs + tickP50Ms).toBeLessThan(refreshPeriodMs)
  })

  it("reduces the target when local pump cost would consume the deadline margin", () => {
    const refreshPeriodMs = 1_000 / 60
    const tickP50Ms = 4.1
    const deadlineMarginMs = 1.5
    const calibration = calibrateFramePacingWork(
      refreshPeriodMs,
      tickP50Ms,
      deadlineMarginMs,
      12
    )

    expect(calibration.workMs + tickP50Ms).toBeCloseTo(
      refreshPeriodMs - deadlineMarginMs
    )
  })

  it("requires display-link pacing to stay within ten percent of refresh", () => {
    expect(meetsRefreshRatio(54, 60, 0.9)).toBe(true)
    expect(meetsRefreshRatio(53.9, 60, 0.9)).toBe(false)
  })

  it("rejects stalled pacing and pumps that consume a refresh period", () => {
    expect(isPacingProgressing(60, 64, 60)).toBe(true)
    expect(isPacingProgressing(0, 64, 0)).toBe(false)
    expect(isPacingProgressing(60, 0, 60)).toBe(false)
    expect(isPumpCadenceBounded(16, 1_000 / 60)).toBe(true)
    expect(isPumpCadenceBounded(16.7, 1_000 / 60)).toBe(false)
  })
})
