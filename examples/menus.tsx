import React, { useEffect, useState } from 'react'
import { render, useGpuixRequired, type MenuSpec } from '@gpuix/react'

const menus: MenuSpec[] = [
  {
    name: 'GPUIX Menu Demo',
    items: [
      { kind: 'action', id: 'about', label: 'About This Demo' },
      { kind: 'separator' },
      { kind: 'system', label: 'Services', systemMenu: 'services' },
      { kind: 'separator' },
      {
        kind: 'action',
        label: 'Quit GPUIX Menu Demo',
        role: 'quit',
        keyEquivalent: 'cmd-q',
      },
    ],
  },
  {
    name: 'Actions',
    items: [
      {
        kind: 'action',
        id: 'mark',
        label: 'Fire JavaScript Action',
        keyEquivalent: 'cmd-shift-m',
      },
      {
        kind: 'submenu',
        label: 'Nested',
        items: [{ kind: 'action', id: 'nested', label: 'Nested Action' }],
      },
    ],
  },
]

let deliverMenuAction: (id: string) => void = () => {}

function MenuDemo() {
  const renderer = useGpuixRequired()
  const [lastAction, setLastAction] = useState('No menu action yet')
  const [actionCount, setActionCount] = useState(0)

  useEffect(() => {
    deliverMenuAction = (id) => {
      console.log(`[menu demo] JavaScript handled action: ${id}`)
      setLastAction(`Handled “${id}” in JavaScript`)
      setActionCount((count) => count + 1)
    }
    return () => {
      deliverMenuAction = () => {}
    }
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        width: '100%',
        height: '100%',
        padding: 40,
        backgroundColor: '#11111b',
      }}
    >
      <text style={{ color: '#f5f5f7', fontSize: 28, fontWeight: 700 }}>
        Application menu acceptance
      </text>
      <text style={{ color: '#a6adc8', fontSize: 15 }}>
        Enter fullscreen; the macOS menu bar should remain available.
      </text>
      <text style={{ color: '#a6adc8', fontSize: 15 }}>
        Choose Actions → Fire JavaScript Action, then press Cmd+Q.
      </text>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          width: 380,
          padding: 22,
          backgroundColor: '#1e1e2e',
          borderRadius: 12,
        }}
      >
        <text style={{ color: '#cdd6f4', fontSize: 18 }}>{lastAction}</text>
        <text style={{ color: '#89b4fa', fontSize: 14 }}>
          JavaScript action count: {actionCount}
        </text>
      </div>
      <div
        style={{
          paddingTop: 10,
          paddingBottom: 10,
          paddingLeft: 16,
          paddingRight: 16,
          backgroundColor: '#313244',
          borderRadius: 8,
          cursor: 'pointer',
          hover: { backgroundColor: '#45475a' },
        }}
        onClick={() => renderer.quit?.()}
      >
        <text style={{ color: '#cdd6f4', fontSize: 14 }}>Quit via renderer.quit()</text>
      </div>
    </div>
  )
}

render(<MenuDemo />, {
  title: 'GPUIX Menu Demo',
  width: 760,
  height: 520,
  menus,
  onMenuAction: ({ id }) => deliverMenuAction(id),
  onTerminated: () => {
    console.log('[menu demo] termination cleanup finished')
  },
})
