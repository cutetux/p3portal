// p3portal.org
// PROJ-57: React Query Hooks für das Help-Modul.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { helpApi } from './api'

const STALE = 5 * 60 * 1000 // 5 Minuten

/** Eigene User-Overrides (für Resolver + MyAccount-Tab) */
export function useHelpOverridesMe() {
  return useQuery({
    queryKey: ['help', 'me'],
    queryFn: helpApi.getMyOverrides,
    staleTime: STALE,
  })
}

/** Globale Overrides (für Resolver) */
export function useHelpOverridesGlobal() {
  return useQuery({
    queryKey: ['help', 'global'],
    queryFn: helpApi.getGlobalOverrides,
    staleTime: STALE,
  })
}

/** Admin-Tab: alle Overrides */
export function useHelpAdminOverrides() {
  return useQuery({
    queryKey: ['help', 'admin'],
    queryFn: helpApi.getAdminOverrides,
  })
}

/** Upload eigener Override */
export function useUploadOverride() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: helpApi.uploadOverride,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['help'] }),
  })
}

/** Löschen eines Overrides */
export function useDeleteOverride() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: helpApi.deleteOverride,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['help'] }),
  })
}

/** Promote User-Override → Global (Admin + Plus) */
export function usePromoteOverride() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: helpApi.promoteOverride,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['help'] }),
  })
}

/** Globalen Override entfernen (Admin + manage_help) */
export function useDeleteGlobalOverride() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, lang }) => helpApi.deleteGlobalOverride(key, lang),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['help'] }),
  })
}
