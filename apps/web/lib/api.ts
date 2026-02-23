export class ApiError extends Error {
  statusCode: number;
  code?: string;
  details?: unknown;

  constructor(message: string, statusCode: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    return 'http://localhost:3333';
  }
  return url.replace(/\/$/, '');
}

export async function apiRequest<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    token?: string | null;
    signal?: AbortSignal;
  },
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options?.signal,
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string; code?: string; details?: unknown } }
    | null;

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      payload?.error?.code,
      payload?.error?.details,
    );
  }

  return payload as T;
}

