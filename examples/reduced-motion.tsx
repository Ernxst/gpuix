import React, { useState } from 'react'
import { motion, render } from '@gpuix/react'

export function ReducedMotionTarget({ expanded }: { expanded: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <div
        data-testid="style-transition-target"
        style={{
          width: expanded ? 280 : 140,
          height: 72,
          opacity: expanded ? 1 : 0.35,
          backgroundColor: '#89b4fa',
          borderRadius: 16,
          transition: {
            properties: ['width', 'opacity'],
            durationMs: 200,
            easing: 'linear',
          },
        }}
      />
      <motion.div
        data-testid="motion-target"
        initial={false}
        animate={{
          width: expanded ? 280 : 140,
          opacity: expanded ? 1 : 0.35,
        }}
        transition={{ duration: 0.2, ease: 'linear' }}
        style={{
          height: 72,
          backgroundColor: '#a6e3a1',
          borderRadius: 16,
        }}
      />
    </div>
  )
}

export function ReducedMotionExample() {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        width: '100%',
        height: '100%',
        backgroundColor: '#11111b',
      }}
    >
      <text style={{ color: '#cdd6f4', fontSize: 24, fontWeight: 700 }}>
        macOS Reduce Motion
      </text>
      <ReducedMotionTarget expanded={expanded} />
      <div
        data-testid="style-transition-toggle"
        onClick={() => setExpanded((value) => !value)}
        style={{
          paddingTop: 12,
          paddingBottom: 12,
          paddingLeft: 20,
          paddingRight: 20,
          backgroundColor: '#313244',
          borderRadius: 10,
          cursor: 'pointer',
          hover: { backgroundColor: '#45475a' },
        }}
      >
        <text style={{ color: '#f5f5f7', fontSize: 15 }}>
          Toggle both animation engines
        </text>
      </div>
    </div>
  )
}

const isEntryPoint =
  typeof Bun !== 'undefined'
    ? Bun.isStandaloneExecutable || Bun.main === import.meta.path
    : typeof process !== 'undefined' && process.argv[1]?.endsWith('reduced-motion.tsx')

if (isEntryPoint) {
  render(<ReducedMotionExample />, {
    title: 'GPUIX Reduce Motion',
    width: 640,
    height: 440,
  })
}
