/** Browser entry for the full GPUIX chat example. */

import React from 'react'
import { render } from '@gpuix/react'
import { ChatApp } from './chat'

render(
  <ChatApp includeSafeMdx />,
  {
    title: 'GPUIX Chat',
    width: 1180,
    height: 820,
    debugFrameOverlay: 'full',
  },
)
