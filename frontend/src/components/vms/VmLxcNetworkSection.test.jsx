// p3portal.org
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import VmLxcNetworkSection from './VmLxcNetworkSection'

const makeIface = (overrides = {}) => ({
  name: 'eth0',
  inet: '192.168.1.10/24',
  inet6: null,
  hwaddr: 'BC:24:11:AA:BB:CC',
  ...overrides,
})

describe('VmLxcNetworkSection', () => {
  describe('Loading-State', () => {
    it('zeigt Spinner wenn loading=true', () => {
      render(<VmLxcNetworkSection interfaces={null} loading={true} />)
      expect(screen.getByText(/Interfaces werden geladen/)).toBeInTheDocument()
    })

    it('versteckt Spinner wenn loading=false', () => {
      render(<VmLxcNetworkSection interfaces={[]} loading={false} />)
      expect(screen.queryByText(/Interfaces werden geladen/)).not.toBeInTheDocument()
    })
  })

  describe('Leer-Zustand', () => {
    it('zeigt Leer-Text wenn interfaces=[]', () => {
      render(<VmLxcNetworkSection interfaces={[]} loading={false} />)
      expect(screen.getByText(/Keine Interface-Daten verfügbar/)).toBeInTheDocument()
    })

    it('zeigt Leer-Text wenn interfaces=null', () => {
      render(<VmLxcNetworkSection interfaces={null} loading={false} />)
      expect(screen.getByText(/Keine Interface-Daten verfügbar/)).toBeInTheDocument()
    })
  })

  describe('Interface-Anzeige', () => {
    it('zeigt Interface-Name', () => {
      render(<VmLxcNetworkSection interfaces={[makeIface()]} loading={false} />)
      expect(screen.getByText('eth0')).toBeInTheDocument()
    })

    it('zeigt IPv4-Adresse', () => {
      render(<VmLxcNetworkSection interfaces={[makeIface()]} loading={false} />)
      expect(screen.getByText('192.168.1.10/24')).toBeInTheDocument()
      expect(screen.getByText('IPv4')).toBeInTheDocument()
    })

    it('zeigt MAC-Adresse', () => {
      render(<VmLxcNetworkSection interfaces={[makeIface()]} loading={false} />)
      expect(screen.getByText('BC:24:11:AA:BB:CC')).toBeInTheDocument()
    })

    it('zeigt IPv6-Adresse wenn vorhanden', () => {
      const iface = makeIface({ inet6: 'fe80::1/64' })
      render(<VmLxcNetworkSection interfaces={[iface]} loading={false} />)
      expect(screen.getByText('fe80::1/64')).toBeInTheDocument()
      expect(screen.getByText('IPv6')).toBeInTheDocument()
    })

    it('versteckt IPv4-Zeile wenn kein inet', () => {
      const iface = makeIface({ inet: null })
      render(<VmLxcNetworkSection interfaces={[iface]} loading={false} />)
      expect(screen.queryByText('IPv4')).not.toBeInTheDocument()
    })

    it('zeigt "Keine IP-Adresse" wenn weder inet noch inet6', () => {
      const iface = makeIface({ inet: null, inet6: null })
      render(<VmLxcNetworkSection interfaces={[iface]} loading={false} />)
      expect(screen.getByText(/Keine IP-Adresse/)).toBeInTheDocument()
    })

    it('versteckt MAC-Zeile wenn hwaddr fehlt', () => {
      const iface = makeIface({ hwaddr: null })
      render(<VmLxcNetworkSection interfaces={[iface]} loading={false} />)
      expect(screen.queryByText('BC:24:11:AA:BB:CC')).not.toBeInTheDocument()
    })

    it('rendert mehrere Interfaces', () => {
      const ifaces = [
        makeIface({ name: 'eth0', inet: '10.0.0.1/24' }),
        makeIface({ name: 'eth1', inet: '172.16.0.1/24' }),
      ]
      render(<VmLxcNetworkSection interfaces={ifaces} loading={false} />)
      expect(screen.getByText('eth0')).toBeInTheDocument()
      expect(screen.getByText('eth1')).toBeInTheDocument()
    })
  })

  describe('Sektion-Überschrift', () => {
    it('zeigt Überschrift "Netzwerk-Interfaces (LXC)"', () => {
      render(<VmLxcNetworkSection interfaces={[]} loading={false} />)
      expect(screen.getByText(/Netzwerk-Interfaces.*LXC/)).toBeInTheDocument()
    })
  })
})
