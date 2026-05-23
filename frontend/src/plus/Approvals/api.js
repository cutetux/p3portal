// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: API-Client für den Approval-Workflow.
import api from '../../api/client'

const BASE = '/api/approvals'
const RULES_BASE = '/api/approval-rules'
const ADMIN_BASE = '/api/admin/approval-workflow'

export const approvalsApi = {
  // ── Anträge ────────────────────────────────────────────────────────────────

  /** Approver-Liste: alle entscheidbaren Anträge */
  list: (params = {}) =>
    api.get(BASE, { params }).then(r => r.data),

  /** Zähler für Sidebar-Badge */
  count: () =>
    api.get(`${BASE}/count`).then(r => r.data),

  /** Einzelantrag */
  get: (id) =>
    api.get(`${BASE}/${id}`).then(r => r.data),

  /** Genehmigen */
  approve: (id, reason) =>
    api.post(`${BASE}/${id}/approve`, { reason }).then(r => r.data),

  /** Ablehnen */
  reject: (id, reason) =>
    api.post(`${BASE}/${id}/reject`, { reason }).then(r => r.data),

  /** Zurückziehen */
  cancel: (id) =>
    api.post(`${BASE}/${id}/cancel`).then(r => r.data),

  /** Neu einreichen */
  resubmit: (id, payloadOverrides = {}) =>
    api.post(`${BASE}/${id}/resubmit`, { payload_overrides: payloadOverrides }).then(r => r.data),

  /** Requester-Sicht: eigene Anträge */
  myList: (params = {}) =>
    api.get('/api/my-approvals', { params }).then(r => r.data),

  // ── Regeln ─────────────────────────────────────────────────────────────────

  listRules: () =>
    api.get(RULES_BASE).then(r => r.data),

  createRule: (body) =>
    api.post(RULES_BASE, body).then(r => r.data),

  updateRule: (id, body) =>
    api.patch(`${RULES_BASE}/${id}`, body).then(r => r.data),

  deleteRule: (id) =>
    api.delete(`${RULES_BASE}/${id}`),

  // ── Master-Toggle ──────────────────────────────────────────────────────────

  getWorkflowConfig: () =>
    api.get(ADMIN_BASE).then(r => r.data),

  setWorkflowEnabled: (enabled, extra = {}) =>
    api.post(ADMIN_BASE, { enabled, ...extra }).then(r => r.data),
}
