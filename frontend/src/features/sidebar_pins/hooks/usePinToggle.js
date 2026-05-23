// p3portal.org
// PROJ-54: Toggle-Hook für Pin/Unpin einer Route.
// Wird in SystemSettingsPage-Tab-Headern und Detail-Page-Headern wiederverwendet.
import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { sidebarPinsApi } from '../api'
import { getLicenseStatus } from '../../../api/license'

function canonicalRoute(route) {
  try {
    const url = new URL(route, 'http://x')
    const params = [...url.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const qs = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : ''
    const path = url.pathname.replace(/\/$/, '') || '/'
    return path + qs
  } catch {
    return route
  }
}

export function usePinToggle({ route, pinKind = 'other', resourceRef = null, defaultLabel = '' } = {}) {
  const [pinId, setPinId]             = useState(null)
  const [loading, setLoading]         = useState(false)
  const [warning, setWarning]         = useState(null)
  const [atLimitFromError, setAtLimitFromError] = useState(false)
  const [pinCount, setPinCount]       = useState(null)
  const queryClient = useQueryClient()

  // License-Status aus React-Query-Cache (kein zusätzlicher Netzwerk-Call wenn bereits gecacht)
  const { data: licData } = useQuery({
    queryKey: ['license'],
    queryFn: getLicenseStatus,
    staleTime: 120_000,
  })
  const maxPins = licData?.limits?.sidebar_pins?.max ?? 5

  const canonical = route ? canonicalRoute(route) : null

  // Check if this route is already pinned on mount
  useEffect(() => {
    if (!canonical) return
    sidebarPinsApi.list()
      .then(pins => {
        setPinCount(pins.length)
        const found = pins.find(p => p.route === canonical)
        setPinId(found?.id ?? null)
      })
      .catch(() => {})
  }, [canonical])

  const isPinned = pinId !== null
  // atLimit vorberechnen: bereits beim Laden aktiv, sobald pinCount >= maxPins und nicht selbst gepinnt
  const atLimit = atLimitFromError || (!isPinned && pinCount !== null && pinCount >= maxPins)

  const toggle = useCallback(async () => {
    if (!canonical || loading) return
    setLoading(true)
    setWarning(null)
    try {
      if (pinId !== null) {
        await sidebarPinsApi.remove(pinId)
        setPinId(null)
        setPinCount(c => (c ?? 1) - 1)
        queryClient.invalidateQueries({ queryKey: ['sidebar-pins'] })
      } else {
        const res = await sidebarPinsApi.create({
          route: canonical,
          pin_kind: pinKind,
          resource_ref: resourceRef,
          label: defaultLabel || null,
        })
        setPinId(res.pin.id)
        setPinCount(c => (c ?? 0) + 1)
        queryClient.invalidateQueries({ queryKey: ['sidebar-pins'] })
        if (res.warning === 'pin_soft_limit') {
          setWarning('pin_soft_limit')
        }
      }
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (detail?.detail === 'pin_limit_reached') {
        setAtLimitFromError(true)
      }
    } finally {
      setLoading(false)
    }
  }, [canonical, pinId, pinKind, resourceRef, defaultLabel, loading, queryClient])

  return {
    isPinned,
    pinId,
    loading,
    warning,
    atLimit,
    pinCount,
    toggle,
  }
}
