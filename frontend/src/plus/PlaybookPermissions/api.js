// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-49: API-Client für Playbook-Permissions.
import api from '../../api/client'

export const playbookPermissionsApi = {
  // Whitelist-CRUD für ein einzelnes Playbook
  listPermissions: (playbookName) =>
    api.get(`/api/playbooks/${encodeURIComponent(playbookName)}/permissions`).then(r => r.data),

  addPermission: (playbookName, subjectType, subjectId) =>
    api.post(`/api/playbooks/${encodeURIComponent(playbookName)}/permissions`, {
      subject_type: subjectType,
      subject_id: subjectId,
    }).then(r => r.data),

  removePermission: (playbookName, permissionId) =>
    api.delete(`/api/playbooks/${encodeURIComponent(playbookName)}/permissions/${permissionId}`),

  // Globale Konfiguration (default_playbook_mode)
  getConfig: () =>
    api.get('/api/playbook-permissions/config').then(r => r.data),

  updateConfig: (defaultPlaybookMode) =>
    api.put('/api/playbook-permissions/config', { default_playbook_mode: defaultPlaybookMode }).then(r => r.data),

  // Self-Service: eigene erlaubte Playbooks
  getMyPermissions: () =>
    api.get('/api/me/playbook-permissions').then(r => r.data),
}
