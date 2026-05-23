// p3portal.org
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import AlertRuleFormModal from './AlertRuleFormModal'

describe('AlertRuleFormModal', () => {
  const defaultProps = {
    rule: null,
    onSave: vi.fn(),
    onClose: vi.fn(),
    loading: false,
    error: null,
    plusEnabled: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders "Neue Regel erstellen" for new rule', () => {
    render(<AlertRuleFormModal {...defaultProps} />)
    expect(screen.getByText('Neue Regel erstellen')).toBeInTheDocument()
  })

  it('renders "Regel bearbeiten" when editing existing rule', () => {
    const rule = {
      id: 1, name: 'Test', metric: 'cpu_percent',
      warning_threshold: 80, critical_threshold: 95,
      sustained_polls: 2, enabled: true, notify_recovery: true,
      filesystem: null, webhook_url: null, webhook_token: null, email_recipients: null,
    }
    render(<AlertRuleFormModal {...defaultProps} rule={rule} />)
    expect(screen.getByText('Regel bearbeiten')).toBeInTheDocument()
  })

  it('submits correct payload for cpu_percent metric', () => {
    const onSave = vi.fn()
    render(<AlertRuleFormModal {...defaultProps} onSave={onSave} />)

    fireEvent.change(screen.getByPlaceholderText('z. B. CPU-Auslastung hoch'), { target: { value: 'CPU Alert' } })
    // Set warning threshold
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '80' } }) // warning
    fireEvent.change(inputs[1], { target: { value: '95' } }) // critical

    fireEvent.click(screen.getByText('Speichern'))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'CPU Alert',
      metric: 'cpu_percent',
      warning_threshold: 80,
      critical_threshold: 95,
    }))
  })

  it('forces warning_threshold to null and critical_threshold to 1 for status metric', () => {
    const onSave = vi.fn()
    render(<AlertRuleFormModal {...defaultProps} onSave={onSave} />)

    fireEvent.change(screen.getByPlaceholderText('z. B. CPU-Auslastung hoch'), { target: { value: 'VM Down' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'status' } })
    fireEvent.click(screen.getByText('Speichern'))

    const payload = onSave.mock.calls[0]?.[0]
    expect(payload?.warning_threshold).toBeNull()
    expect(payload?.critical_threshold).toBe(1)
  })

  it('hides webhook fields when plusEnabled is false', () => {
    render(<AlertRuleFormModal {...defaultProps} plusEnabled={false} />)
    expect(screen.queryByText('Webhook-URL')).not.toBeInTheDocument()
    expect(screen.queryByText('E-Mail-Empfänger')).not.toBeInTheDocument()
  })

  it('shows webhook fields when plusEnabled is true', () => {
    render(<AlertRuleFormModal {...defaultProps} plusEnabled={true} />)
    expect(screen.getByText('Webhook-URL')).toBeInTheDocument()
    expect(screen.getByText('E-Mail-Empfänger')).toBeInTheDocument()
  })

  it('calls onClose when Abbrechen is clicked', () => {
    const onClose = vi.fn()
    render(<AlertRuleFormModal {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByText('Abbrechen'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows filesystem input only for disk_percent metric', () => {
    render(<AlertRuleFormModal {...defaultProps} />)
    // cpu_percent by default - no filesystem
    expect(screen.queryByText('Dateisystem (optional)')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'disk_percent' } })
    expect(screen.getByText('Dateisystem (optional)')).toBeInTheDocument()
  })

  it('displays error message when error prop is set', () => {
    render(<AlertRuleFormModal {...defaultProps} error="Fehler beim Speichern" />)
    expect(screen.getByText('Fehler beim Speichern')).toBeInTheDocument()
  })

  it('disables save button when loading is true', () => {
    render(<AlertRuleFormModal {...defaultProps} loading={true} />)
    expect(screen.getByText('Speichern…')).toBeInTheDocument()
    expect(screen.getByText('Speichern…').closest('button')).toBeDisabled()
  })

  // BUG-34-3 fix: status metric must send critical_threshold=1 (sentinel) to satisfy backend validation
  it('BUG-34-3 fix: status metric sends critical_threshold=1 (not null) to prevent backend 422', () => {
    const onSave = vi.fn()
    render(<AlertRuleFormModal {...defaultProps} onSave={onSave} />)

    fireEvent.change(screen.getByPlaceholderText('z. B. CPU-Auslastung hoch'), { target: { value: 'VM Stopped' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'status' } })
    fireEvent.click(screen.getByText('Speichern'))

    const payload = onSave.mock.calls[0]?.[0]
    // Status metric: warning must be null, critical must be 1 (sentinel for backend validation)
    expect(payload?.warning_threshold).toBeNull()
    expect(payload?.critical_threshold).toBe(1)
  })
})
