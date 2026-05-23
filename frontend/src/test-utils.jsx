// p3portal.org
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Returns a React wrapper component with a fresh QueryClient per test.
 * retry: false prevents React Query from retrying failed requests in tests.
 */
export function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchInterval: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}
