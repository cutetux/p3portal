// p3portal.org
// PROJ-66: Context für den globalen ToolingSlideOver-Zustand (analog HelpSlideOverContext PROJ-57)
import { createContext, useCallback, useContext, useState } from 'react'

const ToolingSlideOverContext = createContext(null)

export function ToolingSlideOverProvider({ children }) {
  const [openTool, setOpenTool] = useState(null)

  const openSlideOver = useCallback((toolId) => {
    setOpenTool(toolId)
  }, [])

  const closeSlideOver = useCallback(() => {
    setOpenTool(null)
  }, [])

  return (
    <ToolingSlideOverContext.Provider value={{ openTool, openSlideOver, closeSlideOver }}>
      {children}
    </ToolingSlideOverContext.Provider>
  )
}

const NO_OP_CTX = { openTool: null, openSlideOver: () => {}, closeSlideOver: () => {} }

export function useToolingSlideOver() {
  const ctx = useContext(ToolingSlideOverContext)
  return ctx ?? NO_OP_CTX
}
