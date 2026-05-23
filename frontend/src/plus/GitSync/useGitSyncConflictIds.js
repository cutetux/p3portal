// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchConflicts } from './api'

/**
 * Gibt ein Set offener Konflikt-item_ids für den angegebenen repo_type zurück.
 * Nur aktiv wenn enabled=true (z.B. nur für Admin-Nutzer aufrufen).
 * Bei Fehler (403, Netz) wird ein leeres Set zurückgegeben.
 */
export function useGitSyncConflictIds(repoType, enabled = true) {
  const { data } = useQuery({
    queryKey: ['git-sync-conflicts'],
    queryFn: fetchConflicts,
    enabled,
    staleTime: 60_000,
    retry: false,
  })
  return useMemo(() => {
    if (!data) return new Set()
    return new Set(
      data
        .filter(c => c.repo_type === repoType && !c.resolved_at)
        .map(c => c.item_id)
    )
  }, [data, repoType])
}
