import { formatNaira } from '@boogbe/shared';

export { formatNaira };
const d = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** '2026-10-09' → '9 Oct 2026' */
export const formatDate = (iso: string) => d.format(new Date(`${iso}T00:00:00Z`));
