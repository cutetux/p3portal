// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-46: Hook für die Pool-Liste des aktuellen Users (Deploy-Dropdown, Dashboard-Filter, Profil).
import { useState, useEffect } from 'react'
import { myPoolsApi } from '../api'

export function useMyPools() {
  const [pools, setPools]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    myPoolsApi.list().then(setPools).catch(() => setPools([])).finally(() => setLoading(false))
  }, [])

  return { pools, loading }
}
