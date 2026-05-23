// p3portal.org
import { renderHook, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { usePermissions } from './usePermissions'
import { createQueryWrapper } from '../test-utils'

vi.mock('./useAuth', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../api/auth', () => ({
  getPermissions: vi.fn(),
}))

vi.mock('../api/rbac', () => ({
  fetchMyPermissions: vi.fn(),
}))

import { useAuth } from './useAuth'
import { getPermissions } from '../api/auth'
import { fetchMyPermissions } from '../api/rbac'

const PROXMOX_PERMS = {
  username: 'admin@pam',
  capabilities: { vms: ['VM.Allocate', 'VM.Audit'], storage: ['Datastore.Audit'] },
  groups: ['admins'],
}

const LOCAL_PERMS = {
  username: 'operator1',
  capabilities: { app_role: ['operator'] },
  groups: [],
}

const RBAC_DATA = {
  bypass: false,
  assignments: [
    { resource_type: 'vm', resource_id: 101, permissions: ['start', 'stop'] },
  ],
}

describe('usePermissions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('proxmox user: loads getPermissions only, not fetchMyPermissions', async () => {
    useAuth.mockReturnValue({ auth_type: 'proxmox' })
    getPermissions.mockResolvedValue(PROXMOX_PERMS)

    const { result } = renderHook(() => usePermissions(), { wrapper: createQueryWrapper() })
    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(getPermissions).toHaveBeenCalledTimes(1)
    expect(fetchMyPermissions).not.toHaveBeenCalled()
    expect(result.current.proxmoxPerms).toEqual(PROXMOX_PERMS)
    expect(result.current.rbacData).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('local user: loads both getPermissions and fetchMyPermissions', async () => {
    useAuth.mockReturnValue({ auth_type: 'local' })
    getPermissions.mockResolvedValue(LOCAL_PERMS)
    fetchMyPermissions.mockResolvedValue(RBAC_DATA)

    const { result } = renderHook(() => usePermissions(), { wrapper: createQueryWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(getPermissions).toHaveBeenCalledTimes(1)
    expect(fetchMyPermissions).toHaveBeenCalledTimes(1)
    expect(result.current.proxmoxPerms).toEqual(LOCAL_PERMS)
    expect(result.current.rbacData).toEqual(RBAC_DATA)
    expect(result.current.error).toBeNull()
  })

  it('local user: extracts app_role from capabilities', async () => {
    useAuth.mockReturnValue({ auth_type: 'local' })
    getPermissions.mockResolvedValue(LOCAL_PERMS)
    fetchMyPermissions.mockResolvedValue({ bypass: false, assignments: [] })

    const { result } = renderHook(() => usePermissions(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.proxmoxPerms.capabilities.app_role[0]).toBe('operator')
  })

  it('local admin: bypass=true from fetchMyPermissions is forwarded', async () => {
    useAuth.mockReturnValue({ auth_type: 'local' })
    getPermissions.mockResolvedValue({ ...LOCAL_PERMS, capabilities: { app_role: ['admin'] } })
    fetchMyPermissions.mockResolvedValue({ bypass: true, assignments: [] })

    const { result } = renderHook(() => usePermissions(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.rbacData.bypass).toBe(true)
    expect(result.current.rbacData.assignments).toHaveLength(0)
  })

  it('sets error state when getPermissions fails', async () => {
    useAuth.mockReturnValue({ auth_type: 'proxmox' })
    const err = new Error('Network Error')
    getPermissions.mockRejectedValue(err)

    const { result } = renderHook(() => usePermissions(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe(err)
    expect(result.current.proxmoxPerms).toBeNull()
  })

  it('sets error state when fetchMyPermissions fails (local user)', async () => {
    useAuth.mockReturnValue({ auth_type: 'local' })
    getPermissions.mockResolvedValue(LOCAL_PERMS)
    fetchMyPermissions.mockRejectedValue(new Error('RBAC unavailable'))

    const { result } = renderHook(() => usePermissions(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).not.toBeNull()
  })

  it('reload() re-fetches data and clears previous error', async () => {
    useAuth.mockReturnValue({ auth_type: 'proxmox' })
    getPermissions
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce(PROXMOX_PERMS)

    const { result } = renderHook(() => usePermissions(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).not.toBeNull()

    await waitFor(() => result.current.reload())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeNull()
    expect(result.current.proxmoxPerms).toEqual(PROXMOX_PERMS)
  })

  it('proxmox user with no capabilities returns empty object without crash', async () => {
    useAuth.mockReturnValue({ auth_type: 'proxmox' })
    getPermissions.mockResolvedValue({ username: 'user@pam', capabilities: {}, groups: [] })

    const { result } = renderHook(() => usePermissions(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.proxmoxPerms.capabilities).toEqual({})
    expect(result.current.error).toBeNull()
  })
})
