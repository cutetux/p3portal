// p3portal.org
// PROJ-57: React-Context für den globalen Help-SlideOver-Zustand.
// Nur ein Slide-Over kann gleichzeitig offen sein (AC-UI-7).
import { createContext, useCallback, useContext, useRef, useState } from 'react'

const HelpSlideOverContext = createContext(null)

export function HelpSlideOverProvider({ children }) {
  const [currentKey, setCurrentKey]   = useState(null)   // aktell angezeigter Key
  const [historyStack, setHistoryStack] = useState([])   // Back-Stack (nur Keys)
  const [isOpen, setIsOpen]           = useState(false)

  const open = useCallback((key) => {
    setHistoryStack([])
    setCurrentKey(key)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setHistoryStack([])
    setCurrentKey(null)
  }, [])

  const pushHistory = useCallback((newKey) => {
    setHistoryStack(prev => [...prev, currentKey])
    setCurrentKey(newKey)
  }, [currentKey])

  const popHistory = useCallback(() => {
    setHistoryStack(prev => {
      if (prev.length === 0) return prev
      const next = [...prev]
      const prevKey = next.pop()
      setCurrentKey(prevKey)
      return next
    })
  }, [])

  const canGoBack = historyStack.length > 0

  // Ref für externe Nutzung (z.B. im Slide-Over selbst)
  const contextRef = useRef({ open, close, pushHistory, popHistory })
  contextRef.current = { open, close, pushHistory, popHistory }

  return (
    <HelpSlideOverContext.Provider value={{ currentKey, historyStack, isOpen, open, close, pushHistory, popHistory, canGoBack }}>
      {children}
    </HelpSlideOverContext.Provider>
  )
}

const NO_OP_CTX = {
  open: () => {}, close: () => {}, pushHistory: () => {}, popHistory: () => {},
  canGoBack: false, isOpen: false, currentKey: null, historyStack: [],
}

export function useHelpSlideOver() {
  const ctx = useContext(HelpSlideOverContext)
  return ctx ?? NO_OP_CTX
}
