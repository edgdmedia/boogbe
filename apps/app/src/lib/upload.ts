import { FILE_LIMITS, PresignResponse, type FileKind } from '@boogbe/shared';
import { api } from './api';

export async function uploadFile(kind: FileKind, file: File): Promise<string> {
  const lim = FILE_LIMITS[kind];
  if (!lim.types.includes(file.type)) throw new Error(`Use ${lim.types.map((t) => t.split('/')[1]).join(', ')}`);
  if (file.size > lim.maxBytes) throw new Error(`Max ${Math.round(lim.maxBytes / 1024)} KB`);
  const p = await api('/v1/files/presign', {
    method: 'POST',
    body: { kind, contentType: file.type, sizeBytes: file.size },
    schema: PresignResponse,
  });
  const put = await fetch(p.uploadUrl, { method: 'PUT', headers: p.headers, body: file });
  if (!put.ok) throw new Error('Upload failed — check your connection and try again');
  await api(`/v1/files/${p.fileId}/confirm`, { method: 'POST' });
  return p.fileId;
}
