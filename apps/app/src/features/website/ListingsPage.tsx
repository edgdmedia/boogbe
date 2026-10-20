import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Dialog, EmptyState, Field, Input, PageHeader, Spinner } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { can, Listing } from '@boogbe/shared';
import { useMe } from '../../lib/use-me';
import { useListings, useOrgSettings } from './hooks';

/** Drag rows to set the website's display order; saved straight to PUT /v1/listings/order. */
export function ListingsPage() {
  const { data, mutate } = useListings();
  const { data: orgSettings } = useOrgSettings();
  const { me } = useMe();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const canWrite = !!me?.activeOrg && can(me.activeOrg.role, 'inventory.write');
  if (!data) return <Spinner />;
  const siteUrl = orgSettings?.settings.publicSiteUrl;

  const drop = async (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = data.items.map((l) => l.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, from < to ? -1 : 1, dragId); // move the dragged id to the target's slot
    setDragId(null);
    await api('/v1/listings/order', { method: 'PUT', body: { ids } });
    await mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Website listings"
        eyebrow="What guests see on your website — changes go live within about a minute."
        actions={canWrite && <Button onClick={() => setOpen(true)}>New listing</Button>}
      />
      {data.items.length === 0 ? (
        <EmptyState icon={<Building2 />} title="No listings yet" body="A listing is one apartment page: its words, photos and units." />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((l) => (
            <li
              key={l.id}
              role="listitem"
              draggable={canWrite}
              onDragStart={() => setDragId(l.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void drop(l.id)}
              className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-card"
            >
              <Cover listing={l} />
              <button className="min-w-0 flex-1 text-left" onClick={() => nav(`/website/listings/${l.id}`)}>
                <span className="block truncate font-semibold text-ink">{l.name || 'Untitled'}</span>
                <span className="block text-[13px] text-ink-muted">
                  {l.units.length} unit{l.units.length === 1 ? '' : 's'}
                  {l.slug ? ` · /short-lets/${l.slug}/` : ''}
                </span>
              </button>
              {l.published ? <Badge tone="success">Published</Badge> : <Badge>Draft</Badge>}
              {l.published && siteUrl && (
                <a
                  href={`${siteUrl.replace(/\/+$/, '')}/short-lets/${l.slug}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-[13px] font-semibold text-brand hover:underline"
                >
                  View on website
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="New listing">
        <NewListingForm
          onCreated={async (l) => {
            setOpen(false);
            await mutate();
            nav(`/website/listings/${l.id}`);
          }}
        />
      </Dialog>
    </div>
  );
}

function Cover({ listing }: { listing: Listing }) {
  const cover = listing.photos.find((p) => p.id === listing.coverPhotoId)?.previewUrl ?? listing.photos.find((p) => p.previewUrl)?.previewUrl;
  if (!cover)
    return (
      <span className="grid size-12 shrink-0 place-items-center rounded-chip border border-line bg-surface-2 text-ink-muted" aria-hidden="true">
        <Building2 size={18} />
      </span>
    );
  return <img src={cover} alt="" className="size-12 shrink-0 rounded-chip border border-line object-cover" />;
}

function NewListingForm({ onCreated }: { onCreated: (l: Listing) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onCreated(await api('/v1/listings', { method: 'POST', body: { name }, schema: Listing }));
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Something went wrong');
          setBusy(false);
        }
      }}
    >
      <Field label="Name" error={error ?? undefined}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Destiny" />
      </Field>
      <Button type="submit" loading={busy}>
        Create
      </Button>
    </form>
  );
}
