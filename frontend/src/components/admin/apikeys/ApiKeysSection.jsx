// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ExternalApiLogTable from './ExternalApiLogTable'

export default function ApiKeysSection() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('docs')

  const SUB_TABS = [
    { id: 'docs',  label: 'API-Richtlinie' },
    { id: 'audit', label: t('admin.apikeys.tab_audit') },
  ]

  const tabCls = (tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? 'border-[var(--accent)] text-portal-text'
        : 'border-transparent text-portal-text/60 hover:text-portal-text'
    }`

  return (
    <>
      <div className="flex border-b border-portal-border mb-4">
        {SUB_TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={tabCls(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'docs' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-portal-text">{t('admin.apikeys.title')}</h2>
            <p className="text-xs text-portal-text/60 mt-0.5">
              {t('admin.apikeys.description')}
            </p>
          </div>

          {/* Authentifizierungsschema */}
          <div className="bg-portal-bg border border-portal-border rounded-lg p-4 space-y-3">
            <h3 className="text-xs font-semibold text-portal-text uppercase tracking-wider">Authentifizierung (PROJ-44)</h3>
            <p className="text-xs text-portal-text/70">
              Nutzer erstellen persönliche API-Keys (<code className="font-mono">upk_…</code>) im eigenen Profil.
              Externe Tools authentifizieren sich mit dem <code className="font-mono">Bearer</code>-Header:
            </p>
            <pre className="text-xs font-mono bg-portal-bg/80 border border-portal-border rounded p-3 text-portal-text overflow-x-auto">
              {`Authorization: Bearer upk_<key>\n\ncurl -H "Authorization: Bearer upk_<key>" ${window.location.origin}/api/cluster`}
            </pre>
            <div className="text-xs text-portal-text/60 bg-portal-warn/10 border border-portal-warn/30 rounded px-3 py-2">
              <strong className="text-portal-warn">Hinweis:</strong> API-Keys erben die Berechtigungen des Besitzers.
              Pool-/VM-/Node-/Playbook-Beschränkungen gelten weiterhin.
              Scope-Prüfung ist Vor-Filter, RBAC bleibt Endschranke.
            </div>
          </div>

          {/* Rate-Limit */}
          <div className="bg-portal-bg border border-portal-border rounded-lg p-4 space-y-2">
            <h3 className="text-xs font-semibold text-portal-text uppercase tracking-wider">Rate-Limit</h3>
            <p className="text-xs text-portal-text/70">
              Jeder <code className="font-mono">upk_</code>-Key ist auf <strong>600 Requests/Minute</strong> begrenzt
              (konfigurierbar via <code className="font-mono">UPK_RATE_LIMIT_PER_MIN</code>).
              Bei Überschreitung: HTTP 429 mit <code className="font-mono">Retry-After</code>-Header.
            </p>
          </div>

          {/* callback_url */}
          <div className="bg-portal-bg border border-portal-border rounded-lg p-4 space-y-2">
            <h3 className="text-xs font-semibold text-portal-text uppercase tracking-wider">Webhook (callback_url)</h3>
            <p className="text-xs text-portal-text/70">
              Bei <code className="font-mono">POST /api/jobs</code> und <code className="font-mono">POST /api/packer/builds</code> kann
              ein optionales Feld <code className="font-mono">callback_url</code> mitgegeben werden.
              Nach Job-Ende wird die URL mit einem POST aufgerufen:
            </p>
            <pre className="text-xs font-mono bg-portal-bg/80 border border-portal-border rounded p-3 text-portal-text overflow-x-auto">
{`POST /api/jobs
{
  "playbook": "vm-deploy",
  "params": { "vm_name": "test01" },
  "callback_url": "https://your-tool.example.com/webhook"
}`}
            </pre>
            <p className="text-xs text-portal-text/60">
              Payload: <code className="font-mono">&#123;job_id, status, exit_code, finished_at&#125;</code>.
              3 Retry-Versuche (10s/30s/60s Backoff).
            </p>
          </div>

          {/* Approval-Workflow */}
          <div className="bg-portal-bg border border-portal-border rounded-lg p-4 space-y-2">
            <h3 className="text-xs font-semibold text-portal-text uppercase tracking-wider">Approval-Workflow</h3>
            <p className="text-xs text-portal-text/70">
              Wenn ein Endpoint approval-pflichtig ist, antwortet die API mit HTTP 202:
            </p>
            <pre className="text-xs font-mono bg-portal-bg/80 border border-portal-border rounded p-3 text-portal-text overflow-x-auto">
{`HTTP/1.1 202 Accepted
{
  "approval_id": "abc123",
  "poll_url": "/api/approvals/abc123",
  "status": "pending"
}`}
            </pre>
            <p className="text-xs text-portal-text/60">
              Mit Scope <code className="font-mono">approvals:read</code> kann der Status gepollt werden.
              Mit <code className="font-mono">approvals:approve</code> kann per API genehmigt/abgelehnt werden.
            </p>
          </div>

          {/* Swagger / API-Version */}
          <div className="flex items-center gap-6 text-xs text-portal-text/60">
            <span>
              Swagger-Dokumentation:{' '}
              <a href="/api/docs" target="_blank" rel="noopener" className="underline hover:text-[var(--accent)]">
                /api/docs
              </a>
            </span>
            <span>
              API-Version:{' '}
              <a href="/api/version" target="_blank" rel="noopener" className="underline hover:text-[var(--accent)]">
                /api/version
              </a>
            </span>
            <span>
              Scope-Manifest:{' '}
              <a href="/api/scopes/manifest" target="_blank" rel="noopener" className="underline hover:text-[var(--accent)]">
                /api/scopes/manifest
              </a>
            </span>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <>
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-portal-text">{t('admin.apikeys.audit_title')}</h2>
            <p className="text-xs text-portal-text/60 mt-0.5">
              {t('admin.apikeys.audit_description')}
            </p>
          </div>
          <ExternalApiLogTable />
        </>
      )}
    </>
  )
}
