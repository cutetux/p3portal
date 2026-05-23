// p3portal.org
// PROJ-65: Vitest-Tests für NotificationsHubPage
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k, i18n: { language: 'de' } }),
}))

vi.mock('./hooks', () => ({
  useNotificationTab: vi.fn(),
  useMarkNotificationsRead: vi.fn(),
}))

// PinIcon + useSidebarPinTrigger optional
vi.mock('../../features/sidebar_pins/hooks/useSidebarPins', () => ({
  useSidebarPinTrigger: vi.fn(() => null),
}))
vi.mock('../../features/sidebar_pins/components/PinIcon', () => ({
  default: () => null,
}))

import NotificationsHubPage from './Page'
import { useNotificationTab, useMarkNotificationsRead } from './hooks'

function wrap(ui, initialEntries = ['/announcements']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

const MOCK_ITEMS = [
  {
    source: 'announcement',
    source_id: '1',
    severity: 'info',
    title: 'Wartungsfenster Samstag',
    summary: 'Server offline 02-04 Uhr',
    created_at: new Date().toISOString(),
    read: false,
    link: { route: '/announcements', modal: null, params: {} },
    meta: {},
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  useMarkNotificationsRead.mockReturnValue({ mutate: vi.fn(), isPending: false })
})

describe('NotificationsHubPage', () => {
  it('zeigt Lade-Zustand', () => {
    useNotificationTab.mockReturnValue({ data: [], isLoading: true })
    wrap(<NotificationsHubPage />)
    expect(screen.getByText('notifications.page_title')).toBeTruthy()
  })

  it('zeigt Tab-Labels', () => {
    useNotificationTab.mockReturnValue({ data: [], isLoading: false })
    wrap(<NotificationsHubPage />)
    expect(screen.getByText('notifications.tab_announcements')).toBeTruthy()
    expect(screen.getByText('notifications.tab_alerts')).toBeTruthy()
    expect(screen.getByText('notifications.tab_events')).toBeTruthy()
  })

  it('zeigt Empty-State wenn keine Items', () => {
    useNotificationTab.mockReturnValue({ data: [], isLoading: false })
    wrap(<NotificationsHubPage />)
    expect(screen.getByText('notifications.tab_empty_announcements')).toBeTruthy()
  })

  it('rendert Notifications-Items', () => {
    useNotificationTab.mockReturnValue({ data: MOCK_ITEMS, isLoading: false })
    wrap(<NotificationsHubPage />)
    expect(screen.getByText('Wartungsfenster Samstag')).toBeTruthy()
  })

  it('zeigt MarkAllReadButton', () => {
    useNotificationTab.mockReturnValue({ data: MOCK_ITEMS, isLoading: false })
    wrap(<NotificationsHubPage />)
    expect(screen.getByText('notifications.mark_all_read')).toBeTruthy()
  })
})
