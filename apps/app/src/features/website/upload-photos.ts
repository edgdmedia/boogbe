import { FILE_LIMITS, ListingPhoto, PresignResponse } from '@boogbe/shared';
import { api } from '../../lib/api';

// Same copy the server gives: a refusal the operator can act on, whichever side caught it.
const TYPE_COPY = 'Use a JPEG, PNG or WebP photo.'; // no HEIC — sharp cannot decode it (plan deviation 5)
const SIZE_COPY = `Max ${Math.round(FILE_LIMITS.listing_photo.maxBytes / 1024)} KB`;

/** One file: client checks → presign → PUT → confirm → attach with defaults (blank alt, Living spaces). */
export async function uploadListingPhoto(listingId: string, file: File): Promise<ListingPhoto> {
  if (!FILE_LIMITS.listing_photo.types.includes(file.type)) throw new Error(TYPE_COPY);
  if (file.size > FILE_LIMITS.listing_photo.maxBytes) throw new Error(SIZE_COPY);
  const p = await api('/v1/files/presign', {
    method: 'POST',
    body: { kind: 'listing_photo', contentType: file.type, sizeBytes: file.size },
    schema: PresignResponse,
  });
  const put = await fetch(p.uploadUrl, { method: 'PUT', headers: p.headers, body: file });
  if (!put.ok) throw new Error('Upload failed — check your connection and try again');
  await api(`/v1/files/${p.fileId}/confirm`, { method: 'POST' });
  return api(`/v1/listings/${listingId}/photos`, { method: 'POST', body: { fileId: p.fileId }, schema: ListingPhoto });
}

/** Sequential, as the plan prescribes — parallel PUTs on one listing would fight over sort order. */
export async function uploadListingPhotos(
  listingId: string,
  files: File[],
  onEach?: () => void,
): Promise<{ ok: number; errors: string[] }> {
  const errors: string[] = [];
  let ok = 0;
  for (const f of files) {
    try {
      await uploadListingPhoto(listingId, f);
      ok++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Upload failed');
    }
    onEach?.();
  }
  return { ok, errors };
}
