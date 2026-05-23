// p3portal.org
import { renderHook, act, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { usePackerNodes } from './usePackerNodes'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/packer', () => ({
  getPackerNodes: vi.fn(),
  getPackerIsos: vi.fn(),
  queryIsoUrl: vi.fn(),
  downloadIso: vi.fn(),
}))

import { getPackerNodes, getPackerIsos, queryIsoUrl, downloadIso } from '../api/packer'

const MOCK_NODES = [
  { name: 'pve', status: 'online' },
  { name: 'pve2', status: 'offline' },
]

const MOCK_ISOS = [
  { filename: 'debian-13.4.0-amd64-netinst.iso', volid: 'local:iso/debian-13.4.0-amd64-netinst.iso', size: 650000000 },
  { filename: 'ubuntu-24.04.iso', volid: 'local:iso/ubuntu-24.04.iso', size: 1200000000 },
]

describe('usePackerNodes', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── fetchNodes ──────────────────────────────────────────────────────────────

  it('fetchNodes: returns nodes and sets state on success', async () => {
    getPackerNodes.mockResolvedValue(MOCK_NODES)
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    let nodes
    await act(async () => { nodes = await result.current.fetchNodes() })

    expect(nodes).toEqual(MOCK_NODES)
    await waitFor(() => expect(result.current.nodes).toEqual(MOCK_NODES))
    expect(result.current.nodesError).toBeNull()
    expect(result.current.nodesLoading).toBe(false)
  })

  it('fetchNodes: sets loading=true while fetching', async () => {
    let resolveNodes
    getPackerNodes.mockReturnValue(new Promise(r => { resolveNodes = r }))
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    act(() => { result.current.fetchNodes() })
    await waitFor(() => expect(result.current.nodesLoading).toBe(true))

    await act(async () => { resolveNodes(MOCK_NODES) })
    await waitFor(() => expect(result.current.nodesLoading).toBe(false))
  })

  it('fetchNodes: sets nodesError on failure and returns empty array', async () => {
    const err = new Error('Proxmox nicht erreichbar')
    getPackerNodes.mockRejectedValue(err)
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    let nodes
    await act(async () => { nodes = await result.current.fetchNodes() })

    expect(nodes).toEqual([])
    await waitFor(() => expect(result.current.nodesError).toBe(err))
    expect(result.current.nodes).toEqual([])
  })

  it('fetchNodes: clears previous error on re-fetch', async () => {
    const err = new Error('first error')
    getPackerNodes.mockRejectedValueOnce(err).mockResolvedValueOnce(MOCK_NODES)
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    await act(async () => { await result.current.fetchNodes() })
    await waitFor(() => expect(result.current.nodesError).toBe(err))

    await act(async () => { await result.current.fetchNodes() })
    await waitFor(() => expect(result.current.nodesError).toBeNull())
    expect(result.current.nodes).toEqual(MOCK_NODES)
  })

  // ── fetchIsos ───────────────────────────────────────────────────────────────

  it('fetchIsos: returns ISOs and sets state on success', async () => {
    getPackerIsos.mockResolvedValue(MOCK_ISOS)
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    let isos
    await act(async () => {
      isos = await result.current.fetchIsos('pve')
    })

    expect(isos).toEqual(MOCK_ISOS)
    expect(result.current.isos).toEqual(MOCK_ISOS)
    expect(result.current.isosError).toBeNull()
    expect(getPackerIsos).toHaveBeenCalledWith('pve')
  })

  it('fetchIsos: returns empty array and clears isos when node is falsy', async () => {
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    let isos
    await act(async () => { isos = await result.current.fetchIsos('') })

    expect(isos).toEqual([])
    expect(result.current.isos).toEqual([])
    expect(getPackerIsos).not.toHaveBeenCalled()
  })

  it('fetchIsos: sets isosError on failure', async () => {
    const err = new Error('node not found')
    getPackerIsos.mockRejectedValue(err)
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    let isos
    await act(async () => { isos = await result.current.fetchIsos('pve') })

    expect(isos).toEqual([])
    expect(result.current.isosError).toBe(err)
  })

  it('fetchIsos: clears previous isosError on success', async () => {
    const err = new Error('first error')
    getPackerIsos.mockRejectedValueOnce(err).mockResolvedValueOnce(MOCK_ISOS)
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    await act(async () => { await result.current.fetchIsos('pve') })
    expect(result.current.isosError).toBe(err)

    await act(async () => { await result.current.fetchIsos('pve') })
    expect(result.current.isosError).toBeNull()
    expect(result.current.isos).toEqual(MOCK_ISOS)
  })

  // ── queryUrl ─────────────────────────────────────────────────────────────────

  it('queryUrl: delegates to queryIsoUrl and returns result', async () => {
    const mockResult = { filename: 'debian-13.iso', size: 650000000, content_type: 'application/x-iso9660-image' }
    queryIsoUrl.mockResolvedValue(mockResult)
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    let res
    await act(async () => {
      res = await result.current.queryUrl('https://example.com/debian.iso')
    })

    expect(res).toEqual(mockResult)
    expect(queryIsoUrl).toHaveBeenCalledWith('https://example.com/debian.iso')
  })

  it('queryUrl: propagates error from queryIsoUrl', async () => {
    const err = new Error('URL nicht erreichbar')
    queryIsoUrl.mockRejectedValue(err)
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    await expect(act(async () => {
      await result.current.queryUrl('https://bad.example.com/file.iso')
    })).rejects.toThrow('URL nicht erreichbar')
  })

  // ── startDownload ─────────────────────────────────────────────────────────────

  it('startDownload: delegates to downloadIso and returns job', async () => {
    const mockJob = { id: 'job-123', type: 'iso_download', status: 'pending' }
    downloadIso.mockResolvedValue(mockJob)
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    const payload = { node: 'pve', filename: 'debian-13.iso', url: 'https://example.com/debian.iso', verify_certificates: true }
    let job
    await act(async () => {
      job = await result.current.startDownload(payload)
    })

    expect(job).toEqual(mockJob)
    expect(downloadIso).toHaveBeenCalledWith(payload)
  })

  it('startDownload: propagates 409 conflict error', async () => {
    const err = { response: { status: 409, data: { detail: "ISO 'debian-13.iso' existiert bereits" } } }
    downloadIso.mockRejectedValue(err)
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })

    await expect(act(async () => {
      await result.current.startDownload({ node: 'pve', filename: 'debian-13.iso', url: 'https://example.com/debian.iso', verify_certificates: true })
    })).rejects.toMatchObject({ response: { status: 409 } })
  })

  // ── Initialzustand ────────────────────────────────────────────────────────────

  it('initial state: nodes and isos are empty, loading flags false', () => {
    const { result } = renderHook(() => usePackerNodes(), { wrapper: createQueryWrapper() })
    expect(result.current.nodes).toEqual([])
    expect(result.current.isos).toEqual([])
    expect(result.current.nodesLoading).toBe(false)
    expect(result.current.isosLoading).toBe(false)
    expect(result.current.nodesError).toBeNull()
    expect(result.current.isosError).toBeNull()
  })
})
