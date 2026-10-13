'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, createApiClient, type ApiClient, type AppAudience, type Me } from '@utsavora/api-client';

const ApiContext = createContext<ApiClient | null>(null);
const MeContext = createContext<{ me: Me | null; loading: boolean; reload: () => Promise<void> } | null>(null);

/** Provides the API client and the signed-in user for one app. */
export function AppProviders({ app, children }: { app: AppAudience; children: ReactNode }) {
  const api = useMemo(() => createApiClient(app), [app]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return (
    <ApiContext.Provider value={api}>
      <MeContext.Provider value={{ me, loading, reload }}>{children}</MeContext.Provider>
    </ApiContext.Provider>
  );
}

export function useApi(): ApiClient {
  const c = useContext(ApiContext);
  if (!c) throw new Error('useApi outside AppProviders');
  return c;
}

export function useMe() {
  const c = useContext(MeContext);
  if (!c) throw new Error('useMe outside AppProviders');
  return c;
}

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

/** Minimal data loader: refetches when `key` changes; pass null to skip. */
export function useQuery<T>(key: string | null, fetcher: (api: ApiClient) => Promise<T>): QueryState<T> {
  const api = useApi();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(key !== null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (key === null) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await fetcherRef.current(api);
      if (mine === seq.current) setData(d);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Something went wrong.'));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [api, key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Wraps a write: tracks pending state and the last error, rethrows nothing. */
export function useAction<A extends unknown[], R>(fn: (api: ApiClient, ...args: A) => Promise<R>) {
  const api = useApi();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setError(null);
      try {
        return await fn(api, ...args);
      } catch (e) {
        setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Something went wrong.'));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [api, fn],
  );
  return { run, pending, error, setError };
}

export { ApiError };
