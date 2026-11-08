// @vitest-environment jsdom
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PublicCanteen from './Public';

vi.mock('./localize', () => ({ useLocalize: () => (key: string) => key }));
let signedIn: boolean;
let invalidCode: boolean;
let revoked: boolean;
const endpoint = 'https://menu.example.com/mcp/canteen-public';
const originalFetch = global.fetch;
const fetcher = vi.fn();

function view() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <PublicCanteen />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  signedIn = false;
  invalidCode = false;
  revoked = false;
  Object.defineProperty(global, 'fetch', { value: fetcher, writable: true, configurable: true });
  fetcher.mockImplementation(async (input: string, options?: RequestInit) => {
    const path = input.split('/api/canteen-public/')[1];
    let status = 200;
    let body: object = {};
    if (path === 'status') body = { mailReady: true, endpoint };
    else if (path === 'profile') {
      status = signedIn ? 200 : 401;
      body = signedIn
        ? {
            email: 'student@example.com',
            connections: revoked ? [] : [{ name: 'DSH', createdAt: '2026-11-08T08:00:00Z' }],
          }
        : { error: 'sign_in_required' };
    } else if (path === 'verify') {
      signedIn = !invalidCode;
      status = invalidCode ? 400 : 200;
      body = invalidCode ? { error: 'invalid_code' } : { email: 'student@example.com' };
    } else if (path === 'connections') {
      if (options?.method === 'DELETE') {
        revoked = true;
        body = { revoked: true };
      } else body = { token: 'basan_test_personal_credential', endpoint };
    } else if (path === 'logout') signedIn = false;
    return { ok: status < 400, status, json: async () => body };
  });
});
afterEach(() => {
  Object.defineProperty(global, 'fetch', {
    value: originalFetch,
    writable: true,
    configurable: true,
  });
  fetcher.mockReset();
});

async function signIn() {
  fireEvent.change(await screen.findByLabelText('com_canteen_public_email'), {
    target: { value: 'student@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'com_canteen_public_send' }));
  expect((await screen.findByRole('status')).textContent).toContain('com_canteen_public_sent');
  fireEvent.change(screen.getByLabelText('com_canteen_public_code'), {
    target: { value: '123456' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'com_canteen_public_verify' }));
}

it('verifies email without a chat account and generates the personal DSH / QQ configuration', async () => {
  view();
  await signIn();
  expect(await screen.findByText('student@example.com')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'com_canteen_public_generate' }));
  const config = await screen.findByText(/transport: streamable-http/);
  expect(config.textContent).toContain("name: '@deepseek-ai/dsh-mcp-client'");
  expect(config.textContent).toContain(endpoint);
  expect(config.textContent).toContain('Bearer basan_test_personal_credential');
  expect(screen.getByText('com_canteen_public_qq_help')).toBeTruthy();
  expect(fetcher.mock.calls.every(([url]) => !url.includes('/api/auth'))).toBe(true);
});

it('keeps the email form available when a verification code is rejected', async () => {
  invalidCode = true;
  view();
  await signIn();
  expect((await screen.findByRole('alert')).textContent).toContain('com_canteen_public_invalid_code');
  expect(screen.getByLabelText('com_canteen_public_email')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'com_canteen_public_generate' }),
  ).toBeNull();
});

it('removes displayed credentials after revocation and returns to email login after logout', async () => {
  signedIn = true;
  view();
  fireEvent.click(await screen.findByRole('button', { name: 'com_canteen_public_generate' }));
  expect(await screen.findByText(/basan_test_personal_credential/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'com_canteen_public_revoke' }));
  expect(await screen.findByText('com_canteen_public_revoked')).toBeTruthy();
  await waitFor(() =>
    expect(screen.queryByText(/basan_test_personal_credential/)).toBeNull(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'com_canteen_public_logout' }));
  expect(await screen.findByLabelText('com_canteen_public_email')).toBeTruthy();
});
