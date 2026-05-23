// p3portal.org
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useSetupStatus } from '../hooks/useSetupStatus'
import { useAuth } from '../hooks/useAuth'
import WizardProgressBar from '../components/setup/WizardProgressBar'
import WizardLanguageDropdown from '../components/setup/WizardLanguageDropdown'
import WizardStep1License from '../components/setup/WizardStep1License'
import WizardStep2Database from '../components/setup/WizardStep2Database'
import WizardStep3Admin from '../components/setup/WizardStep3Admin'
import WizardStep4Node from '../components/setup/WizardStep4Node'
import WizardStep5Tokens from '../components/setup/WizardStep5Tokens'
import WizardStep6Packer from '../components/setup/WizardStep6Packer'
import WizardStep7Complete from '../components/setup/WizardStep7Complete'
import i18n from '../i18n'

export default function SetupPage() {
  const { t } = useTranslation()
  const [step, setStep] = useState(1)
  const [data, setData] = useState({})
  const { setSetupRequired } = useSetupStatus()
  const { updateToken } = useAuth()
  const navigate = useNavigate()

  // Default to English for new setups (no stored language preference)
  useEffect(() => {
    if (!localStorage.getItem('p3-lang')) {
      i18n.changeLanguage('en')
    }
  }, [])

  const merge = (partial) => setData((prev) => ({ ...prev, ...partial }))

  const handleComplete = (result) => {
    setSetupRequired(false)
    if (result?.access_token) {
      updateToken(result.access_token)
      navigate('/dashboard')
    } else {
      navigate('/login')
    }
  }

  const steps = {
    1: (
      <WizardStep1License
        onNext={() => setStep(2)}
      />
    ),
    2: (
      <WizardStep2Database
        initial={{ db_type: data.db_type, host: data.db_host, port: data.db_port, database: data.db_database, username: data.db_username }}
        onNext={(d) => { merge(d); setStep(3) }}
      />
    ),
    3: (
      <WizardStep3Admin
        initial={{ username: data.username }}
        onNext={(d) => { merge(d); setStep(4) }}
        onBack={() => setStep(2)}
      />
    ),
    4: (
      <WizardStep4Node
        initial={{
          name: data.node_name,
          url: data.node_url,
          proxmox_node: data.node_proxmox_node,
          verify_ssl: data.node_verify_ssl,
        }}
        onNext={(d) => {
          merge({
            node_name: d.name,
            node_url: d.url,
            node_proxmox_node: d.proxmox_node,
            node_verify_ssl: d.verify_ssl,
          })
          setStep(5)
        }}
        onBack={() => setStep(3)}
      />
    ),
    5: (
      <WizardStep5Tokens
        initial={data}
        nodeUrl={data.node_url}
        nodeVerifySsl={data.node_verify_ssl}
        onNext={(d) => { merge(d); setStep(6) }}
        onBack={() => setStep(4)}
      />
    ),
    6: (
      <WizardStep6Packer
        initial={{ packer_token_id: data.packer_token_id, packer_http_ip: data.packer_http_ip }}
        onNext={(d) => { merge(d); setStep(7) }}
        onBack={() => setStep(5)}
      />
    ),
    7: (
      <WizardStep7Complete
        data={data}
        onBack={() => setStep(6)}
        onComplete={handleComplete}
      />
    ),
  }

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header mit Sprachauswahl */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">P3 Portal</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{t('setup.subtitle')}</p>
          </div>
          <WizardLanguageDropdown />
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 p-8">
          <WizardProgressBar current={step} />
          {steps[step]}
        </div>

        <p className="text-center text-xs text-zinc-400 mt-4">p3portal.org</p>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
