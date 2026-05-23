// p3portal.org
// PROJ-XX: React-Query-Hook für die FEATURE-Liste.
import { useQuery } from '@tanstack/react-query';
import { featuresApi } from '../api';

export function useFEATUREs() {
  return useQuery({
    queryKey: ['features'],
    queryFn: featuresApi.list,
    staleTime: 30_000,
  });
}
