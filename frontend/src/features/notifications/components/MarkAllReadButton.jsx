// p3portal.org
// PROJ-65: "Alle als gelesen markieren" Button pro Tab
import { useTranslation } from 'react-i18next'
import { useMarkNotificationsRead } from '../hooks'

export default function MarkAllReadButton({ source, items }) {
  const { t } = useTranslation()
  const { mutate, isPending } = useMarkNotificationsRead()

  const unreadIds = (items ?? []).filter(i => !i.read).map(i => i.source_id)
  const disabled = unreadIds.length === 0 || isPending

  const handleClick = () => {
    if (disabled) return
    mutate({ source, sourceIds: unreadIds })
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className="btn-secondary text-xs py-1 px-2.5 disabled:opacity-40"
    >
      {isPending ? t('common.loading') : t('notifications.mark_all_read')}
    </button>
  )
}
