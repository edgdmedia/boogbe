import { useState } from 'react';
import { can, ENTRY_LABELS, formatNaira, METHOD_LABELS, type Booking, type PaymentEntry, type RecordEntryInput } from '@boogbe/shared';
import { Button, Card, CardHeader, Dialog, Spinner } from '@boogbe/ui';
import { useMe } from '../../lib/use-me';
import { useLedger } from './hooks';
import { RecordEntryForm } from './RecordEntryForm';
import { VoidForm } from './VoidDialog';

const SIGN: Record<string, 1 | -1 | 0> = {
  payment: 1,
  deposit_received: 1,
  refund: -1,
  deposit_returned: -1,
  deposit_withheld: 0,
  void: 0,
};
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? '';

export function PaymentsPanel({
  booking,
  refresh,
}: {
  booking: Pick<Booking, 'id' | 'status' | 'finalTotalKobo'>;
  refresh: () => void;
}) {
  const { me } = useMe();
  const role = me?.activeOrg?.role;
  const { data, mutate } = useLedger(booking.id);
  const [dlg, setDlg] = useState<null | { kinds: RecordEntryInput['kind'][]; amount: number; title: string } | { void: PaymentEntry }>(null);
  if (!data)
    return (
      <Card>
        <Spinner />
      </Card>
    );
  const t = data.totals;
  const done = async () => {
    setDlg(null);
    await mutate();
    refresh();
  };
  const balanceLabel = booking.status === 'cancelled' ? 'Retained' : t.balanceKobo < 0 ? 'Overpaid' : 'Balance';
  const balanceValue = booking.status === 'cancelled' ? t.retainedKobo : Math.abs(t.balanceKobo);
  const canWrite = !!role && can(role, 'payments.write');
  const canVoid = !!role && can(role, 'payments.void');
  return (
    <Card className="flex flex-col gap-3">
      <CardHeader title="Payments" />
      <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <div>
          <dt className="eyebrow text-ink-muted">Total</dt>
          <dd className="num text-[15px] font-semibold">{formatNaira(booking.finalTotalKobo)}</dd>
        </div>
        <div>
          <dt className="eyebrow text-ink-muted">Paid</dt>
          <dd className="num text-[15px] font-semibold">{formatNaira(t.netPaidKobo)}</dd>
        </div>
        <div>
          <dt className="eyebrow text-ink-muted">{balanceLabel}</dt>
          <dd className={`num text-[15px] font-semibold ${balanceLabel === 'Balance' && t.balanceKobo > 0 ? 'text-danger' : ''}`}>
            {formatNaira(balanceValue)}
          </dd>
        </div>
        <div>
          <dt className="eyebrow text-ink-muted">Deposit held</dt>
          <dd className="num text-[15px] font-semibold">{formatNaira(t.depositHeldKobo)}</dd>
        </div>
      </dl>
      {data.entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {data.entries
                .filter((e) => e.kind !== 'void')
                .map((e) => (
                  <tr key={e.id} className={`border-t border-line ${e.voided ? 'line-through text-ink-muted' : ''}`}>
                    <td className="py-1 pr-2">{e.receivedOn}</td>
                    <td className="pr-2">{ENTRY_LABELS[e.kind]}</td>
                    <td className="pr-2">{METHOD_LABELS[e.method]}</td>
                    <td className="pr-2 text-right">
                      {SIGN[e.kind] === -1 ? '−' : ''}
                      {formatNaira(e.amountKobo)}
                    </td>
                    <td className="pr-2">{e.reference ?? e.note ?? ''}</td>
                    <td className="pr-2">
                      {e.receiptNo && !e.voided && (
                        <a href={`${API_ORIGIN}/v1/payments/${e.id}/receipt.pdf`} className="text-brand" download>
                          {e.receiptNo}
                        </a>
                      )}
                    </td>
                    <td>
                      {canVoid && !e.voided && (
                        <Button variant="ghost" onClick={() => setDlg({ void: e })}>
                          Void
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {booking.status !== 'cancelled' && (
            <Button onClick={() => setDlg({ kinds: ['payment'], amount: Math.max(0, t.balanceKobo), title: 'Record payment' })}>
              Record payment
            </Button>
          )}
          <Button variant="secondary" onClick={() => setDlg({ kinds: ['deposit_received', 'deposit_returned', 'deposit_withheld'], amount: 0, title: 'Caution deposit' })}>
            Deposit
          </Button>
          {t.netPaidKobo > 0 && (
            <Button variant="secondary" onClick={() => setDlg({ kinds: ['refund'], amount: 0, title: 'Refund' })}>
              Refund
            </Button>
          )}
        </div>
      )}
      <Dialog open={!!dlg && 'kinds' in dlg} onClose={() => setDlg(null)} title={dlg && 'kinds' in dlg ? dlg.title : ''}>
        {dlg && 'kinds' in dlg && (
          <RecordEntryForm bookingId={booking.id} kinds={dlg.kinds} defaultAmountKobo={dlg.amount} ledger={data} onSaved={done} />
        )}
      </Dialog>
      <Dialog open={!!dlg && 'void' in dlg} onClose={() => setDlg(null)} title="Void entry">
        {dlg && 'void' in dlg && <VoidForm bookingId={booking.id} entry={dlg.void} onSaved={done} />}
      </Dialog>
    </Card>
  );
}
