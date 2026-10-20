import { Link } from 'react-router-dom';
import { Input } from '@boogbe/ui';
import { formatNaira } from '../../lib/format';

export interface UnitOption {
  id: string;
  propertyId: string;
  name: string;
  bedrooms: number;
  maxGuests: number;
  nightlyRateKobo: number;
  active: boolean;
  publicListed: boolean;
}

export interface UnitPick {
  unitId: string;
  label: string | null;
}

/**
 * The listing's units: pick active units (grouped by property), one option label each.
 * Rates and guests come from the unit and stay read-only here — pricing is edited with the unit.
 */
export function ListingUnitsField({
  units,
  propertyNames,
  value,
  onChange,
  disabled,
  error,
}: {
  units: UnitOption[];
  propertyNames: Map<string, string>;
  value: UnitPick[];
  onChange: (next: UnitPick[]) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const byId = new Map(value.map((v) => [v.unitId, v]));
  const grouped = new Map<string, UnitOption[]>();
  for (const u of units) {
    if (!u.active) continue;
    grouped.set(u.propertyId, [...(grouped.get(u.propertyId) ?? []), u]);
  }
  return (
    <div className="flex flex-col gap-2">
      {[...grouped.entries()].map(([propertyId, list]) => (
        <div key={propertyId} className="flex flex-col gap-1.5">
          <p className="eyebrow text-ink-muted">{propertyNames.get(propertyId) ?? 'Property'}</p>
          {list.map((u) => {
            const picked = byId.get(u.id);
            const checked = !!picked;
            return (
              <div key={u.id} className="flex flex-col gap-1.5 rounded-control border border-line bg-surface p-2.5">
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    aria-label={u.name}
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...value, { unitId: u.id, label: null }]
                          : value.filter((v) => v.unitId !== u.id),
                      )
                    }
                  />
                  <span className="font-medium text-ink">{u.name}</span>
                  <span className="text-[13px] text-ink-muted">
                    {formatNaira(u.nightlyRateKobo)} · {u.maxGuests} guests
                  </span>
                  <Link to={`/settings/properties/${u.propertyId}?unit=${u.id}`} className="ml-auto text-[13px] font-semibold text-brand hover:underline">
                    Edit unit
                  </Link>
                </div>
                {checked && (
                  <label className="flex items-center gap-2 text-[13px] text-ink-muted">
                    <span className="sr-only">{`Website label for ${u.name}`}</span>
                    <Input
                      aria-label={`Website label for ${u.name}`}
                      placeholder="Option label, e.g. 1 bedroom"
                      maxLength={40}
                      value={picked!.label ?? ''}
                      disabled={disabled}
                      onChange={(e) =>
                        onChange(value.map((v) => (v.unitId === u.id ? { ...v, label: e.target.value || null } : v)))
                      }
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
