// p3portal.org
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import VmGuestInfoSection from './VmGuestInfoSection'

vi.mock('../ui/ResourceBar', () => ({
  default: ({ pct, detail, warnAt, critAt }) => (
    <div
      data-testid="resource-bar"
      data-pct={pct}
      data-detail={detail}
      data-warn-at={warnAt}
      data-crit-at={critAt}
    />
  ),
}))

const makeGuestInfo = (overrides = {}) => ({
  os_name: 'Ubuntu',
  os_version: '24.04.2 LTS',
  kernel: '6.8.0-51-generic',
  arch: 'x86_64',
  hostname: 'my-vm',
  timezone: 'Europe/Berlin',
  timezone_offset: 7200,
  filesystems: [],
  truncated_count: 0,
  ...overrides,
})

describe('VmGuestInfoSection', () => {
  describe('Loading-State', () => {
    it('zeigt Spinner wenn loading=true', () => {
      render(<VmGuestInfoSection guestInfo={null} loading={true} />)
      expect(screen.getByText(/Guest Agent wird abgefragt/)).toBeInTheDocument()
    })

    it('versteckt Spinner wenn loading=false', () => {
      render(<VmGuestInfoSection guestInfo={null} loading={false} />)
      expect(screen.queryByText(/Guest Agent wird abgefragt/)).not.toBeInTheDocument()
    })
  })

  describe('Fallback (kein Agent)', () => {
    it('zeigt Fallback-Text wenn guestInfo=null und nicht loading', () => {
      render(<VmGuestInfoSection guestInfo={null} loading={false} />)
      expect(screen.getByText(/Guest Agent nicht verfügbar/)).toBeInTheDocument()
    })

    it('zeigt keinen Fallback wenn guestInfo vorhanden', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo()} loading={false} />)
      expect(screen.queryByText(/Guest Agent nicht verfügbar/)).not.toBeInTheDocument()
    })
  })

  describe('OS-Info Anzeige', () => {
    it('zeigt OS-Name und Version', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo()} loading={false} />)
      expect(screen.getByText(/Ubuntu 24.04.2 LTS/)).toBeInTheDocument()
    })

    it('zeigt Kernel-Version', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo()} loading={false} />)
      expect(screen.getByText(/6.8.0-51-generic/)).toBeInTheDocument()
    })

    it('zeigt Architektur', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo()} loading={false} />)
      expect(screen.getByText(/x86_64/)).toBeInTheDocument()
    })

    it('funktioniert auch ohne OS-Version (nur Name)', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo({ os_version: null })} loading={false} />)
      expect(screen.getByText(/Ubuntu/)).toBeInTheDocument()
    })

    it('zeigt "Keine OS-Informationen" wenn alle OS-Felder null', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo({
        os_name: null, os_version: null, kernel: null, arch: null, hostname: null, timezone: null,
      })} loading={false} />)
      expect(screen.getByText(/Keine OS-Informationen/)).toBeInTheDocument()
    })
  })

  describe('Hostname-Anzeige', () => {
    it('zeigt Gast-Hostname', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo({ hostname: 'test-server' })} loading={false} />)
      expect(screen.getByText('test-server')).toBeInTheDocument()
    })

    it('versteckt Hostname-Feld wenn null', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo({ hostname: null })} loading={false} />)
      expect(screen.queryByText('Hostname (Gast)')).not.toBeInTheDocument()
    })
  })

  describe('Zeitzone-Anzeige', () => {
    it('zeigt Zeitzone mit positivem UTC-Offset', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo({ timezone: 'Europe/Berlin', timezone_offset: 7200 })} loading={false} />)
      expect(screen.getByText(/Europe\/Berlin.*UTC\+2/)).toBeInTheDocument()
    })

    it('zeigt Zeitzone mit negativem UTC-Offset', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo({ timezone: 'America/New_York', timezone_offset: -18000 })} loading={false} />)
      expect(screen.getByText(/America\/New_York.*UTC-5/)).toBeInTheDocument()
    })

    it('zeigt Zeitzone ohne Offset-Angabe wenn timezone_offset null', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo({ timezone: 'UTC', timezone_offset: null })} loading={false} />)
      expect(screen.getByText('UTC')).toBeInTheDocument()
    })

    it('versteckt Zeitzone-Feld wenn null', () => {
      render(<VmGuestInfoSection guestInfo={makeGuestInfo({ timezone: null })} loading={false} />)
      expect(screen.queryByText('Zeitzone')).not.toBeInTheDocument()
    })
  })

  describe('Filesystem-Anzeige', () => {
    it('zeigt Filesystem-Liste wenn vorhanden', () => {
      const info = makeGuestInfo({
        filesystems: [
          { mountpoint: '/', fstype: 'ext4', total_bytes: 107374182400, used_bytes: 32212254720 },
        ],
      })
      render(<VmGuestInfoSection guestInfo={info} loading={false} />)
      expect(screen.getByText('/')).toBeInTheDocument()
      expect(screen.getByText('ext4')).toBeInTheDocument()
    })

    it('zeigt ResourceBar mit warnAt=80 und critAt=95', () => {
      const info = makeGuestInfo({
        filesystems: [
          { mountpoint: '/data', fstype: 'xfs', total_bytes: 107374182400, used_bytes: 53687091200 },
        ],
      })
      render(<VmGuestInfoSection guestInfo={info} loading={false} />)
      const bar = screen.getByTestId('resource-bar')
      expect(Number(bar.dataset.warnAt)).toBe(80)
      expect(Number(bar.dataset.critAt)).toBe(95)
    })

    it('zeigt "0 B" für Filesystem mit total_bytes=0 ohne ResourceBar', () => {
      const info = makeGuestInfo({
        filesystems: [
          { mountpoint: '/dev', fstype: 'devtmpfs', total_bytes: 0, used_bytes: 0 },
        ],
      })
      render(<VmGuestInfoSection guestInfo={info} loading={false} />)
      expect(screen.getByText('0 B')).toBeInTheDocument()
      expect(screen.queryByTestId('resource-bar')).not.toBeInTheDocument()
    })

    it('zeigt truncated_count-Hinweis wenn vorhanden', () => {
      const info = makeGuestInfo({
        filesystems: [
          { mountpoint: '/', fstype: 'ext4', total_bytes: 107374182400, used_bytes: 10737418240 },
        ],
        truncated_count: 5,
      })
      render(<VmGuestInfoSection guestInfo={info} loading={false} />)
      expect(screen.getByText(/5 weitere Dateisysteme ausgeblendet/)).toBeInTheDocument()
    })

    it('zeigt kein Filesystem-Zähler wenn Liste leer', () => {
      const info = makeGuestInfo({ filesystems: [] })
      render(<VmGuestInfoSection guestInfo={info} loading={false} />)
      expect(screen.queryByText(/Dateisysteme \(/)).not.toBeInTheDocument()
    })

    it('Dateisysteme-Zähler gibt korrekte Anzahl an', () => {
      const info = makeGuestInfo({
        filesystems: [
          { mountpoint: '/', fstype: 'ext4', total_bytes: 1073741824, used_bytes: 536870912 },
          { mountpoint: '/home', fstype: 'ext4', total_bytes: 2147483648, used_bytes: 1073741824 },
        ],
        truncated_count: 0,
      })
      render(<VmGuestInfoSection guestInfo={info} loading={false} />)
      expect(screen.getByText(/Dateisysteme \(2\)/)).toBeInTheDocument()
    })
  })

  describe('Sektion-Überschrift', () => {
    it('zeigt Überschrift "Gastsystem"', () => {
      render(<VmGuestInfoSection guestInfo={null} loading={false} />)
      expect(screen.getByText('Gastsystem')).toBeInTheDocument()
    })
  })
})
