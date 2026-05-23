// p3portal.org
import { useState } from 'react'
import ThemesTab from './ThemesTab'
import LanguagesTab from './LanguagesTab'

export default function AppearanceSection() {
  const [globalTheme, setGlobalTheme] = useState(null)
  const [globalLang, setGlobalLang] = useState(null)

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
        <ThemesTab globalDefault={globalTheme} onDefaultChanged={setGlobalTheme} />
      </div>
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
        <LanguagesTab globalDefault={globalLang} onDefaultChanged={setGlobalLang} />
      </div>
    </div>
  )
}
