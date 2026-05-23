// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: React-Query-Hooks für den Approval-Workflow.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { approvalsApi } from './api'

const STALE = 30_000

// ── Approver-Liste ─────────────────────────────────────────────────────────

export function useApprovalsList(params = {}) {
  return useQuery({
    queryKey: ['approvals', params],
    queryFn: () => approvalsApi.list(params),
    staleTime: STALE,
    refetchInterval: STALE,
  })
}

export function useMyApprovalsList(params = {}) {
  return useQuery({
    queryKey: ['my-approvals', params],
    queryFn: () => approvalsApi.myList(params),
    staleTime: STALE,
    refetchInterval: STALE,
  })
}

export function useApproval(id) {
  return useQuery({
    queryKey: ['approval', id],
    queryFn: () => approvalsApi.get(id),
    enabled: !!id,
    staleTime: STALE,
    refetchInterval: STALE,
  })
}

/** Schmaler Zähler für Sidebar-Badge + Banner */
export function useApprovalCount() {
  return useQuery({
    queryKey: ['approvals-count'],
    queryFn: approvalsApi.count,
    staleTime: STALE,
    refetchInterval: STALE,
    placeholderData: { count: 0 },
  })
}

// ── Regeln ──────────────────────────────────────────────────────────────────

export function useApprovalRules() {
  return useQuery({
    queryKey: ['approval-rules'],
    queryFn: approvalsApi.listRules,
    staleTime: 60_000,
  })
}

export function useWorkflowConfig() {
  return useQuery({
    queryKey: ['approval-workflow-config'],
    queryFn: approvalsApi.getWorkflowConfig,
    staleTime: 30_000,
  })
}

// ── Mutations ──────────────────────────────────────────────────────────────

export function useApproveApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }) => approvalsApi.approve(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] })
      qc.invalidateQueries({ queryKey: ['approvals-count'] })
      qc.invalidateQueries({ queryKey: ['my-approvals'] })
    },
  })
}

export function useRejectApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }) => approvalsApi.reject(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] })
      qc.invalidateQueries({ queryKey: ['approvals-count'] })
      qc.invalidateQueries({ queryKey: ['my-approvals'] })
    },
  })
}

export function useCancelApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }) => approvalsApi.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] })
      qc.invalidateQueries({ queryKey: ['my-approvals'] })
    },
  })
}

export function useResubmitApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payloadOverrides }) => approvalsApi.resubmit(id, payloadOverrides),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-approvals'] })
    },
  })
}

export function useCreateRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => approvalsApi.createRule(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approval-rules'] }),
  })
}

export function useUpdateRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }) => approvalsApi.updateRule(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approval-rules'] }),
  })
}

export function useDeleteRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => approvalsApi.deleteRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approval-rules'] }),
  })
}

export function useToggleWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ enabled, ...extra }) => approvalsApi.setWorkflowEnabled(enabled, extra),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approval-workflow-config'] })
      qc.invalidateQueries({ queryKey: ['approvals'] })
      qc.invalidateQueries({ queryKey: ['approvals-count'] })
      qc.invalidateQueries({ queryKey: ['license'] })
    },
  })
}
