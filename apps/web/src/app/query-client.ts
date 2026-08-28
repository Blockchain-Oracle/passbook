import { QueryClient } from '@tanstack/react-query'

// Chain reads are cheap to repeat and expensive to show stale: short staleTime, refetch on focus.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})
