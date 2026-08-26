export interface FramePacingCalibration {
  refreshPeriodMs: number
  tickP50Ms: number
  deadlineMarginMs: number
  targetWorkMs: number
  workMs: number
}

export function calibrateFramePacingWork(
  refreshPeriodMs: number,
  tickP50Ms: number,
  deadlineMarginMs: number,
  targetWorkMs: number
): FramePacingCalibration {
  return {
    refreshPeriodMs,
    tickP50Ms,
    deadlineMarginMs,
    targetWorkMs,
    workMs: Math.min(
      targetWorkMs,
      Math.max(0, refreshPeriodMs - tickP50Ms - deadlineMarginMs)
    ),
  }
}

export function meetsRefreshRatio(
  observedHz: number,
  refreshHz: number,
  minimumRefreshRatio: number
): boolean {
  return observedHz >= refreshHz * minimumRefreshRatio
}

export function isPacingProgressing(
  presents: number,
  ticks: number,
  observedHz: number
): boolean {
  return presents >= 2 && ticks > 0 && observedHz > 0
}

export function isPumpCadenceBounded(
  tickP95Ms: number,
  refreshPeriodMs: number
): boolean {
  return tickP95Ms > 0 && tickP95Ms < refreshPeriodMs
}
