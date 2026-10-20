import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  can,
  Listing,
  ListingInput,
  publishBlockers,
  slugify,
} from '@boogbe/shared';
import { Badge, Button, Field, Input, PageHeader, Spinner, Textarea } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { useProperties, useUnits } from '../inventory/hooks';
import { useListing } from './hooks';
import { ChipListInput } from './ChipListInput';
import { ListingUnitsField, type UnitPick } from './ListingUnitsField';
import { PhotoManager } from './PhotoManager';

interface Form {
  name: string;
  slug: string;
  area: string;
  highlight: string;
  intro: string;
  description: string;
  amenities: string[];
  houseRules: string[];
  bathroomsLabel: string;
  layoutLabel: string;
  seoTitle: string;
  seoDescription: string;
}

const fromListing = (l: Listing): Form => ({
  name: l.name,
  slug: l.slug,
  area: l.area ?? '',
  highlight: l.highlight ?? '',
  intro: l.intro ?? '',
  description: l.description ?? '',
  amenities: l.amenities,
  houseRules: l.houseRules,
  bathroomsLabel: l.bathroomsLabel ?? '',
  layoutLabel: l.layoutLabel ?? '',
  seoTitle: l.seoTitle ?? '',
  seoDescription: l.seoDescription ?? '',
});

const trim = (s: string) => s.trim();
const blank = (s: string) => (trim(s) === '' ? null : trim(s));

/**
 * The listing editor (T-WL-07). Text and units save together; publishing is refused while the
 * shared `publishBlockers` list is not empty. A 409 STALE means someone else saved first.
 */
