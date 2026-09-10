/**
 * Regression guard for #440: `gpui_windows` moved a `show: true` window's
 * first show into `finish_open`, after `a11y_init` creates the AccessKit
 * adapter, because AccessKit's `Adapter::new` must initialize UI Automation
 * before the window first handles `WM_GETOBJECT` (accesskit_windows 0.33.1
 * docs; AccessKit issue #37) — showing the window is what makes assistive
 * technology ask.
 *
 * This asserts both ends of that fix: the native record confirms the adapter
 * existed while the window was still hidden, and a separate-process UI
 * Automation query — the same vantage point a screen reader has — confirms
 * the resulting tree actually reaches assistive technology by name and
 * control type.
 */

import React from 'react'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRenderer, createRoot, flushSync } from '@gpuix/react'
import { isNativeTestRendererAvailable } from '@gpuix/react/testing'
import { testAccessibilityInitializedWhileVisible } from '@gpuix/native'
import { describe, expect, it, vi } from 'vitest'

const execFileAsync = promisify(execFile)

const TITLE = 'GPUIX Windows accessibility order'

// Opens a real, visible window and queries a real assistive-technology API,
// so this only runs on Windows, and only in CI or when explicitly opted in.
const describeLive =
  process.platform === 'win32' &&
  (Boolean(process.env.CI) || process.env.GPUIX_WINDOWS_ACCESSIBILITY_TEST === '1') &&
  isNativeTestRendererAvailable()
    ? describe
    : describe.skip

const controlStyle = {
  padding: 10,
  backgroundColor: '#313244',
  borderRadius: 6,
  color: '#cdd6f4',
} as const

function Tree(): React.JSX.Element {
  return (
    <main>
      <h1 role="heading" ariaLabel="GPUIX accessibility smoke" ariaLevel={1}>
        <text style={{ fontSize: 24, fontWeight: 'bold' }}>GPUIX accessibility smoke</text>
      </h1>

      <button role="button" ariaLabel="Save factory" tabIndex={0} style={controlStyle}>
        <text>Save factory</text>
      </button>

      <div
        role="checkbox"
        ariaLabel="Include byproducts"
        ariaChecked={false}
        tabIndex={0}
        style={controlStyle}
      >
        <text>Include byproducts</text>
      </div>
    </main>
  )
}

const UIA_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$automation = [System.Windows.Automation.AutomationElement]
$byTitle = New-Object System.Windows.Automation.PropertyCondition($automation::NameProperty, $env:GPUIX_UIA_TITLE)
$deadline = (Get-Date).AddSeconds(15)
$lines = @()
do {
  $window = $automation::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $byTitle)
  if ($window) {
    $lines = @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { "$($_.Current.ControlType.ProgrammaticName)\`t$($_.Current.Name)" })
    if (@($lines | Where-Object { $_ -like "*\`tSave factory" }).Count -gt 0) { break }
  }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
$lines | ForEach-Object { Write-Output $_ }
`

interface UiaElement {
  controlType: string
  name: string
}

async function queryUiaElements(): Promise<UiaElement[]> {
  const encodedCommand = Buffer.from(UIA_SCRIPT, 'utf16le').toString('base64')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
    { env: { ...process.env, GPUIX_UIA_TITLE: TITLE }, timeout: 30_000 },
  )

  return stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const tabIndex = line.indexOf('\t')
      return { controlType: line.slice(0, tabIndex), name: line.slice(tabIndex + 1) }
    })
}

describeLive('Windows accessibility adapter order', () => {
  it(
    'creates the AccessKit adapter before the first show, and exposes the tree to UI Automation',
    async () => {
      const renderer = createRenderer()
      renderer.init({ title: TITLE, width: 420, height: 320, menus: [], focus: false })

      expect(testAccessibilityInitializedWhileVisible()).toBe(false)

      const root = createRoot(renderer)
      flushSync(() => root.render(<Tree />))

      try {
        const elements = await queryUiaElements()
        const describeElements = (): string =>
          elements.map((element) => `${element.controlType}\t${element.name}`).join('\n')

        expect(
          elements.some((element) => element.name === 'GPUIX accessibility smoke'),
          `Expected a heading named "GPUIX accessibility smoke" among:\n${describeElements()}`,
        ).toBe(true)

        expect(
          elements.some(
            (element) => element.controlType === 'ControlType.Button' && element.name === 'Save factory',
          ),
          `Expected a ControlType.Button named "Save factory" among:\n${describeElements()}`,
        ).toBe(true)

        expect(
          elements.some(
            (element) =>
              element.controlType === 'ControlType.CheckBox' && element.name === 'Include byproducts',
          ),
          `Expected a ControlType.CheckBox named "Include byproducts" among:\n${describeElements()}`,
        ).toBe(true)
      } finally {
        root.unmount()
        renderer.quit()
      }

      // The threaded renderer finishes terminating on its UI thread after
      // quit() returns, so the lifecycle flips to terminated asynchronously.
      await vi.waitFor(() => {
        expect(renderer.isInitialized()).toBe(false)
      })
    },
    60_000,
  )
})
