export interface FramePacingCalibration {
  refreshPeriodMs: number
  tickP50Ms: number
  marginMs: number
  floorMs: number
  workMs: number
}

export function calibrateFramePacingWork(
  refreshPeriodMs: number,
  tickP50Ms: number,
  marginMs: number,
  floorMs: number
): FramePacingCalibration {
  return {
    refreshPeriodMs,
    tickP50Ms,
    marginMs,
    floorMs,
    workMs: Math.max(refreshPeriodMs - tickP50Ms + marginMs, floorMs),
  }
}

export function isTimerPacingDegraded(
  timerHz: number,
  displayLinkHz: number,
  refreshHz: number,
  minimumImprovementHz: number,
  maximumRefreshRatio: number
): boolean {
  return (
    displayLinkHz - timerHz >= minimumImprovementHz ||
    timerHz <= refreshHz * maximumRefreshRatio
  )
}
