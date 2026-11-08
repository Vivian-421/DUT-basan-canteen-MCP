import { useState } from 'react';
import { ArrowRight, CheckCircle2, LoaderCircle, Mail, UtensilsCrossed } from 'lucide-react';
import { Button, Input } from './ui';
import { CanteenPublicApiError } from './api';
import type { FormEvent } from 'react';
import type { TranslationKeys } from './localize';
import { usePublicCanteen } from './queries';
import { useLocalize } from './localize';

const errors: Record<string, TranslationKeys> = {
  mail_not_configured: 'com_canteen_public_mail_unavailable',
  mail_send_failed: 'com_canteen_public_mail_failed',
  wait_before_resending: 'com_canteen_public_wait',
  invalid_code: 'com_canteen_public_invalid_code',
  invalid_input: 'com_canteen_public_invalid_input',
  sign_in_required: 'com_canteen_public_sign_in_again',
};

export default function PublicCanteen() {
  const localize = useLocalize();
  const api = usePublicCanteen();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('DSH');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const error =
    api.status.error ??
    api.profile.error ??
    api.code.error ??
    api.verify.error ??
    api.connection.error ??
    api.revoke.error ??
    api.logout.error;
  const errorKey = error instanceof CanteenPublicApiError ? errors[error.code] : undefined;
  const credential = api.connection.data;
  const config = credential
    ? [
        '- id: basan-menu',
        "  name: '@deepseek-ai/dsh-mcp-client'",
        '  config:',
        '    serverName: basan',
        '    transport: streamable-http',
        `    url: ${credential.endpoint}`,
        '    headers:',
        `      Authorization: 'Bearer ${credential.token}'`,
      ].join('\n')
    : '';
  const inputClass = 'h-12 bg-surface-primary text-base shadow-sm';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(config);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  };
  const verify = (event: FormEvent) => {
    event.preventDefault();
    api.verify.mutate({ email: email.trim(), code });
  };
  return (
    <main className="min-h-screen bg-surface-primary px-5 py-10 text-text-primary sm:px-8 sm:py-16">
      <div className={`mx-auto flex flex-col gap-7 ${api.profile.data ? 'max-w-2xl' : 'max-w-lg'}`}>
        <header className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-green-500/10 text-green-600 dark:text-green-400">
              <UtensilsCrossed className="size-5" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {localize('com_canteen_public_title')}
            </h1>
          </div>
          <p className="text-sm leading-7 text-text-secondary sm:text-base">
            {localize('com_canteen_public_intro')}
          </p>
        </header>
        {(api.status.isLoading || api.profile.isLoading) && (
          <p role="status">{localize('com_relay_loading')}</p>
        )}
        {error != null && (
          <p role="alert" className="rounded-xl bg-surface-secondary px-4 py-3 text-sm">
            {localize(errorKey ?? 'com_relay_action_failed')}
          </p>
        )}
        {api.status.data && !api.status.data.mailReady && (
          <p role="alert">{localize('com_canteen_public_mail_unavailable')}</p>
        )}
        {api.profile.data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light pb-4">
              <p>{api.profile.data.email}</p>
              <button
                type="button"
                onClick={() => api.logout.mutate()}
                disabled={api.logout.isLoading}
                className="underline"
              >
                {localize('com_canteen_public_logout')}
              </button>
            </div>
            <section className="space-y-4">
              <h2 className="text-xl font-semibold">{localize('com_canteen_public_connect')}</h2>
              <p>{localize('com_canteen_public_key_help')}</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setCopied(false);
                  api.revoke.reset();
                  api.connection.mutate(name);
                }}
                className="flex flex-col gap-3 sm:flex-row"
              >
                <label className="flex-1">
                  <span className="mb-1 block text-sm">
                    {localize('com_canteen_public_connection_name')}
                  </span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={60}
                    required
                    className={inputClass}
                  />
                </label>
                <Button
                  type="submit"
                  disabled={api.connection.isLoading || !name.trim()}
                  className="h-12 self-end"
                >
                  {localize('com_canteen_public_generate')}
                </Button>
              </form>
              {credential && (
                <>
                  <p>{localize('com_canteen_public_config_help')}</p>
                  <pre className="overflow-x-auto border-y border-border-light py-4 text-sm">
                    <code>{config}</code>
                  </pre>
                  <Button type="button" onClick={copy}>
                    {localize(copied ? 'com_canteen_public_copied' : 'com_canteen_public_copy')}
                  </Button>
                  {copyFailed && <p role="alert">{localize('com_canteen_public_copy_failed')}</p>}
                </>
              )}
            </section>
            <section className="space-y-3 border-t border-border-light pt-5">
              <h2 className="text-xl font-semibold">{localize('com_canteen_public_qq_title')}</h2>
              <p>{localize('com_canteen_public_qq_help')}</p>
              <p className="text-sm text-text-secondary">
                {localize('com_canteen_public_private_connection')}
              </p>
              <p>{localize('com_canteen_public_try')}</p>
            </section>
            <section className="space-y-3 border-t border-border-light pt-5">
              <h2 className="text-xl font-semibold">
                {localize('com_canteen_public_connections')}
              </h2>
              {api.profile.data.connections.length ? (
                <ul className="divide-y divide-border-light">
                  {api.profile.data.connections.map((item, index) => (
                    <li key={index} className="flex justify-between gap-3 py-2">
                      <span>{item.name}</span>
                      <time dateTime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{localize('com_canteen_public_empty')}</p>
              )}
              <button
                type="button"
                disabled={api.revoke.isLoading || !api.profile.data.connections.length}
                onClick={() => {
                  api.revoke.mutate(undefined, { onSuccess: () => api.connection.reset() });
                }}
                className="underline disabled:opacity-50"
              >
                {localize('com_canteen_public_revoke')}
              </button>
              {api.revoke.isSuccess && (
                <p role="status">{localize('com_canteen_public_revoked')}</p>
              )}
            </section>
          </>
        )}
        {!api.profile.data && api.profile.isSuccess && api.status.data?.mailReady && (
          <form
            onSubmit={verify}
            aria-busy={api.verify.isLoading}
            className="bg-surface-secondary/40 space-y-6 rounded-2xl border border-border-light p-6 shadow-sm sm:p-8"
          >
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight">
                {localize('com_canteen_public_login')}
              </h2>
              <p className="text-sm leading-6 text-text-secondary">
                {localize('com_canteen_public_login_help')}
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="canteen-email" className="block text-sm font-medium">
                {localize('com_canteen_public_email')}
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Mail
                    className="pointer-events-none absolute left-3.5 top-4 size-4 text-text-secondary"
                    aria-hidden="true"
                  />
                  <Input
                    id="canteen-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setCode('');
                      api.code.reset();
                    }}
                    required
                    className={inputClass + ' pl-10'}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    api.verify.reset();
                    api.code.mutate(email.trim());
                  }}
                  disabled={api.code.isLoading || !email.trim()}
                  aria-busy={api.code.isLoading}
                  className="h-12 shrink-0 bg-surface-primary px-4"
                >
                  {api.code.isLoading && (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  )}
                  {localize('com_canteen_public_send')}
                </Button>
              </div>
              {api.code.isSuccess && (
                <p
                  role="status"
                  className="flex items-start gap-2 pt-1 text-sm leading-6 text-green-700 dark:text-green-400"
                >
                  <CheckCircle2 className="mt-1 size-4 shrink-0" aria-hidden="true" />
                  {localize('com_canteen_public_sent')}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="canteen-code" className="block text-sm font-medium">
                {localize('com_canteen_public_code')}
              </label>
              <Input
                id="canteen-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={localize('com_canteen_public_code_placeholder')}
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
                className={
                  inputClass +
                  ' text-center font-mono text-lg tracking-[0.4em] placeholder:font-sans placeholder:text-sm placeholder:tracking-normal'
                }
              />
            </div>
            <Button
              type="submit"
              disabled={api.verify.isLoading || code.length !== 6}
              variant="submit"
              className="h-12 w-full"
            >
              {api.verify.isLoading ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {localize('com_canteen_public_verify')}
              {!api.verify.isLoading && <ArrowRight className="size-4" aria-hidden="true" />}
            </Button>
          </form>
        )}
        <p className="text-sm leading-6 text-text-secondary">
          {localize('com_canteen_public_snapshot')}
        </p>
      </div>
    </main>
  );
}
