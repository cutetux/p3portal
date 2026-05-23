// p3portal.org
// PROJ-48: Mutations für Owner-Operationen (add/remove/transfer/adopt/deleteRequest).
import { useState } from 'react'
import { ownersApi } from '../api'
import { useInvalidateOwners } from './useOwners'
import { formatApiError } from '../../../api/errors'

export function useOwnerMutations(resourceType, nodeId, vmid) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const invalidate = useInvalidateOwners()

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      invalidate(resourceType, nodeId, vmid)
      return true
    } catch (err) {
      setError(formatApiError(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const addOwner = (userId) =>
    run(() => ownersApi.add(resourceType, nodeId, vmid, userId))

  const removeOwner = (userId, orphan = false) =>
    run(() => ownersApi.remove(resourceType, nodeId, vmid, userId, orphan))

  const transferOwner = (toUserId) =>
    run(() => ownersApi.transfer(resourceType, nodeId, vmid, toUserId))

  const adopt = () =>
    run(() => ownersApi.adopt(resourceType, nodeId, vmid))

  const deleteRequest = (reason = '') =>
    run(() => ownersApi.deleteRequest(resourceType, nodeId, vmid, reason))

  return { addOwner, removeOwner, transferOwner, adopt, deleteRequest, busy, error, setError }
}