export function ListingEditor() {
  const { id } = useParams<{ id: string }>();
  const { data: listing, mutate } = useListing(id ?? null);
  const { me } = useMe();
  const { data: unitsData } = useUnits();
  const { data: propertiesData } = useProperties();
  const [form, setForm] = useState<Form | null>(null);
  const [picked, setPicked] = useState<UnitPick[]>([]);
  const [stale, setStale] = useState<{ at: string; by: string | null } | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [textErrors, setTextErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const canWrite = !!me?.activeOrg && can(me.activeOrg.role, 'inventory.write');

  useEffect(() => {
    if (!listing || form !== null) return;
    setForm(fromListing(listing));
    setPicked(listing.units.map((u) => ({ unitId: u.id, label: u.label })));
  }, [listing, form]);

  if (!listing || !form) return <Spinner />;

  const set = (patch: Partial<Form>) => {
    setForm({ ...form, ...patch });
    setSavedMsg(false);
  };

  const blockers = publishBlockers({
    name: form.name,
    intro: blank(form.intro),
    description: blank(form.description),
    coverPhotoId: listing.coverPhotoId,
    units: listing.units,
    photos: listing.photos,
  });

  const picks = picked.map((p) => ({ unitId: p.unitId, label: p.label?.trim() || null }));
  const unitsChanged = JSON.stringify([...picks].sort((a, b) => a.unitId.localeCompare(b.unitId))) !== JSON.stringify([...listing.units.map((u) => ({ unitId: u.id, label: u.label }))].sort((a, b) => a.unitId.localeCompare(b.unitId)));
  const slugTouched = form.slug !== listing.slug;
  const autoSlug = !listing.slug && !trim(form.slug) ? slugify(form.name) : '';
  const shownSlug = form.slug || autoSlug;

  const body = (): Record<string, unknown> => ({
    name: trim(form.name),
    ...(slugTouched || autoSlug ? { slug: trim(shownSlug) || undefined } : {}),
    area: blank(form.area),
    highlight: blank(form.highlight),
    intro: blank(form.intro),
    description: blank(form.description),
    amenities: form.amenities,
    houseRules: form.houseRules,
    bathroomsLabel: blank(form.bathroomsLabel),
    layoutLabel: blank(form.layoutLabel),
    seoTitle: blank(form.seoTitle),
    seoDescription: blank(form.seoDescription),
  });

  const save = async () => {
    const parsed = ListingInput.partial().safeParse(body());
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0] ?? 'form')] ??= issue.message;
      setTextErrors(errs);
      return;
    }
    setTextErrors({});
    setUnitsError(null);
    setStale(null);
    setBusy(true);
    try {
      // The freshest loaded updatedAt, not one captured at mount: this page's own photo manager
      // bumps the listing too, and that must not read as a conflict.
      const patch = { ...body(), expectedUpdatedAt: listing.updatedAt };
      const updated = await api(`/v1/listings/${listing.id}`, { method: 'PATCH', body: patch, schema: Listing });
      if (unitsChanged) {
        try {
          await api(`/v1/listings/${listing.id}/units`, { method: 'PUT', body: picks });
        } catch (err) {
          if (err instanceof ApiError && (err.code === 'UNIT_LINKED' || err.code === 'VALIDATION_FAILED')) setUnitsError(err.message);
          else throw err;
        }
      }
      setForm(fromListing(updated));
      setPicked(updated.units.map((u) => ({ unitId: u.id, label: u.label })));
      setSavedMsg(true);
      await mutate();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE') {
        const d = err.details as { updatedAt?: string; updatedBy?: string | null };
        setStale({ at: d?.updatedAt ?? '', by: d?.updatedBy ?? null });
      } else if (err instanceof ApiError && err.code === 'SLUG_TAKEN') {
        setTextErrors({ slug: err.message });
      }
    } finally {
      setBusy(false);
    }
  };

  const setPublished = async (publish: boolean) => {
    setBusy(true);
    try {
      const updated = await api(`/v1/listings/${listing.id}/${publish ? 'publish' : 'unpublish'}`, { method: 'POST', schema: Listing });
      setForm(fromListing(updated));
      await mutate();
    } catch (err) {
      if (err instanceof ApiError) setTextErrors({ publish: err.message });
    } finally {
      setBusy(false);
    }
  };

  const E = (key: keyof Form | 'publish') => textErrors[key];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={form.name || 'Untitled listing'}
        back={
          <Link to="/website/listings" className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted hover:text-ink">
            <ArrowLeft size={15} aria-hidden /> Listings
          </Link>
        }
        meta={listing.published ? <Badge tone="success">Published</Badge> : <Badge>Draft</Badge>}
        actions={
          canWrite && (
            <div className="flex items-center gap-2">
              {savedMsg && <span className="text-[13px] font-medium text-success">Saved. Live on your website within a minute.</span>}
              <Button onClick={save} loading={busy}>
                Save
              </Button>
            </div>
          )
        }
      />

      {stale && (
        <div role="alert" className="rounded-control border border-warning/40 bg-surface px-3 py-2 text-[13px] font-medium text-ink">
          Someone else updated this listing at {stale.at}
          {stale.by ? ` by ${stale.by}` : ''}.{' '}
          <button className="font-bold text-brand hover:underline" onClick={() => void mutate()}>
            Reload
          </button>{' '}
          to see their changes.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <Field label="Name" error={E('name')}>
            <Input value={form.name} disabled={!canWrite} onChange={(e) => set({ name: e.target.value, ...(listing.slug === '' && form.slug === '' ? { slug: slugify(e.target.value) } : {}) })} />
          </Field>
          <Field
            label="Address ending (slug)"
            hint={`The page lives at /short-lets/${shownSlug || '…'}/`}
            error={E('slug')}
          >
            <Input value={shownSlug} disabled={!canWrite} onChange={(e) => set({ slug: e.target.value })} />
          </Field>
          {canWrite && slugTouched && listing.published && (
            <p className="text-xs font-medium text-info">The old address will redirect to the new one.</p>
          )}
          <Field label="Area" hint="e.g. Ikate, Lekki" error={E('area')}>
            <Input value={form.area} disabled={!canWrite} onChange={(e) => set({ area: e.target.value })} />
          </Field>
          <Field label="Highlight" hint="One short line under the name." error={E('highlight')}>
            <Input value={form.highlight} disabled={!canWrite} onChange={(e) => set({ highlight: e.target.value })} />
          </Field>
          <Field label="Intro" error={E('intro')}>
            <Textarea rows={2} value={form.intro} disabled={!canWrite} onChange={(e) => set({ intro: e.target.value })} />
          </Field>
          <Field label="Description" error={E('description')}>
            <Textarea rows={6} value={form.description} disabled={!canWrite} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>

        <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <ChipListInput label="Amenities" value={form.amenities} disabled={!canWrite} placeholder="e.g. 24/7 power" onChange={(v) => set({ amenities: v })} />
          <ChipListInput label="House rules" value={form.houseRules} disabled={!canWrite} placeholder="e.g. No smoking" onChange={(v) => set({ houseRules: v })} />
          <Field label="Bathrooms" hint='Free text, e.g. "2 bathrooms · 3 toilets".' error={E('bathroomsLabel')}>
            <Input value={form.bathroomsLabel} disabled={!canWrite} onChange={(e) => set({ bathroomsLabel: e.target.value })} />
          </Field>
          <Field label="Layout" hint="Leave empty to let the site derive it from the units." error={E('layoutLabel')}>
            <Input value={form.layoutLabel} disabled={!canWrite} onChange={(e) => set({ layoutLabel: e.target.value })} />
          </Field>
          <Field label="SEO title" error={E('seoTitle')}>
            <Input value={form.seoTitle} disabled={!canWrite} onChange={(e) => set({ seoTitle: e.target.value })} />
          </Field>
          <Field label="SEO description" error={E('seoDescription')}>
            <Input value={form.seoDescription} disabled={!canWrite} onChange={(e) => set({ seoDescription: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
        <p className="eyebrow text-ink-muted">Units on this page</p>
        <ListingUnitsField
          units={(unitsData?.items ?? []) as never}
          propertyNames={new Map((propertiesData?.items ?? []).map((p) => [p.id, p.name]))}
          value={picked}
          disabled={!canWrite}
          error={unitsError}
          onChange={setPicked}
        />
      </div>

      <PhotoManager listingId={listing.id} />

      {canWrite && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
          <p className="eyebrow text-ink-muted">Publishing</p>
          {blockers.length > 0 && (
            <ul className="list-disc pl-5 text-[13px] text-ink-muted">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {E('publish') && (
            <p role="alert" className="text-xs font-medium text-danger">
              {E('publish')}
            </p>
          )}
          <div className="flex items-center gap-2">
            {listing.published ? (
              <Button variant="secondary" loading={busy} onClick={() => void setPublished(false)}>
                Unpublish
              </Button>
            ) : (
              <Button loading={busy} disabled={blockers.length > 0} onClick={() => void setPublished(true)}>
                Publish
              </Button>
            )}
            <span className="text-xs text-ink-muted">
              {listing.published ? 'Live on your website.' : 'Publishing needs every blocker cleared.'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
