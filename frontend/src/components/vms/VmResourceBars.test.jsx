// p3portal.org
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import VmResourceBars from './VmResourceBars'

vi.mock('../ui/ResourceBar', () => ({
  default: ({ label, pct, detail }) => (
    <div data-testid="resource-bar" data-label={label} data-pct={pct} data-detail={detail} />
  ),
}))

const makeStopped = (overrides = {}) => ({
  status: 'stopped',
  cpu_usage: null,
  cpu_cores: 4,
  mem_used: null,
  mem_total: 8589934592,
  ...overrides,
})

const makeRunning = (overrides = {}) => ({
  status: 'running',
  cpu_usage: 0.12,
  cpu_cores: 4,
  mem_used: 2147483648,
  mem_total: 8589934592,
  ...overrides,
})

describe('VmResourceBars', () => {
  it('zeigt ResourceBar für CPU bei laufender VM', () => {
    render(<VmResourceBars detail={makeRunning()} />)
    const bars = screen.getAllByTestId('resource-bar')
    const cpuBar = bars.find(b => b.dataset.label?.includes('CPU'))
    expect(cpuBar).toBeDefined()
    expect(Number(cpuBar.dataset.pct)).toBeCloseTo(12, 0)
    expect(cpuBar.dataset.detail).toContain('%')
  })

  it('zeigt ResourceBar für RAM bei laufender VM', () => {
    render(<VmResourceBars detail={makeRunning()} />)
    const bars = screen.getAllByTestId('resource-bar')
    const ramBar = bars.find(b => b.dataset.label?.includes('RAM'))
    expect(ramBar).toBeDefined()
    expect(ramBar.dataset.detail).toContain('GB')
  })

  it('zeigt Strich statt CPU-Wert bei gestoppter VM', () => {
    render(<VmResourceBars detail={makeStopped()} />)
    // Bei gestoppter VM werden keine ResourceBar-Komponenten gerendert
    expect(screen.queryAllByTestId('resource-bar')).toHaveLength(0)
    expect(screen.getAllByText('–')).toHaveLength(2)
  })

  it('zeigt Kernanzahl in CPU-Label', () => {
    render(<VmResourceBars detail={makeRunning({ cpu_cores: 8 })} />)
    const bars = screen.getAllByTestId('resource-bar')
    const cpuBar = bars.find(b => b.dataset.label?.includes('CPU'))
    expect(cpuBar.dataset.label).toContain('8 Kerne')
  })

  it('zeigt singularen Kern-Label bei 1 Kern', () => {
    render(<VmResourceBars detail={makeRunning({ cpu_cores: 1 })} />)
    const bars = screen.getAllByTestId('resource-bar')
    const cpuBar = bars.find(b => b.dataset.label?.includes('CPU'))
    expect(cpuBar.dataset.label).toContain('1 Kern')
  })

  it('zeigt Strich wenn mem_total 0 ist', () => {
    render(<VmResourceBars detail={makeRunning({ mem_total: 0, mem_used: null })} />)
    const strich = screen.getAllByText('–')
    expect(strich.length).toBeGreaterThan(0)
  })

  it('zeigt CPU-Auslastung in Prozent', () => {
    render(<VmResourceBars detail={makeRunning({ cpu_usage: 0.5 })} />)
    const bars = screen.getAllByTestId('resource-bar')
    const cpuBar = bars.find(b => b.dataset.label?.includes('CPU'))
    expect(cpuBar.dataset.detail).toBe('50.0%')
  })
})
