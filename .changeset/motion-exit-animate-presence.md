---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add **exit** animations for `motion.div` through an `AnimatePresence` API shaped like Motion for React.

```tsx
import { AnimatePresence, motion } from '@gpuix/react'

function Toast({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="toast"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <text>Saved</text>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
```

React keeps the leaving node mounted. Native motion tweens to `exit`, then
`motionComplete` lets `AnimatePresence` unmount it. Without `AnimatePresence`,
unmount is still immediate. Give each leaving child a unique `key`.

Completion stays tied to the target that started it, including no-op targets,
and offscreen virtual-list rows finish without being painted. A partial exit
target also keeps animated properties it does not replace.
