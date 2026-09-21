import {
  Children,
  createContext,
  createElement,
  Fragment,
  isValidElement,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ReactElement, ReactNode } from "react"
import { flushSync } from "../reconciler/reconciler.js"

export type ComponentKey = string | number

export interface PresenceContextValue {
  id: string
  isPresent: boolean
  initial: false | undefined
  onExitComplete: (childId: string) => void
  register: (childId: string) => () => void
}

export const PresenceContext = createContext<PresenceContextValue | null>(null)

export type SafeToRemove = () => void

export function usePresence(): [true] | [true, null] | [false, SafeToRemove] {
  const context = useContext(PresenceContext)
  const id = useId()
  const register = context?.register
  useLayoutEffect(() => {
    if (!register) return
    return register(id)
  }, [id, register])

  const onExitComplete = context?.onExitComplete
  const safeToRemove = useCallback(() => {
    onExitComplete?.(id)
  }, [id, onExitComplete])

  if (context === null) return [true, null]
  return !context.isPresent ? [false, safeToRemove] : [true]
}

export function useIsPresent(): boolean {
  const context = useContext(PresenceContext)
  return context === null ? true : context.isPresent
}

export interface AnimatePresenceProps {
  children?: ReactNode
  /** Skip enter animations for children present on the first render. */
  initial?: boolean
  /** Fires when every exiting child has finished. */
  onExitComplete?: () => void
}

function getChildKey(child: ReactElement): ComponentKey {
  return child.key ?? ""
}

function onlyElements(children: ReactNode): ReactElement[] {
  const filtered: ReactElement[] = []
  Children.forEach(children, (child) => {
    if (isValidElement(child)) filtered.push(child)
  })
  return filtered
}

function PresenceChild({
  children,
  isPresent,
  initial,
  onExitComplete,
}: {
  children: ReactElement
  isPresent: boolean
  initial: false | undefined
  onExitComplete?: () => void
}) {
  const presenceChildren = useRef(new Map<string, boolean>()).current
  const id = useId()
  const onExitCompleteRef = useRef(onExitComplete)
  onExitCompleteRef.current = onExitComplete

  const register = useCallback((childId: string) => {
    presenceChildren.set(childId, false)
    return () => {
      presenceChildren.delete(childId)
    }
  }, [presenceChildren])

  const context = useMemo(
    (): PresenceContextValue => ({
      id,
      initial,
      isPresent,
      onExitComplete: (childId) => {
        presenceChildren.set(childId, true)
        for (const isComplete of presenceChildren.values()) {
          if (!isComplete) return
        }
        onExitCompleteRef.current?.()
      },
      register,
    }),
    [id, initial, isPresent, presenceChildren, register]
  )

  useLayoutEffect(() => {
    if (!isPresent && presenceChildren.size === 0) onExitCompleteRef.current?.()
  }, [isPresent, presenceChildren])

  return createElement(PresenceContext.Provider, { value: context }, children)
}

export function AnimatePresence({
  children,
  initial = true,
  onExitComplete,
}: AnimatePresenceProps): ReactElement {
  const presentChildren = useMemo(() => onlyElements(children), [children])
  const presentKeys = presentChildren.map(getChildKey)
  const isInitialRender = useRef(true)
  const pendingPresentChildren = useRef(presentChildren)
  const exitComplete = useRef(new Map<ComponentKey, boolean>()).current
  const [renderedChildren, setRenderedChildren] = useState(presentChildren)

  useLayoutEffect(() => {
    isInitialRender.current = false
    pendingPresentChildren.current = presentChildren
    for (const child of renderedChildren) {
      const key = getChildKey(child)
      if (!presentKeys.includes(key)) {
        if (exitComplete.get(key) !== true) exitComplete.set(key, false)
      } else {
        exitComplete.delete(key)
      }
    }
  }, [exitComplete, presentChildren, presentKeys, renderedChildren])

  const nextChildren = [...presentChildren]
  for (let i = 0; i < renderedChildren.length; i++) {
    const child = renderedChildren[i]
    const key = getChildKey(child)
    if (!presentKeys.includes(key)) nextChildren.splice(i, 0, child)
  }

  const nextKeyList = nextChildren.map(getChildKey).join("\0")
  const renderedKeyList = renderedChildren.map(getChildKey).join("\0")
  useLayoutEffect(() => {
    if (nextKeyList !== renderedKeyList) {
      setRenderedChildren(onlyElements(nextChildren))
    }
  }, [nextKeyList, renderedKeyList])

  return createElement(
    Fragment,
    null,
    ...nextChildren.map((child) => {
      const key = getChildKey(child)
      const isPresent = presentKeys.includes(key)
      const onExit = () => {
        if (exitComplete.get(key) === true) return
        exitComplete.set(key, true)
        let isEveryExitComplete = true
        exitComplete.forEach((isExitComplete) => {
          if (!isExitComplete) isEveryExitComplete = false
        })
        if (!isEveryExitComplete) return
        flushSync(() => {
          setRenderedChildren(pendingPresentChildren.current)
        })
        onExitComplete?.()
      }
      return createElement(PresenceChild, {
        key,
        isPresent,
        initial: isInitialRender.current && initial === false ? false : undefined,
        onExitComplete: isPresent ? undefined : onExit,
        children: child,
      })
    })
  )
}
