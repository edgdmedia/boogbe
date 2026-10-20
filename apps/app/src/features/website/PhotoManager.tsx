import { useEffect, useRef, useState } from 'react';
import { can, PHOTO_CATEGORIES, type ListingPhoto } from '@boogbe/shared';
import { Badge, Button, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { useListing } from './hooks';
import { uploadListingPhotos } from './upload-photos';

/**
 * The listing's photos: upload several at once (sequential), describe each (alt is what the
 * publish blocker watches), categorise, set the cover, drag to order. A processing photo refetches
 * the listing every 5 s until it settles; a failed one offers no retry beyond re-uploading.
 */
export function PhotoManager({ listingId }: { listingId: string }) {
  const { data: listing, mutate } = useListing(listingId);
  const { me } = useMe();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dragFrom = useRef<string | null>(null);
  const canWrite = !!me?.activeOrg && can(me.activeOrg.role, 'inventory.write');
  const pending = !!listing?.photos.some((p) => !p.ready && !p.failed);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void mutate(), 5000);
    return () => clearInterval(timer);
  }, [pending, mutate]);

  if (!listing) return null;

  const patch = async (photoId: string, body: Record<string, unknown>) => {
    await api(`/v1/listings/${listingId}/photos/${photoId}`, { method: 'PATCH', body });
    await mutate();
  };

  const drop = async (targetId: string) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (!from || from === targetId) return;
    const ids = listing.photos.map((p) => p.id);
    const i = ids.indexOf(from);
    const j = ids.indexOf(targetId);
    ids.splice(j, i < j ? -1 : 1, from);
    await api(`/v1/listings/${listingId}/photos/order`, { method: 'PUT', body: { ids } });
    await mutate();
  };

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <p className="eyebrow text-ink-muted">Photos</p>
        {pending && <span className="text-xs text-ink-muted">Processing takes under a minute.</span>}
        {canWrite && (
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => document.getElementById('listing-photo-picker')?.click()}
          >
            Upload photos
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
      <input
        id="listing-photo-picker"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          setError(null);
          const r = await uploadListingPhotos(listingId, files, () => void mutate());
          if (r.errors.length) setError(r.errors[0]!);
          setBusy(false);
        }}
      />
      {listing.photos.length === 0 && !busy && (
        <p className="text-sm text-ink-muted">No photos yet. Publishing needs at least three, each described.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {listing.photos.map((p, i) => (
          <div
            key={p.id}
            draggable={canWrite && p.ready}
            onDragStart={() => (dragFrom.current = p.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => void drop(p.id)}
            className="flex flex-col gap-2 rounded-control border border-line bg-surface-2 p-2.5"
          >
            <Thumb photo={p} index={i} />
            <div className="flex flex-wrap items-center gap-1.5">
              {listing.coverPhotoId === p.id && <Badge tone="success">Cover</Badge>}
              {!p.alt && <Badge tone="warning">Needs description</Badge>}
            </div>
            <input
              aria-label="Photo description"
              defaultValue={p.alt}
              disabled={!canWrite}
              placeholder="Describe this photo, e.g. Living room, sea view"
              className="h-9 rounded-control border border-line bg-surface px-2.5 text-sm disabled:opacity-60"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== p.alt) void patch(p.id, { alt: v });
              }}
            />
            <div className="flex items-center gap-2">
              <select
                aria-label={`Category for photo ${i + 1}`}
                value={p.category}
                disabled={!canWrite}
                className="h-9 flex-1 rounded-control border border-line bg-surface px-2 text-sm disabled:opacity-60"
                onChange={(e) => void patch(p.id, { category: e.target.value })}
              >
                {PHOTO_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {canWrite && (
                <>
                  {!pending && p.ready && listing.coverPhotoId !== p.id && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        await api(`/v1/listings/${listingId}/cover`, { method: 'PUT', body: { photoId: p.id } });
                        await mutate();
                      }}
                    >
                      Set as cover
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Delete photo ${i + 1}`}
                    onClick={async () => {
                      await api(`/v1/listings/${listingId}/photos/${p.id}`, { method: 'DELETE' });
                      await mutate();
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {busy && <Spinner />}
    </div>
  );
}

function Thumb({ photo, index }: { photo: ListingPhoto; index: number }) {
  if (photo.failed)
    return (
      <div className="grid h-32 place-items-center rounded-control border border-danger/30 bg-surface px-3 text-center text-xs font-medium text-danger">
        Couldn&rsquo;t process this photo &ndash; try another file
      </div>
    );
  if (!photo.ready)
    return (
      <div className="grid h-32 place-items-center gap-2 rounded-control border border-line bg-surface text-sm text-ink-muted">
        <Spinner /> Processing…
      </div>
    );
  return <img src={photo.previewUrl ?? ''} alt={photo.alt || `Photo ${index + 1}`} className="h-32 w-full rounded-control object-cover" />;
}
