export type CanteenPublicProfile = {
  email: string;
  connections: Array<{ name: string; createdAt: string }>;
};
export type CanteenPublicStatus = { mailReady: boolean; endpoint: string };
export type CanteenPublicConnection = { token: string; endpoint: string };
const names = ['Profile', 'Status', 'Code', 'Verify', 'Connection', 'Revoke', 'Logout'];
export const QueryKeys = Object.fromEntries(names.map(n => ['canteenPublic' + n, 'canteenPublic' + n]));
export const MutationKeys = QueryKeys;
export class CanteenPublicApiError extends Error {
  constructor(readonly code: string) { super(code); }
}
export async function canteenPublicRequest<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch('/api/canteen-public/' + path, {
    method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new CanteenPublicApiError(result.error ?? 'request_failed');
  return result;
}
