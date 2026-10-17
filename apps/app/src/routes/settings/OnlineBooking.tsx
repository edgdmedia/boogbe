import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { can, OrgSettingsResponse, type UpdateOrgSettingsInput } from '@boogbe/shared';
import { Button, Card, Field, Input, PageHeader, Spinner } from '@boogbe/ui';
import { api, ApiError, useApi } from '../../lib/api';
import { useMe } from '../../lib/use-me';

const MAX_ORIGINS = 5;
const MAX_EMAILS = 5;

const toUrl = (u: string) => {
  try {
    return new URL(u.trim());
  } catch {
    return null;
  }
};
/** Same rule as the API: https, or http only for a local dev server. */
const siteOk = (u: URL | null): u is URL =>
  !!u &&
  (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)));
const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** The website's origin plus its www twin (or the bare twin when www was typed): the browser sends whichever the guest visited. */
export function originsFor(site: string): string[] {
  const u = toUrl(site);
  if (!site.trim() || !siteOk(u)) return [];
  const twin = new URL(u.origin);
  twin.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
  return [u.origin, twin.origin];
}

type Form = { enabled: boolean; holdMinutes: string; site: string; emails: string; extra: string };
type Errors = Partial<Record<keyof Form | 'form', string>>;

function fromSettings(s: OrgSettingsResponse['settings']): Form {
  const derived = new Set(originsFor(s.publicSiteUrl ?? ''));
  return {
    enabled: s.publicEnabled,
    holdMinutes: String(s.publicHoldMinutes),
    site: s.publicSiteUrl ?? '',
    emails: s.notifyEmails.join(', '),
    extra: s.publicOrigins.filter((o) => !derived.has(o)).join(', '),
  };
}

function toInput(v: Form): { input?: UpdateOrgSettingsInput; errors: Errors } {
  const errors: Errors = {};
  const hold = Number(v.holdMinutes);
  if (!Number.isInteger(hold) || hold < 15 || hold > 1440) errors.holdMinutes = 'Use 15 to 1440 minutes';
  const typed = v.site.trim();
  const siteUrl = toUrl(typed);
  if (typed && siteUrl?.protocol !== 'https:')
    errors.site = 'Use your website address, starting with https://';
  // URL lower-cases the scheme and host (HTTPS://Example.com); the API wants a literal https:// prefix.
  const site =
    typed && siteUrl
      ? `${siteUrl.origin}${siteUrl.pathname === '/' ? '' : siteUrl.pathname}${siteUrl.search}${siteUrl.hash}`
      : '';
  const extras = list(v.extra);
  const badExtras = extras.filter((x) => !siteOk(toUrl(x)));
  if (badExtras.length) errors.extra = `Use full addresses starting with https://: ${badExtras.join(', ')}`;
  const emails = [...new Set(list(v.emails).map((x) => x.toLowerCase()))];
  const badEmails = emails.filter((x) => !z.string().email().safeParse(x).success);
  if (badEmails.length) errors.emails = `Check these addresses: ${badEmails.join(', ')}`;
  else if (emails.length > MAX_EMAILS) errors.emails = `Up to ${MAX_EMAILS} addresses`;
  const origins = [...new Set([...originsFor(site), ...extras.map((x) => toUrl(x)?.origin ?? x)])];
  if (!errors.site && !errors.extra && origins.length > MAX_ORIGINS)
    errors.extra = `Up to ${MAX_ORIGINS} sites in all, counting your website and its www address`;
  if (!errors.site && !errors.extra && v.enabled && !origins.length)
    errors.site = 'Add your website address so the booking form works there';
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: {
      publicEnabled: v.enabled,
      publicHoldMinutes: hold,
      publicSiteUrl: site || null,
      publicOrigins: origins,
      notifyEmails: emails,
    },
  };
}

export function OnlineBooking() {
  const { me } = useMe();
  const role = me?.activeOrg?.role;
  const { data, mutate } = useApi('/v1/org/settings', OrgSettingsResponse);
  const loaded = useRef(false);
  const [v, setV] = useState<Form>();
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  // Load once: a revalidation (focus, another tab) must not wipe unsaved edits. A save reloads explicitly.
  useEffect(() => {
    if (data && !loaded.current) {
      loaded.current = true;
      setV(fromSettings(data.settings));
    }
  }, [data]);
  if (role && !can(role, 'org.settings.write'))
    return (
      <div className="flex max-w-3xl flex-col gap-5">
        <PageHeader title="Online booking" />
        <Card>
          <p className="text-sm text-ink-muted">Only admins can change online booking.</p>
        </Card>
      </div>
    );
  if (!data || !v) return <Spinner />;
  const set = (patch: Partial<Form>) => {
    setV({ ...v, ...patch });
    setSaved(false);
  };
  const slug = data.org.slug;
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="Online booking" />
      <Card>
        <p className="mb-4 text-sm text-ink-muted">
          Guests pick dates on your website and send a request. The dates are held while you confirm with them.
        </p>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const { input, errors: errs } = toInput(v);
            setErrors(errs);
            if (!input) return;
            setBusy(true);
            try {
              await api('/v1/org/settings', { method: 'PATCH', body: input });
            } catch (err) {
              setErrors({ form: err instanceof ApiError ? err.message : 'Could not save. Try again.' });
              setBusy(false);
              return;
            }
            setSaved(true);
            setBusy(false);
            const fresh = await mutate().catch(() => undefined);
            if (fresh) setV(fromSettings(fresh.settings));
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Accept booking requests from your website
          </label>
          <Field
            label="Hold requested dates for (minutes)"
            hint="Unconfirmed requests are released after this."
            error={errors.holdMinutes}
          >
            <Input
              type="number"
              min={15}
              max={1440}
              value={v.holdMinutes}
              onChange={(e) => set({ holdMinutes: e.target.value })}
            />
          </Field>
          <Field
            label="Website address"
            hint="The site that shows your booking form, e.g. https://yourbusiness.com"
            error={errors.site}
          >
            <Input type="url" value={v.site} onChange={(e) => set({ site: e.target.value })} />
          </Field>
          <Field
            label="Other sites that can show the booking form"
            hint="Optional, e.g. a test copy of your site. Separate with commas."
            error={errors.extra}
          >
            <Input value={v.extra} onChange={(e) => set({ extra: e.target.value })} />
          </Field>
          <Field
            label="Also email new requests to"
            hint={`Your contact email always gets them. Up to ${MAX_EMAILS}, separated by commas.`}
            error={errors.emails}
          >
            <Input value={v.emails} onChange={(e) => set({ emails: e.target.value })} />
          </Field>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Your booking slug:</span>
            <code className="rounded bg-surface-2 px-2 py-1">{slug}</code>
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(slug);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
            </Button>
            <span className="text-ink-muted">Your website setup needs this.</span>
          </div>
          {errors.form && (
            <p role="alert" className="text-sm text-danger">
              {errors.form}
            </p>
          )}
          <p aria-live="polite" className="text-sm text-ink-muted">
            {saved ? 'Saved.' : ''}
          </p>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </form>
      </Card>
    </div>
  );
}
