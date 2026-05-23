// p3portal.org
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import VmSnapshotSection from './VmSnapshotSection'

vi.mock('../../api/vms', () => ({
  createSnapshot: vi.fn(),
  rollbackSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
}))

import { createSnapshot, deleteSnapshot } from '../../api/vms'

const SNAP_1 = { name: 'snap-before-update', description: 'Vor Update', snaptime: 1700000000 }
const SNAP_2 = { name: 'snap-baseline', description: '', snaptime: 1699000000 }

describe('VmSnapshotSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('zeigt Snapshot-Liste an', () => {
    render(
      <VmSnapshotSection
        vmid={100} snapshots={[SNAP_1, SNAP_2]}
        isOperator={false} isTemplate={false} onReload={vi.fn()}
      />
    )
    expect(screen.getByText('snap-before-update')).toBeInTheDocument()
    expect(screen.getByText('snap-baseline')).toBeInTheDocument()
  })

  it('zeigt leere Meldung wenn keine Snapshots', () => {
    render(
      <VmSnapshotSection
        vmid={100} snapshots={[]}
        isOperator={false} isTemplate={false} onReload={vi.fn()}
      />
    )
    expect(screen.getByText('Keine Snapshots vorhanden.')).toBeInTheDocument()
  })

  it('zeigt Ladeanzeige wenn snapshots=null', () => {
    render(
      <VmSnapshotSection
        vmid={100} snapshots={null}
        isOperator={false} isTemplate={false} onReload={vi.fn()}
      />
    )
    // Skeleton-Loader vorhanden (animate-pulse Elemente)
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('zeigt + Snapshot Button für Operator', () => {
    render(
      <VmSnapshotSection
        vmid={100} snapshots={[]}
        isOperator={true} isTemplate={false} onReload={vi.fn()}
      />
    )
    expect(screen.getByText('+ Snapshot')).toBeInTheDocument()
  })

  it('versteckt + Snapshot Button für Viewer', () => {
    render(
      <VmSnapshotSection
        vmid={100} snapshots={[]}
        isOperator={false} isTemplate={false} onReload={vi.fn()}
      />
    )
    expect(screen.queryByText('+ Snapshot')).not.toBeInTheDocument()
  })

  it('versteckt + Snapshot Button für Templates', () => {
    render(
      <VmSnapshotSection
        vmid={100} snapshots={[]}
        isOperator={true} isTemplate={true} onReload={vi.fn()}
      />
    )
    expect(screen.queryByText('+ Snapshot')).not.toBeInTheDocument()
  })

  it('zeigt Rollback/Löschen Buttons für Operator', () => {
    render(
      <VmSnapshotSection
        vmid={100} snapshots={[SNAP_1]}
        isOperator={true} isTemplate={false} onReload={vi.fn()}
      />
    )
    expect(screen.getByText('Rollback')).toBeInTheDocument()
    expect(screen.getByText('Löschen')).toBeInTheDocument()
  })

  it('versteckt Rollback/Löschen für Viewer', () => {
    render(
      <VmSnapshotSection
        vmid={100} snapshots={[SNAP_1]}
        isOperator={false} isTemplate={false} onReload={vi.fn()}
      />
    )
    expect(screen.queryByText('Rollback')).not.toBeInTheDocument()
    expect(screen.queryByText('Löschen')).not.toBeInTheDocument()
  })

  it('validiert Snapshot-Name-Format', async () => {
    render(
      <VmSnapshotSection
        vmid={100} snapshots={[]}
        isOperator={true} isTemplate={false} onReload={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('+ Snapshot'))
    const input = screen.getByPlaceholderText('snapshot-name')
    fireEvent.change(input, { target: { value: 'invalid name!' } })
    fireEvent.click(screen.getByText('Snapshot erstellen'))
    await waitFor(() => {
      expect(screen.getByText(/Nur a–z/)).toBeInTheDocument()
    })
    expect(createSnapshot).not.toHaveBeenCalled()
  })

  it('erstellt Snapshot bei gültigem Namen', async () => {
    createSnapshot.mockResolvedValue({})
    const onReload = vi.fn().mockResolvedValue(undefined)
    render(
      <VmSnapshotSection
        vmid={100} snapshots={[]}
        isOperator={true} isTemplate={false} onReload={onReload}
      />
    )
    fireEvent.click(screen.getByText('+ Snapshot'))
    fireEvent.change(screen.getByPlaceholderText('snapshot-name'), {
      target: { value: 'my-snap' },
    })
    fireEvent.click(screen.getByText('Snapshot erstellen'))
    await waitFor(() => expect(onReload).toHaveBeenCalled())
    expect(createSnapshot).toHaveBeenCalledWith(100, 'my-snap', '', undefined)
  })

  it('zeigt Bestätigungs-Dialog vor dem Löschen', async () => {
    render(
      <VmSnapshotSection
        vmid={100} snapshots={[SNAP_1]}
        isOperator={true} isTemplate={false} onReload={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Löschen'))
    await waitFor(() => {
      expect(screen.getByText('Löschen?')).toBeInTheDocument()
    })
    expect(deleteSnapshot).not.toHaveBeenCalled()
  })

  it('löscht Snapshot nach Bestätigung', async () => {
    deleteSnapshot.mockResolvedValue({})
    const onReload = vi.fn().mockResolvedValue(undefined)
    render(
      <VmSnapshotSection
        vmid={100} snapshots={[SNAP_1]}
        isOperator={true} isTemplate={false} onReload={onReload}
      />
    )
    fireEvent.click(screen.getByText('Löschen'))
    await waitFor(() => screen.getByText('Löschen?'))
    fireEvent.click(screen.getByText('Ja'))
    await waitFor(() => expect(onReload).toHaveBeenCalled())
    expect(deleteSnapshot).toHaveBeenCalledWith(100, SNAP_1.name, undefined)
  })
})
