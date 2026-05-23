// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-49: Admin-Seite /admin/playbook-permissions
// Default-Export: PlaybookPermissionsPage
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlaybooks } from '../../hooks/usePlaybooks'
import { usePlaybookPermissionsConfig } from './hooks'
import { playbookPermissionsApi } from './api'
import DefaultModeSwitch from './components/DefaultModeSwitch'
import PlaybooksPermissionTable from './components/PlaybooksPermissionTable'

export default function PlaybookPermissionsPage({ embedded = false }) {
  const { t } = useTranslation()
  const { playbooks, loading: pbLoading } = usePlaybooks()
  const { config, loading: cfgLoading, updateConfig } = usePlaybookPermissionsConfig()

  // Permission-Counts pro Playbook (Map: name → count), lädt still im Hintergrund
  const [permCounts, setPermCounts] = useState({})

  useEffect(() => {
    if (!playbooks.length) return
    const requests = playbooks.map(pb =>
      playbookPermissionsApi.listPermissions(pb.name)
        .then(list => ({ name: pb.name, count: list.length }))
        .catch(() => ({ name: pb.name, count: 0 }))
    )
    Promise.all(requests)
      .then(results => {
        const map = {}
        results.forEach(({ name, count }) => { map[name] = count })
        setPermCounts(map)
      })
  }, [playbooks])

  // Playbooks mit permission_count anreichern
  const enrichedPlaybooks = playbooks.map(pb => ({
    ...pb,
    permission_count: permCounts[pb.name] ?? 0,
  }))

  const loading = pbLoading || cfgLoading

  return (
    <div className={embedded ? 'space-y-6' : 'flex flex-col flex-1'}>
      {!embedded && (
        <header className="h-12 flex items-center px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            {t('playbook_permissions.page_title')}
          </h1>
        </header>
      )}

      <main className={embedded ? '' : 'flex-1 overflow-y-auto px-6 py-6 bg-gray-50 dark:bg-zinc-950'}>
        <div className="space-y-6 max-w-5xl">
          {/* Default-Mode-Switch */}
          {config && (
            <DefaultModeSwitch config={config} updateConfig={updateConfig} />
          )}
          {cfgLoading && (
            <div className="h-24 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded-xl" />
          )}

          {/* Playbook-Tabelle */}
          <section>
            <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              {t('playbook_permissions.table_heading')}
            </h2>
            <PlaybooksPermissionTable
              playbooks={enrichedPlaybooks}
              defaultMode={config?.default_playbook_mode ?? 'open'}
              loading={loading}
            />
          </section>
        </div>
      </main>

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
