// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-46: Modal zum Anlegen / Bearbeiten eines Pools (AC-1, AC-5, AC-8, AC-9).
// Layout-Standard: form-Wrapper, max-w-3xl, Labels mit *, Sektionen, Sticky-Footer.
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { poolsApi } from '../api'
import { useTagsPool } from '../hooks/usePools'
import { formatApiError } from '../../../api/errors'
import ModalHelpButton from '../../../features/help/components/ModalHelpButton'

function QuotaField({ label, value, onChange, hint }) {
  const { t } = useTranslation()
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
        {label}
        <span className="ml-1 text-gray-400 dark:text-zinc-500 font-normal">{t('pools.quota_hint')}</span>
      </label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
        className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
      />
      {hint && <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">{hint}</p>}
    </div>
  )
}

export default function PoolFormModal({ pool, users, groups, onSuccess, onClose }) {
  const { t } = useTranslation()
  const isEdit = Boolean(pool)

  const [name, setName]               = useState(pool?.name ?? '')
  const [description, setDescription] = useState(pool?.description ?? '')
  const [tags, setTags]               = useState(pool?.tags ?? [])
  const [tagInput, setTagInput]       = useState('')
  const [ownerType, setOwnerType]     = useState(pool?.owner_subject_type ?? '')
  const [ownerId, setOwnerId]         = useState(pool?.owner_subject_id ?? '')
  const [clearOwner, setClearOwner]   = useState(false)
  const [cpuQuota, setCpuQuota]       = useState(pool?.cpu_quota ?? 0)
  const [ramQuota, setRamQuota]       = useState(pool?.ram_quota_mb ?? 0)
  const [diskQuota, setDiskQuota]     = useState(pool?.disk_quota_gb ?? 0)
  const [vmCountQuota, setVmCountQuota] = useState(pool?.vm_count_quota ?? 0)
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState('')

  const tagSuggestions = useTagsPool()
  const tagInputRef    = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const addTag = (raw) => {
    const tag = raw.trim()
    if (!tag || tag.length > 32) return
    if (tags.includes(tag)) { setTagInput(''); return }
    if (tags.length >= 10) { setTagInput(''); return }
    setTags(prev => [...prev, tag])
    setTagInput('')
  }

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      setTags(prev => prev.slice(0, -1))
    }
  }

  const removeTag = (idx) => setTags(prev => prev.filter((_, i) => i !== idx))

  const ownerOptions = ownerType === 'user'
    ? (users ?? []).filter(u => u.auth_type === 'local' || !u.auth_type)
    : ownerType === 'group'
    ? (groups ?? [])
    : []

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const payload = {
        name,
        description: description || null,
        tags,
        cpu_quota: cpuQuota,
        ram_quota_mb: ramQuota,
        disk_quota_gb: diskQuota,
        vm_count_quota: vmCountQuota,
      }
      if (clearOwner) {
        Object.assign(payload, { clear_owner: true })
      } else if (ownerType && ownerId !== '') {
        payload.owner_subject_type = ownerType
        payload.owner_subject_id   = Number(ownerId)
      }

      if (isEdit) {
        await poolsApi.update(pool.id, payload)
      } else {
        await poolsApi.create(payload)
      }
      onSuccess()
    } catch (err) {
      setError(formatApiError(err, t('pools.save_error')))
    } finally {
      setBusy(false)
    }
  }

  const filteredSuggestions = tagSuggestions.filter(
    s => s.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(s)
  ).slice(0, 6)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {isEdit ? t('pools.modal_edit', { name: pool.name }) : t('pools.modal_create')}
          </h2>
          <div className="flex items-center gap-1">
            <ModalHelpButton helpKey="modal.pool_form" />
            <button type="button" onClick={onClose} className="btn-ghost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Section: Pool-Eigenschaften */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              {t('pools.section_properties')}
            </h3>
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                  {t('pools.field_name')} <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={64}
                  placeholder={t('pools.field_name_placeholder')}
                  className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                  {t('pools.field_description')}
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  placeholder={t('pools.field_description_placeholder')}
                  className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                />
              </div>

              {/* Tags */}
              <div className="relative">
                <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                  {t('pools.field_tags')}
                  <span className="ml-1 text-gray-400 dark:text-zinc-500 font-normal">{t('groups.field_tags_hint')}</span>
                </label>
                <div
                  onClick={() => tagInputRef.current?.focus()}
                  className="flex flex-wrap gap-1.5 min-h-[2.25rem] px-2 py-1.5 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 cursor-text"
                >
                  {tags.map((tag, idx) => (
                    <span key={idx} className="flex items-center gap-1 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full">
                      {tag}
                      <button type="button" onClick={() => removeTag(idx)} className="text-orange-400 hover:text-orange-600 leading-none">×</button>
                    </span>
                  ))}
                  <input
                    ref={tagInputRef}
                    type="text"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={() => { if (tagInput) addTag(tagInput) }}
                    placeholder={tags.length === 0 ? t('pools.field_tags_placeholder') : ''}
                    disabled={tags.length >= 10}
                    className="flex-1 min-w-[8rem] text-sm bg-transparent outline-none text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500"
                  />
                </div>
                {tagInput && filteredSuggestions.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-md shadow-lg text-sm overflow-hidden">
                    {filteredSuggestions.map(s => (
                      <li
                        key={s}
                        onClick={() => addTag(s)}
                        className="px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-200"
                      >
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Owner */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                  {t('pools.field_owner')}
                </label>
                <div className="flex gap-2">
                  <select
                    value={clearOwner ? '' : ownerType}
                    onChange={e => { setClearOwner(false); setOwnerType(e.target.value); setOwnerId('') }}
                    className="text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400 w-36"
                  >
                    <option value="">{t('pools.owner_type_none')}</option>
                    <option value="user">{t('pools.owner_type_user')}</option>
                    <option value="group">{t('pools.owner_type_group')}</option>
                  </select>
                  {ownerType !== '' && !clearOwner && (
                    <select
                      value={ownerId}
                      onChange={e => setOwnerId(e.target.value)}
                      className="flex-1 text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
                    >
                      <option value="">{t('pools.field_owner_none')}</option>
                      {ownerOptions.map(o => (
                        <option key={o.id} value={o.id}>{o.username ?? o.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                {isEdit && pool?.owner_subject_id && (
                  <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={clearOwner}
                      onChange={e => { setClearOwner(e.target.checked); if (e.target.checked) { setOwnerType(''); setOwnerId('') } }}
                      className="rounded border-gray-300 dark:border-zinc-600 text-orange-500 focus:ring-orange-400"
                    />
                    <span className="text-xs text-gray-500 dark:text-zinc-400">{t('pools.field_owner_clear')}</span>
                  </label>
                )}
              </div>
            </div>
          </div>

          {/* Section: Quotas */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              {t('pools.section_quotas')}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <QuotaField
                label={t('pools.quota_vm_count')}
                value={vmCountQuota}
                onChange={setVmCountQuota}
              />
              <QuotaField
                label={t('pools.quota_cpu')}
                value={cpuQuota}
                onChange={setCpuQuota}
              />
              <QuotaField
                label={t('pools.quota_ram_mb')}
                value={ramQuota}
                onChange={setRamQuota}
                hint={t('pools.quota_ram_hint')}
              />
              <QuotaField
                label={t('pools.quota_disk_gb')}
                value={diskQuota}
                onChange={setDiskQuota}
              />
            </div>
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary"
          >
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
