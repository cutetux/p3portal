// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import client from '../../api/client'

const BASE = '/api/git-sync'

export async function fetchGitSyncConfig(repoType) {
  const { data } = await client.get(`${BASE}/config/${repoType}`)
  return data
}

export async function saveGitSyncConfig(repoType, payload) {
  const { data } = await client.put(`${BASE}/config/${repoType}`, payload)
  return data
}

export async function deleteGitSyncConfig(repoType) {
  await client.delete(`${BASE}/config/${repoType}`)
}

export async function fetchSshKey(repoType) {
  const { data } = await client.get(`${BASE}/config/${repoType}/ssh-key`)
  return data
}

export async function regenerateSshKey(repoType) {
  const { data } = await client.post(`${BASE}/config/${repoType}/regenerate-ssh-key`)
  return data
}

export async function regenerateWebhookToken(repoType) {
  const { data } = await client.post(`${BASE}/config/${repoType}/regenerate-webhook-token`)
  return data
}

export async function triggerSync(repoType) {
  const { data } = await client.post(`${BASE}/sync/${repoType}`)
  return data
}

export async function fetchSyncLogs(repoType) {
  const { data } = await client.get(`${BASE}/logs/${repoType}`)
  return data
}

export async function fetchConflicts() {
  const { data } = await client.get(`${BASE}/conflicts`)
  return data
}

export async function resolveConflict(conflictId, resolution) {
  const { data } = await client.post(`${BASE}/conflicts/${conflictId}/resolve`, { resolution })
  return data
}
