import { useState, type ChangeEvent } from 'react';
import { Button } from '@boogbe/ui';
import { api } from '../../lib/api';
import { uploadFile } from '../../lib/upload';

export function LogoUpload({ logoUrl, onChanged }: { logoUrl: string | null; onChanged: () => void }) {
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(undefined);
    setBusy(true);
    void (async () => {
      try {
        const id = await uploadFile('logo', f);
        await api('/v1/org/settings', { method: 'PATCH', body: { logoFileId: id } });
        onChanged();
      } catch (x) {
        setErr((x as Error).message);
      } finally {
        setBusy(false);
        e.target.value = '';
      }
    })();
  };
  return (
    <div className="flex items-center gap-4">
      {logoUrl ? (
        <img src={logoUrl} alt="Business logo" className="h-14 w-14 rounded-lg border border-line object-contain" />
      ) : (
        <div className="grid h-14 w-14 place-items-center rounded-lg border border-dashed border-line text-xs text-ink-muted">Logo</div>
      )}
      <label className="cursor-pointer">
        <span className="sr-only">Upload logo</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick} />
        <Button variant="secondary" loading={busy} type="button" onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement).click()}>
          {logoUrl ? 'Change logo' : 'Upload logo'}
        </Button>
      </label>
      {logoUrl && (
        <Button
          variant="ghost"
          onClick={async () => {
            await api('/v1/org/settings', { method: 'PATCH', body: { logoFileId: null } });
            onChanged();
          }}
        >
          Remove
        </Button>
      )}
      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}
    </div>
  );
}
