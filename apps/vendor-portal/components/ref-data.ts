'use client';
import { useQuery } from '@utsavora/ui';
import type { Category, Occasion, ServiceArea } from '@utsavora/api-client';

export function useRefData() {
  return useQuery('ref', async (api) => {
    const [occasions, categories, areas] = await Promise.all([
      api.get<Occasion[]>('/occasions'),
      api.get<Category[]>('/categories'),
      api.get<ServiceArea[]>('/service-areas'),
    ]);
    return { occasions, categories, areas };
  });
}
