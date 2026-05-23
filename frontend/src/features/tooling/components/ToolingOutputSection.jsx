// p3portal.org
// PROJ-66: Slide-Over Body §2 — stdout/stderr letzter Check (AC-SLIDE-3)
import { useTranslation } from 'react-i18next'

export default function ToolingOutputSection({ toolData }) {
  const { t } = useTranslation()
  const stdout = toolData?.stdout ?? null
  const stderr = toolData?.stderr ?? null
  const hasOutput = stdout || stderr

  return (
    <div className="px-4 py-3 border-b border-portal-border">
      <h3 className="text-xs font-semibold text-portal-text/50 uppercase tracking-wide mb-2">
        {t('tooling.section_output')}
      </h3>
      {hasOutput ? (
        <pre className="text-xs text-portal-text bg-portal-bg-alt rounded-md p-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-all border border-portal-border font-mono">
          {stdout && stdout}
          {stderr && (
            <>
              {stdout && '\n'}
              <span className="text-portal-danger">{stderr}</span>
            </>
          )}
        </pre>
      ) : (
        <p className="text-xs text-portal-text/40 italic">{t('tooling.output_empty')}</p>
      )}
    </div>
  )
}
