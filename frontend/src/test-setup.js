// p3portal.org
import '@testing-library/jest-dom'
import { vi } from 'vitest'

// PROJ-60: Globaler Mock für useCapability – alle Capabilities standardmäßig false (Core-Defaults).
// Tests, die Plus-Verhalten prüfen, können per vi.mocked(useCapability).mockReturnValue(true) überschreiben.
vi.mock('./hooks/useCapability', () => ({
  useCapability: vi.fn().mockReturnValue(false),
  useCapabilities: vi.fn().mockReturnValue({}),
}))
