// p3portal.org
import { createContext, useContext, useState, useEffect } from 'react'
import { getSetupStatus } from '../api/setup'

const SetupStatusContext = createContext({ setupRequired: null, setSetupRequired: () => {} })

export function SetupStatusProvider({ children }) {
  const [setupRequired, setSetupRequired] = useState(null)

  useEffect(() => {
    getSetupStatus()
      .then((data) => setSetupRequired(data.setup_required))
      .catch(() => setSetupRequired(false))
  }, [])

  return (
    <SetupStatusContext.Provider value={{ setupRequired, setSetupRequired }}>
      {children}
    </SetupStatusContext.Provider>
  )
}

export function useSetupStatus() {
  return useContext(SetupStatusContext)
}
