/**
 * Browser client for the Utsavora API. Each web app proxies /api/* to the API (same origin),
 * so session cookies are first-party and httpOnly. The app header selects the session and
 * protects writes against CSRF.
 */
export type AppAudience = 'customer' | 'vendor' | 'admin';

export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
  /** Field-level validation messages keyed by dotted path. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as FieldIssue[]) if (d && typeof d.path === 'string' && !out[d.path]) out[d.path] = d.message;
    return out;
  }
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export interface Paged<T> {
  data: T[];
  meta: PageMeta;
}

export interface ApiClient {
  get<T>(path: string, query?: Record<string, unknown>): Promise<T>;
  getPage<T>(path: string, query?: Record<string, unknown>): Promise<Paged<T>>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  url(path: string, query?: Record<string, unknown>): string;
}

export function qs(query?: Record<string, unknown>): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function createApiClient(app: AppAudience, base = '/api/v1'): ApiClient {
  async function call(method: string, path: string, body?: unknown, query?: Record<string, unknown>) {
    let res: Response;
    try {
      res = await fetch(`${base}${path}${qs(query)}`, {
        method,
        credentials: 'same-origin',
        headers: { 'x-utsavora-app': app, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Could not reach Utsavora. Check your connection and try again.');
    }
    const text = await res.text();
    let json: { data?: unknown; meta?: PageMeta; error?: { code: string; message: string; details?: unknown } } = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      const e = json.error;
      throw new ApiError(res.status, e?.code ?? 'HTTP_' + res.status, e?.message ?? `Request failed (${res.status})`, e?.details);
    }
    return json;
  }
  return {
    get: async <T>(path: string, query?: Record<string, unknown>) => (await call('GET', path, undefined, query)).data as T,
    getPage: async <T>(path: string, query?: Record<string, unknown>) => {
      const j = await call('GET', path, undefined, query);
      return { data: j.data as T[], meta: j.meta as PageMeta };
    },
    post: async <T>(path: string, body?: unknown) => (await call('POST', path, body ?? {})).data as T,
    put: async <T>(path: string, body?: unknown) => (await call('PUT', path, body ?? {})).data as T,
    del: async <T>(path: string) => (await call('DELETE', path)).data as T,
    url: (path: string, query?: Record<string, unknown>) => `${base}${path}${qs(query)}`,
  };
}

export * from './types';
