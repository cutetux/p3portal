// p3portal.org
// PROJ-103 (PVE-9-Pivot): HA-Regel anlegen / bearbeiten.
//   * node-affinity  – ersetzt die alten Gruppen: Node-Reihen (Name + optionale
//     Priorität) + strict + betroffene Ressourcen.
//   * resource-affinity – hält Ressourcen zusammen (positive) oder getrennt
//     (negative); ≥2 Ressourcen.
// Der Regeltyp ist unveränderlich (auf Bearbeiten fest). Ressourcen werden als
// Mehrfachauswahl aus den vorhandenen HA-Ressourcen angeboten. Config-CRUD synchron.
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createHaRule, updateHaRule, listHaResources } from '../../api/ha'
import { getNodes } from '../../api/cluster'
import { haErrMsg } from './haHelpers'
import { modalInputCls } from '../vms/disks/diskHelpers'

const TYPES = ['node-affinity', 'resource-affinity']

export default function HaRuleFormModal({ rule, portalNodeId = null, onClose, onSuccess }) {
  const { t } = useTranslation()
  const isEdit = Boolean(rule)
  const [name, setName] = useState(rule?.id ?? '')
  const [type, setType] = useState(rule?.type ?? 'node-affinity')
  const [selected, setSelected] = useState(new Set(rule?.resources ?? []))
  const [rows, setRows] = useState(
    rule?.nodes?.length
      ? rule.nodes.map((n) => ({ node: n.node, priority: n.priority ?? '' }))
      : [{ node: '', priority: '' }],
  )
  const [strict, setStrict] = useState(Boolean(rule?.strict))
  const [affinity, setAffinity] = useState(rule?.affinity ?? 'negative')
  const [comment, setComment] = useState(rule?.comment ?? '')
  const [disable, setDisable] = useState(Boolean(rule?.disable))
  const [nodeNames, setNodeNames] = useState([])
  const [resourceSids, setResourceSids] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getNodes()
      .then((list) => {
        const names = (Array.isArray(list) ? list : [])
          .filter((n) => portalNodeId == null || n.portal_node_id === portalNodeId)
          .map((n) => n.node)
          .filter(Boolean)
        setNodeNames([...new Set(names)])
      })
      .catch(() => setNodeNames([]))
    listHaResources(portalNodeId)
      .then((d) => setResourceSids((d?.items ?? []).map((r) => r.sid).filter(Boolean)))
      .catch(() => setResourceSids([]))
  }, [portalNodeId])

  const setRow = (i, key, val) => {
    setError('')
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)))
  }
  const addRow = () => setRows((rs) => [...rs, { node: '', priority: '' }])
  const removeRow = (i) => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))

  const toggleResource = (sid) => {
    setError('')
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(sid)) next.delete(sid); else next.add(sid)
      return next
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    const resources = [...selected]
    let payload
    if (type === 'node-affinity') {
      const nodes = rows
        .map((r) => ({ node: r.node.trim(), priority: r.priority === '' ? null : Number(r.priority) }))
        .filter((r) => r.node)
      if (nodes.length === 0) { setError(t('ha.rule.err_no_nodes')); return }
      const seen = new Set()
      for (const n of nodes) {
        if (seen.has(n.node)) { setError(t('ha.rule.err_dup_node', { node: n.node })); return }
        seen.add(n.node)
      }
      if (resources.length === 0) { setError(t('ha.rule.err_no_resources')); return }
      payload = { rule: name.trim(), type, resources, nodes, strict, disable }
    } else {
      if (resources.length < 2) { setError(t('ha.rule.err_min_two_resources')); return }
      payload = { rule: name.trim(), type, resources, affinity, disable }
    }
    if (comment.trim()) payload.comment = comment.trim()

    setBusy(true)
    setError('')
    try {
      if (isEdit) await updateHaRule(rule.id, payload, portalNodeId)
      else await createHaRule(payload, portalNodeId)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(haErrMsg(err, t))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-lg flex flex-col rounded-lg max-h-[88vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {isEdit ? t('ha.rule.edit_title', { name: rule.id }) : t('ha.rule.create_title')}
          </h2>
          <button onClick={onClose} aria-label={t('ha.close')} className="btn-ghost">✕</button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4 overflow-y-auto">
          {error && <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</p>}

          <datalist id="ha-node-options">
            {nodeNames.map((n) => <option key={n} value={n} />)}
          </datalist>

          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="ha-rule-name" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.rule.name_label')}</label>
              <input id="ha-rule-name" type="text" value={name} disabled={isEdit}
                onChange={(e) => { setError(''); setName(e.target.value) }}
                placeholder={t('ha.rule.name_ph')} className={`${modalInputCls} font-mono disabled:opacity-60`} />
            </div>
            <div className="w-48">
              <label htmlFor="ha-rule-type" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.rule.type_label')}</label>
              <select id="ha-rule-type" value={type} disabled={isEdit}
                onChange={(e) => { setError(''); setType(e.target.value) }}
                className={`${modalInputCls} disabled:opacity-60`}>
                {TYPES.map((ty) => <option key={ty} value={ty}>{t(`ha.rule.type_${ty.replace('-', '_')}`)}</option>)}
              </select>
            </div>
          </div>
          {isEdit && <p className="-mt-2 text-xs text-gray-400 dark:text-zinc-600">{t('ha.rule.immutable_hint')}</p>}

          {/* Ressourcen-Mehrfachauswahl (beide Typen) */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">
              {type === 'resource-affinity' ? t('ha.rule.resources_label_two') : t('ha.rule.resources_label')}
            </label>
            {resourceSids.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-zinc-600">{t('ha.rule.no_resources')}</p>
            ) : (
              <div className="max-h-32 overflow-y-auto rounded border border-gray-200 dark:border-zinc-700 divide-y divide-gray-100 dark:divide-zinc-800">
                {resourceSids.map((sid) => (
                  <label key={sid} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={selected.has(sid)} onChange={() => toggleResource(sid)} />
                    <span className="font-mono">{sid}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {type === 'node-affinity' ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-gray-500 dark:text-zinc-500">{t('ha.rule.nodes_label')}</label>
                  <button type="button" onClick={addRow} className="btn-table">{t('ha.rule.add_node')}</button>
                </div>
                <div className="space-y-2">
                  {rows.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="text" list="ha-node-options" value={r.node}
                        onChange={(e) => setRow(i, 'node', e.target.value)}
                        placeholder={t('ha.rule.node_ph')} className={`${modalInputCls} flex-1 font-mono`} />
                      <input type="number" min="0" max="1000" value={r.priority}
                        onChange={(e) => setRow(i, 'priority', e.target.value)}
                        placeholder={t('ha.rule.prio_ph')} className={`${modalInputCls} w-24`} />
                      <button type="button" onClick={() => removeRow(i)} disabled={rows.length <= 1}
                        className="btn-table-danger" title={t('ha.rule.remove_node')}>✕</button>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">{t('ha.rule.prio_hint')}</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-zinc-300">
                <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
                {t('ha.rule.strict_label')}
              </label>
            </>
          ) : (
            <div>
              <label className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.rule.affinity_label')}</label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-zinc-300">
                  <input type="radio" name="ha-affinity" value="positive" checked={affinity === 'positive'} onChange={() => setAffinity('positive')} />
                  {t('ha.rule.affinity_positive')}
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-zinc-300">
                  <input type="radio" name="ha-affinity" value="negative" checked={affinity === 'negative'} onChange={() => setAffinity('negative')} />
                  {t('ha.rule.affinity_negative')}
                </label>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-zinc-300">
            <input type="checkbox" checked={disable} onChange={(e) => setDisable(e.target.checked)} />
            {t('ha.rule.disable_label')}
          </label>

          <div>
            <label htmlFor="ha-rule-comment" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.rule.comment_label')}</label>
            <input id="ha-rule-comment" type="text" value={comment}
              onChange={(e) => setComment(e.target.value)} className={modalInputCls} />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">{t('ha.cancel')}</button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? t('ha.saving') : isEdit ? t('ha.save') : t('ha.create')}
            </button>
          </div>
        </form>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
