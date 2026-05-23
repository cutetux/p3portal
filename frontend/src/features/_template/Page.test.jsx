// p3portal.org
// PROJ-XX: Vitest-Tests für FEATUREPage.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}));

// Mock the hook so we can control what the page renders
vi.mock('./hooks/useFEATUREs', () => ({
  useFEATUREs: vi.fn(),
}));

import FEATUREPage from './Page';
import { useFEATUREs } from './hooks/useFEATUREs';

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('FEATUREPage', () => {
  it('shows loading state', () => {
    useFEATUREs.mockReturnValue({ data: undefined, isLoading: true, error: null });
    wrap(<FEATUREPage />);
    expect(screen.getByText('common.loading')).toBeTruthy();
  });

  it('shows error state', () => {
    useFEATUREs.mockReturnValue({ data: undefined, isLoading: false, error: new Error('fail') });
    wrap(<FEATUREPage />);
    expect(screen.getByText('fail')).toBeTruthy();
  });

  it('shows empty state', () => {
    useFEATUREs.mockReturnValue({ data: [], isLoading: false, error: null });
    wrap(<FEATUREPage />);
    expect(screen.getByText('feature.empty')).toBeTruthy();
  });

  it('renders items', () => {
    useFEATUREs.mockReturnValue({
      data: [{ id: 1, name: 'Alpha' }],
      isLoading: false,
      error: null,
    });
    wrap(<FEATUREPage />);
    expect(screen.getByText('Alpha')).toBeTruthy();
  });
});
