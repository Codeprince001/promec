import { z } from 'zod';
import { useDesk } from './desk';
import { useSession } from './session';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const errorBody = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
});

const tokenBody = z.object({
  data: z.object({ accessToken: z.string().optional(), mfaRequired: z.boolean().optional() }).optional(),
});

export class ApiError extends Error {
  code: string;
  constructor(message: string, code = 'ERROR') {
    super(message);
    this.code = code;
  }
}

type Options = RequestInit & { token?: string | null; guest?: boolean };

export async function api<T>(path: string, init: Options = {}): Promise<T> {
  return request<T>(path, init, true);
}

async function request<T>(path: string, init: Options, retry: boolean): Promise<T> {
  const token = init.token === undefined ? useSession.getState().token : init.token;
  const guest = useDesk.getState().guestToken;
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (guest && init.guest !== false) headers.set('x-guest-token', guest);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  const json = await response.json().catch(() => null);
  if (response.status === 401 && retry && token) {
    const refreshed = await refreshAccess();
    if (refreshed) return request<T>(path, init, false);
  }
  if (!response.ok) {
    const parsed = errorBody.safeParse(json);
    throw new ApiError(parsed.success ? parsed.data.error?.message ?? 'The request failed' : 'The request failed', parsed.success ? parsed.data.error?.code ?? 'ERROR' : 'ERROR');
  }
  return json as T;
}

export async function refreshAccess() {
  const response = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  const json = await response.json().catch(() => null);
  const parsed = tokenBody.safeParse(json);
  const token = parsed.success ? parsed.data.data?.accessToken : undefined;
  if (!response.ok || !token) {
    useSession.getState().setToken(null);
    return false;
  }
  useSession.getState().setToken(token);
  return true;
}

export function unwrap<T>(body: { data: T } | T): T {
  if (body && typeof body === 'object' && 'data' in body) return (body as { data: T }).data;
  return body as T;
}

export async function rememberCart<T extends { data?: { guestToken?: string | null }; meta?: { guestToken?: string | null } }>(path: string, init?: Options) {
  const body = await api<T>(path, init);
  const guestToken = body.meta?.guestToken ?? body.data?.guestToken;
  if (guestToken) useDesk.getState().setGuestToken(guestToken);
  return body;
}
