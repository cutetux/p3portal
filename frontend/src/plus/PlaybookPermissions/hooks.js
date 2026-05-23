// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-49: React-Query-Hooks für Playbook-Permissions.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { playbookPermissionsApi } from './api'

export function usePlaybookPermissionsConfig() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['playbook-permissions-config'],
    queryFn: playbookPermissionsApi.getConfig,
    staleTime: 30_000,
  })

  const updateConfig = useMutation({
    mutationFn: (mode) => playbookPermissionsApi.updateConfig(mode),
    onSuccess: (updated) => {
      queryClient.setQueryData(['playbook-permissions-config'], updated)
      // Playbook-Liste invalidieren, weil can_execute sich ändern kann
      queryClient.invalidateQueries({ queryKey: ['playbooks'] })
    },
  })

  return {
    config: data ?? null,
    loading: isLoading,
    error: error ?? null,
    updateConfig,
  }
}

export function usePlaybookPermissions(playbookName) {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['playbook-permissions', playbookName],
    queryFn: () => playbookPermissionsApi.listPermissions(playbookName),
    enabled: !!playbookName,
    staleTime: 15_000,
  })

  const addPermission = useMutation({
    mutationFn: ({ subjectType, subjectId }) =>
      playbookPermissionsApi.addPermission(playbookName, subjectType, subjectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbook-permissions', playbookName] })
      queryClient.invalidateQueries({ queryKey: ['playbooks'] })
    },
  })

  const removePermission = useMutation({
    mutationFn: (permissionId) =>
      playbookPermissionsApi.removePermission(playbookName, permissionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbook-permissions', playbookName] })
      queryClient.invalidateQueries({ queryKey: ['playbooks'] })
    },
  })

  return {
    permissions: data ?? [],
    loading: isLoading,
    error: error ?? null,
    addPermission,
    removePermission,
  }
}

export function useMyPlaybookPermissions() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['my-playbook-permissions'],
    queryFn: playbookPermissionsApi.getMyPermissions,
    staleTime: 60_000,
  })

  return {
    allowed: data ?? [],
    loading: isLoading,
    error: error ?? null,
  }
}
