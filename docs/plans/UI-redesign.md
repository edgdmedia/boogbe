# UI — app.boogbe.com redesign (Unclutter Desk layout, Boogbe brand) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim tasks on the board in `docs/COORDINATION.md` as usual.

**Goal:** every screen of app.boogbe.com uses Unclutter Desk's shell and component style, keeping Boogbe's teal brand, light and dark mode, and phone-first rules.

**Architecture:**
1. **Tokens and primitives.** Tokens and restyled primitives live in `packages/ui`, the only place styles are defined.
2. **Shell.** The app shell is rebuilt around a dark sidebar, which collapses to an icon rail on tablets and becomes a drawer on phones. Phones also get a bottom bar with four tabs and "More". Settings pages move into their own section with their own side nav.
3. **Pages.** The pages then adopt the new `PageHeader`, `CardHeader` and `StatTile` in three batches.

Everything stays CSS-responsive, with no `matchMedia` in the shell. Routes, copy, accessible names and test ids don't change.

**Tech Stack:** React 18, Vite 5, Tailwind CSS 4 (`@theme` tokens, `@utility`), lucide-react, react-router-dom 6, vitest with Testing Library, and Playwright. Adds one dependency, `@fontsource-variable/inter`.

**Spec:** `docs/superpowers/specs/2026-10-17-ui-redesign-design.md`. Reference UI: `~/Projects/Unclutter/unclutterdesk/packages/ui/src` (`navigation/Sidebar.tsx`, `navigation/BottomNav.tsx`, `layout/PageHeader.tsx`, `components/Card.tsx`, `tokens/*.css`). Copy its shapes, not its brand.

## Global Constraints

- **Brand tokens:** the existing token names and values in `packages/ui/src/tokens.css` stay exactly as they are, light and dark. Brand teal is `#0f6b5c` light and `#3fb59b` dark.
- **No Unclutter branding:** no logos, no pine, clay, navy or gold colours, no therapist wording, no tour, no white-label code, no `unclutter_*` keys.
- **No new UI library.** The only new dependency is `@fontsource-variable/inter`.
- **Copy and names:** page copy, headings, labels, button names and `aria-label`s stay unchanged. The one exception is the nav label for `/settings`, which becomes "Business" (spec §3).
- **Kept as they are:**
  - `data-testid="cell-*"` in `CalendarGrid`
  - `data-kind-icon` in `NotificationBell`
  - the `line-through` class on a voided payment row
  - the calendar's sticky unit column, horizontal scroll and drag-to-create
- **Touch targets:** at least 44px (`min-h-11`) for anything tappable on a phone. `Button size="sm"` is for dense desktop rows only.
- **Contrast:** text meets WCAG AA (≥ 4.5:1) in light and dark.
- **Formats:** money uses `formatNaira` (₦, no decimals) with the `num` utility on figures; dates use the existing helpers.
- **Breakpoints:** phone below `md` (768px), rail at `md`–`xl`, full sidebar at `xl` (1280px) and up.
- **Storage:** the only browser storage key is `boogbe:sidebar-collapsed` (`'1'` or absent). Every read and write is wrapped in try/catch.
- **Every task's PR must pass:**
  - the gate, `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int`
  - `pnpm test:e2e`, both projects
  - screenshots at 375×812 and 1440×900, light and dark, attached to the PR
- **No deploys.**

## Review Focus

1. **Test names:** unit tests find elements by role and text, so a restyle that duplicates text (rendering both a table and a card list) or renames something silently breaks them. Phone layouts must reuse the same DOM. This is pinned by the T-UI-01 `Table` test (one `<tr>` per row, `data-label` present).
2. **More than one dialog:** with two dialogs mounted (e.g. BookingDetail's Edit plus a StatusActions dialog), both used `id="dlg-title"`, so the second dialog's name was wrong. Pinned by the T-UI-01 `Dialog` test (two dialogs, distinct accessible names).
3. **A role without a given settings page:** for example, front desk can read Business and Properties but not Team. The Settings entry must open a page they can see, and the side nav must not list pages they can't. Pinned by the T-UI-02 `SettingsLayout` and `AppShell` tests (front desk sees Business, Properties and Signed-in devices; not Team, Online booking or Audit log).
4. **Blocked storage:** private mode or blocked site data can make `localStorage` throw. The shell must still render expanded. Pinned by the T-UI-02 test that makes `getItem` throw.
5. **Dark mode status colours:** they had no dark values, so warning and danger text sat at low contrast on dark surfaces. Fixed by the T-UI-01 tokens and checked in each task's dark screenshots against the AA list in T-UI-01 Step 9.

## Task overview

| Task | Track | Depends on |
|---|---|---|
| T-UI-01 Tokens, Inter, restyled primitives, new `Textarea`, `CardHeader`, `PageHeader`, `StatTile` | ui | — |
| T-UI-02 Shell: dark sidebar with rail and collapse, top strip, phone header, bottom bar with More drawer, settings layout | ui | 01 |
| T-UI-03 Screens: bookings, booking detail and forms, calendar, guests, conflicts | ui | 02 |
| T-UI-04 Screens: money, payments panel, properties, property detail, owners, unit forms | ui | 02 |
| T-UI-05 Screens: settings pages, auth pages, choose operator, platform, placeholders | ui | 02 |

T-UI-03, 04 and 05 touch different files and can merge in any order after 02. One builder works them in sequence.

---

### Task 1 (T-UI-01): Tokens, Inter and primitives

**Files:**
- Modify: `packages/ui/src/tokens.css`
- Modify: `packages/ui/src/Button.tsx`, `Input.tsx`, `Select.tsx`, `Field.tsx`, `Card.tsx`, `Badge.tsx`, `Dialog.tsx`, `Table.tsx`, `EmptyState.tsx`, `index.ts`
- Create: `packages/ui/src/Textarea.tsx`, `PageHeader.tsx`, `StatTile.tsx`
- Modify: `apps/app/package.json` (add the font), `apps/app/src/main.tsx` (import the font), `apps/app/index.html` (body classes)
- Test: create `apps/app/src/ui-kit.test.tsx`. `packages/ui` has no test runner; the app's vitest picks up `src/**/*.test.tsx`.

**Interfaces:**
- Produces, used by T-UI-02 to T-UI-05:
  - Token utilities:
    - Brand: `bg-brand-50` … `bg-brand-900`, `bg-brand-soft`
    - Sidebar: `bg-sidebar`, `bg-sidebar-hover`, `text-sidebar-ink`, `text-sidebar-muted`
    - Lines and text: `border-line-strong`, `text-danger-ink`
    - Radius: `rounded-card`, `rounded-panel`, `rounded-control`, `rounded-chip`
    - Shadows: `shadow-card`, `shadow-raised`, `shadow-modal`, `shadow-button`
  - Custom utilities `eyebrow` (size, weight, case and tracking only; set the colour with a `text-*` class), `num` and `no-scrollbar`.
  - `Button` gains `size?: 'sm' | 'md'`.
  - `Textarea` has the same props as `<textarea>`, plus `ref`.
  - `CardHeader({ title: ReactNode; eyebrow?: ReactNode; action?: ReactNode })`
  - `PageHeader({ title: ReactNode; eyebrow?: ReactNode; meta?: ReactNode; back?: ReactNode; actions?: ReactNode })`
  - `StatTile({ label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode })`
  - `Badge` gains `dot?: boolean`.
  - `EmptyState` gains `icon?: ReactNode`.
  - `Column<T>` gains `hideOnMobile?: boolean`.

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/ui-kit.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge, Dialog, PageHeader, StatTile, Table, Textarea, Field, CardHeader } from '@boogbe/ui';

describe('ui kit', () => {
  it('two open dialogs each get their own accessible name', () => {
    render(
      <>
        <Dialog open onClose={() => {}} title="Edit TAN-1">
          <p>a</p>
        </Dialog>
        <Dialog open onClose={() => {}} title="Cancel booking">
          <p>b</p>
        </Dialog>
      </>,
    );
    expect(screen.getByRole('dialog', { name: 'Edit TAN-1' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Cancel booking' })).toBeInTheDocument();
  });

  it('table keeps one row per item and labels each cell for the phone card layout', () => {
    render(
      <Table
        rows={[{ id: 'b1', guest: 'Tunde Bakare' }]}
        columns={[
          { key: 'g', header: 'Guest', cell: (r) => r.guest },
          { key: 'n', header: 'Notes', cell: () => 'x', hideOnMobile: true },
        ]}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2); // header + one body row, no duplicate card list
    expect(screen.getByText('Tunde Bakare').closest('td')).toHaveAttribute('data-label', 'Guest');
    expect(screen.getAllByText('Tunde Bakare')).toHaveLength(1);
  });

  it('page header renders one h1 with meta and actions', () => {
    render(<PageHeader title="Bookings" eyebrow="Front desk" meta={<Badge tone="success">Confirmed</Badge>} actions={<button>New booking</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bookings' })).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New booking' })).toBeInTheDocument();
  });

  it('status badge text stays the accessible content; the dot is decorative', () => {
    render(<Badge tone="danger">Cancelled</Badge>);
    const badge = screen.getByText('Cancelled');
    expect(badge.textContent).toBe('Cancelled');
    expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('stat tile shows label and value; card header is an h2', () => {
    render(
      <>
        <StatTile label="Received" value="₦262,500" sub="3 payments" />
        <CardHeader title="History" eyebrow="Booking" />
      </>,
    );
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByText('₦262,500')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'History' })).toBeInTheDocument();
  });

  it('textarea works inside Field (label association)', () => {
    render(
      <Field label="Notes">
        <Textarea />
      </Field>,
    );
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
    expect(within(document.body).getByRole('textbox', { name: 'Notes' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boogbe/app exec vitest run src/ui-kit.test.tsx`
Expected: FAIL, because `PageHeader`, `StatTile`, `Textarea` and `CardHeader` aren't exported.

- [ ] **Step 3: Tokens.** Replace `packages/ui/src/tokens.css` with:

```css
/* Boogbe tokens. The names and values above "added" are the brand (DESIGN-PROMPT) — do not change them.
   Layout and shape follow Unclutter Desk; colour stays Boogbe's. */
:root {
  --elev-card: 0 1px 3px rgb(24 45 50 / 0.06), 0 1px 2px rgb(24 45 50 / 0.04);
  --elev-raised: 0 12px 34px rgb(24 45 50 / 0.09);
  --elev-modal: 0 24px 80px rgb(24 45 50 / 0.24);
  --elev-button: 0 6px 18px rgb(15 107 92 / 0.22);
}
@theme {
  --color-ink: #182d32;
  --color-ink-muted: #5b6d72;
  --color-surface: #ffffff;
  --color-surface-2: #f4f6f5;
  --color-line: #dfe5e3;
  --color-brand: #0f6b5c;
  --color-brand-ink: #ffffff;
  --color-success: #1f7a4d;
  --color-warning: #a35d00;
  --color-danger: #b42318;
  --color-info: #175cd3;
  /* added */
  --color-line-strong: #c9d3d0;
  --color-danger-ink: #ffffff;
  --color-brand-soft: #ecf6f3;
  --color-brand-50: #ecf6f3;
  --color-brand-100: #d3ebe4;
  --color-brand-200: #a8d6c9;
  --color-brand-300: #6fb9a6;
  --color-brand-400: #3fb59b;
  --color-brand-500: #1c8a75;
  --color-brand-600: #0f6b5c;
  --color-brand-700: #0c574b;
  --color-brand-800: #0a463c;
  --color-brand-900: #08362f;
  --color-sidebar: #0b1f1b;
  --color-sidebar-hover: #153530;
  --color-sidebar-ink: #e8eeec;
  --color-sidebar-muted: #9fb0ab;
  --radius-card: 24px;
  --radius-panel: 20px;
  --radius-control: 14px;
  --radius-chip: 12px;
  --shadow-card: var(--elev-card);
  --shadow-raised: var(--elev-raised);
  --shadow-modal: var(--elev-modal);
  --shadow-button: var(--elev-button);
  --font-sans: 'Inter Variable', 'Inter', system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-ink: #e8eeec;
    --color-ink-muted: #9fb0ab;
    --color-surface: #0f1715;
    --color-surface-2: #16211e;
    --color-line: #26332f;
    --color-brand: #3fb59b;
    --color-brand-ink: #06231d;
    --color-line-strong: #34443f;
    --color-danger-ink: #2a0703;
    --color-brand-soft: #13302a;
    --color-sidebar: #08120f;
    --color-sidebar-hover: #12231f;
    --color-success: #4fbf86;
    --color-warning: #e0a24a;
    --color-danger: #f2766b;
    --color-info: #7aa7ff;
    --elev-card: none;
    --elev-raised: none;
    --elev-modal: none;
    --elev-button: none;
  }
}
@utility eyebrow {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
@utility num {
  font-variant-numeric: tabular-nums;
}
@utility no-scrollbar {
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
@layer base {
  body {
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }
  input[type='checkbox'],
  input[type='radio'] {
    accent-color: var(--color-brand);
  }
}
```

- [ ] **Step 4: Inter font**

Run `pnpm --filter @boogbe/app add @fontsource-variable/inter@^5`. Then add `import '@fontsource-variable/inter';` to `apps/app/src/main.tsx` as the line before `import './index.css';`. The CSS and `.woff2` files are bundled from the same origin, which the CSP (`default-src 'self'`) allows.

In `apps/app/index.html`, change the body to `<body class="bg-surface-2 text-ink antialiased">`.

- [ ] **Step 5: Primitives.** Write each file as follows.

`packages/ui/src/Button.tsx`:

```tsx
import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';
const styles: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink shadow-button hover:brightness-110',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
  danger: 'bg-danger text-danger-ink hover:brightness-110',
  ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
};
// md is the 44px touch target; sm (36px) is only for dense desktop rows.
const sizes: Record<Size, string> = { sm: 'min-h-9 px-3 text-[13px]', md: 'min-h-11 px-4 text-sm' };

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-[filter,background-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
        sizes[size],
        styles[variant],
        className,
      )}
    >
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}
```

Shared field classes go in a new file `packages/ui/src/field-classes.ts`. It isn't exported from `index.ts`.

```ts
export const FIELD =
  'w-full rounded-control border border-line-strong bg-surface-2 px-3.5 text-ink placeholder:text-ink-muted transition-colors focus:border-brand focus:bg-surface focus:outline-none focus:ring-3 focus:ring-brand/25 disabled:opacity-60 aria-[invalid=true]:border-danger';
```

`packages/ui/src/Input.tsx`: keep the `forwardRef` shape. Set `className={clsx('min-h-11', FIELD, className)}`.

`packages/ui/src/Select.tsx`: keep the shape. Set `className={clsx('min-h-11', FIELD, className)}`.

`packages/ui/src/Textarea.tsx`:

```tsx
import clsx from 'clsx';
import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { FIELD } from './field-classes';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} {...rest} className={clsx('min-h-24 py-2.5', FIELD, className)} />;
});
```

`packages/ui/src/Field.tsx`: change only the classes.
- Label: `text-[13px] font-semibold text-ink`
- Wrapper: `flex flex-col gap-1.5`
- Hint: `text-xs text-ink-muted`
- Error: `text-xs font-medium text-danger`

`packages/ui/src/Card.tsx`:

```tsx
import clsx from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={clsx('rounded-card border border-line bg-surface p-5 shadow-card', className)} />;
}

export function CardHeader({ title, eyebrow, action }: { title: ReactNode; eyebrow?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow text-ink-muted">{eyebrow}</p>}
        <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
```

`packages/ui/src/Badge.tsx`:

```tsx
import clsx from 'clsx';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'border-line bg-surface-2 text-ink-muted',
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/25 bg-warning/10 text-warning',
  danger: 'border-danger/25 bg-danger/10 text-danger',
  info: 'border-info/25 bg-info/10 text-info',
};

/** The text is the signal; the dot is decoration, so colour is never the only cue. */
export function Badge({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  const showDot = dot ?? tone !== 'neutral';
  return (
    <span className={clsx('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold', tones[tone])}>
      {showDot && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
```

Before relying on `getByText('Cancelled')` inside a badge, check that `textContent` is still exactly the label: the dot `span` has no text, so it is.

`packages/ui/src/Dialog.tsx`:

```tsx
import { useEffect, useId, useRef, type ReactNode } from 'react';

/** A centred modal from md up; a bottom sheet on phones (same element, CSS only). */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-card border border-line bg-surface p-0 text-ink shadow-modal backdrop:bg-ink/40 backdrop:backdrop-blur-sm max-md:mb-0 max-md:w-full max-md:max-w-none max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0"
    >
      <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong md:hidden" />
      <div className="flex items-center justify-between gap-2 border-b border-line py-2 pl-5 pr-2">
        <h2 id={titleId} className="text-[17px] font-bold tracking-[-0.01em]">
          {title}
        </h2>
        <button aria-label="Close" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-ink-muted hover:bg-surface-2 hover:text-ink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="max-h-[75dvh] overflow-y-auto p-5 max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom))]">{open && children}</div>
    </dialog>
  );
}
```

`packages/ui/src/Table.tsx`: add `hideOnMobile?: boolean` to `Column<T>` and use this render:

```tsx
return (
  <div className="md:overflow-x-auto md:rounded-card md:border md:border-line md:bg-surface md:shadow-card">
    <table className="w-full text-left text-sm max-md:block">
      <thead className="border-b border-line max-md:sr-only">
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={clsx('eyebrow px-4 py-3 text-ink-muted', c.className)}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      {/* Below md each row is a card: same <tr>/<td> DOM, labels from data-label (no duplicated text). */}
      <tbody className="max-md:flex max-md:flex-col max-md:gap-3">
        {rows.map((r) => (
          <tr
            key={r.id}
            onClick={onRowClick && (() => onRowClick(r))}
            className={clsx(
              'border-t border-line first:border-t-0 max-md:block max-md:rounded-panel max-md:border max-md:bg-surface max-md:p-4 max-md:shadow-card',
              onRowClick && 'cursor-pointer hover:bg-surface-2',
            )}
          >
            {columns.map((c) => (
              <td
                key={c.key}
                data-label={c.header}
                className={clsx(
                  'px-4 py-3 max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-3 max-md:px-0 max-md:py-1 max-md:text-right max-md:before:eyebrow max-md:before:shrink-0 max-md:before:text-left max-md:before:text-ink-muted max-md:before:content-[attr(data-label)]',
                  c.hideOnMobile && 'max-md:hidden',
                  c.className,
                )}
              >
                {c.cell(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
```

Import `clsx` at the top of `Table.tsx`.

`packages/ui/src/EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react';

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line-strong bg-surface p-10 text-center">
      {icon && <div className="mb-1 grid size-12 place-items-center rounded-panel bg-brand-soft text-brand [&_svg]:size-6">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-muted">{body}</p>}
      {action}
    </div>
  );
}
```

`packages/ui/src/PageHeader.tsx`:

```tsx
import type { ReactNode } from 'react';

/** The page's title row. One h1 per page; badges go in `meta`, buttons in `actions`. */
export function PageHeader({
  title,
  eyebrow,
  meta,
  back,
  actions,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-line pb-4">
      <div className="min-w-0 flex-1 basis-60">
        {back && <div className="mb-1 md:hidden">{back}</div>}
        {eyebrow && <p className="eyebrow text-ink-muted">{eyebrow}</p>}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-[22px] font-bold tracking-[-0.02em] text-ink md:text-[26px]">{title}</h1>
          {meta}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
```

`packages/ui/src/StatTile.tsx`:

```tsx
import type { ReactNode } from 'react';

export function StatTile({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5 shadow-card">
      <p className="eyebrow text-ink-muted">{label}</p>
      <p className="num mt-2 text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">{value}</p>
      {sub && <p className="mt-1 text-[13px] text-ink-muted">{sub}</p>}
      {children}
    </div>
  );
}
```

`packages/ui/src/index.ts`: add these lines.

```ts
export * from './Textarea';
export * from './PageHeader';
export * from './StatTile';
```

- [ ] **Step 6: Replace the raw `<textarea>`s and `text-white` uses**

**Textareas:** in `apps/app/src/features/inventory/UnitForm.tsx`, `features/bookings/BookingForm.tsx` and `features/bookings/EditBookingDialog.tsx`, replace each `<textarea … className="…">` with `<Textarea …>`. Keep every prop except `className` (drop the old classes) and import `Textarea` from `@boogbe/ui`.

**`text-white` on danger:** find the uses with `grep -rn "text-white" apps/app/src` and replace each `bg-danger … text-white` with `bg-danger … text-danger-ink`.

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `pnpm --filter @boogbe/app exec vitest run src/ui-kit.test.tsx`
Expected: PASS (6 tests).

Then run `pnpm --filter @boogbe/app test`, expecting all to pass. A failure here means a primitive changed its DOM or text, which the restyle must not do. Fix the primitive, not the test.

- [ ] **Step 8: Gate and E2E**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int`, then `pnpm test:e2e`.
Expected: all green.

- [ ] **Step 9: Screenshots and contrast check**

1. With `pnpm dev` running and the E2E seed, open `/auth/sign-in`, `/bookings` and one booking with Playwright at 375×812 and 1440×900, with `colorScheme` set to `light` and to `dark`.
2. Save the PNGs under the scratchpad.
3. Check that these text and background pairs are at least 4.5:1, using any contrast checker:

   | Text | Background | Modes |
   |---|---|---|
   | warning | warning/10 over surface | light and dark |
   | danger | danger/10 over surface | light and dark |
   | ink-muted | surface-2 | light and dark |
   | sidebar-muted | sidebar | light and dark |

4. Record the ratios in the PR body. If one fails, darken that text token (light mode) or lighten it (dark mode) and say so in the PR.

- [ ] **Step 10: Commit and open the PR**

```bash
git add packages/ui apps/app
git commit -m "feat(ui): Unclutter-style tokens, Inter, restyled primitives; PageHeader, StatTile, Textarea [T-UI-01]"
```

Open the PR to `dev` with the screenshots and contrast ratios attached.

---

### Task 2 (T-UI-02): Shell, navigation and settings layout

**Files:**
- Modify: `apps/app/src/components/shell/AppShell.tsx` (rewrite)
- Create: `apps/app/src/components/shell/SettingsLayout.tsx`, `apps/app/src/components/shell/sidebar-pref.ts`
- Modify: `apps/app/src/router.tsx`: the nav model, and wrapping the settings routes
- Modify: `apps/app/src/components/shell/OrgSwitcher.tsx`: restyle for the dark sidebar, with a `tone` prop
- Test: modify `apps/app/src/components/shell/AppShell.test.tsx` and create `apps/app/src/components/shell/SettingsLayout.test.tsx`

**Interfaces:**
- Consumes the T-UI-01 utilities and components.
- Produces:
  - `NavItem` (exported from `AppShell.tsx`):

    ```ts
    { to: string; label: string; icon: LucideIcon; permission?: Permission; section?: 'main' | 'settings'; tab?: boolean; end?: boolean }
    ```

    `section` defaults to `'main'`.
  - `visibleNav(nav: NavItem[], role: OrgRole | undefined): NavItem[]`, exported from `AppShell.tsx`.
  - `SettingsLayout({ nav, children })`.
  - `OPERATOR_NAV` keeps its name and type.

- [ ] **Step 1: Write the failing tests**

Replace `apps/app/src/components/shell/AppShell.test.tsx`. Keep its two existing tests verbatim and add the ones below. The mocks are the same, plus a `role` variable so the tests can switch it.

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookOpen, Building2, CalendarDays, Contact, Settings, TriangleAlert, Users, Wallet } from 'lucide-react';
import { AppShell, type NavItem } from './AppShell';

vi.mock('../../lib/use-me', () => ({
  useMe: () => ({
    me: {
      user: { id: 'u', name: 'Ada', email: 'a@x', isPlatformAdmin: false },
      activeOrg: { id: 'o', name: 'Tanuhomes', slug: 't', role: 'frontdesk', timezone: 'Africa/Lagos', currency: 'NGN' },
      memberships: [{ orgId: 'o', orgName: 'Tanuhomes', role: 'frontdesk' }],
    },
  }),
}));
vi.mock('../../lib/auth-client', () => ({ authClient: { organization: { setActive: vi.fn() }, signOut: vi.fn() } }));
vi.mock('../../features/ical/hooks', () => ({ useConflicts: () => ({ data: { items: [{ id: 'c1' }, { id: 'c2' }] } }) }));

const NAV: NavItem[] = [
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, permission: 'calendar.read', tab: true },
  { to: '/bookings', label: 'Bookings', icon: BookOpen, permission: 'bookings.read', tab: true },
  { to: '/guests', label: 'Guests', icon: Contact, permission: 'guests.read', tab: true },
  { to: '/money', label: 'Money', icon: Wallet, permission: 'payments.read', tab: true },
  { to: '/conflicts', label: 'Conflicts', icon: TriangleAlert, permission: 'bookings.read' },
  { to: '/settings', label: 'Business', icon: Settings, permission: 'org.settings.read', section: 'settings', end: true },
  { to: '/settings/properties', label: 'Properties', icon: Building2, permission: 'inventory.read', section: 'settings' },
  { to: '/settings/team', label: 'Team', icon: Users, permission: 'members.write', section: 'settings' },
];
const shell = (path = '/calendar') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell nav={NAV}>
        <p>content</p>
      </AppShell>
    </MemoryRouter>,
  );

afterEach(() => vi.restoreAllMocks());

describe('AppShell', () => {
  // (keep: 'hides nav items the role cannot use')
  // (keep: 'surfaces open conflicts in the mobile header, not just the sidebar')

  it('bottom bar shows the four tabs and More, nothing else', () => {
    shell();
    const bar = screen.getByRole('navigation', { name: 'Main' });
    expect(within(bar).getAllByRole('link').map((a) => a.textContent)).toEqual(['Calendar', 'Bookings', 'Guests', 'Money']);
    expect(within(bar).getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('settings pages collapse into one Settings entry that opens the first page the role can see', () => {
    shell('/settings/properties');
    const side = screen.getByRole('complementary');
    const settings = within(side).getByRole('link', { name: 'Settings' });
    expect(settings).toHaveAttribute('href', '/settings');
    expect(settings).toHaveAttribute('aria-current', 'page'); // active on any /settings/* path
    expect(within(side).queryByRole('link', { name: 'Team' })).toBeNull();
    expect(within(side).queryByRole('link', { name: 'Properties' })).toBeNull();
  });

  it('More opens the menu drawer with every destination', () => {
    shell();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('dialog', { name: 'Menu' });
    expect(within(menu).getByRole('link', { name: /Conflicts/ })).toHaveAttribute('href', '/conflicts');
    expect(within(menu).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('remembers a collapsed sidebar', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    shell();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(set).toHaveBeenCalledWith('boogbe:sidebar-collapsed', '1');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('renders expanded when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    shell();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });
});
```

Create `apps/app/src/components/shell/SettingsLayout.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OPERATOR_NAV } from '../../router';
import { SettingsLayout } from './SettingsLayout';

vi.mock('../../lib/use-me', () => ({
  useMe: () => ({ me: { user: { id: 'u', name: 'Ada' }, activeOrg: { id: 'o', name: 'Tanuhomes', role: 'frontdesk' }, memberships: [] } }),
}));

describe('SettingsLayout', () => {
  it('lists only the settings pages the role can open, with the current one marked', () => {
    render(
      <MemoryRouter initialEntries={['/settings/properties']}>
        <SettingsLayout nav={OPERATOR_NAV}>
          <p>page</p>
        </SettingsLayout>
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Business', 'Properties', 'Signed-in devices']);
    expect(within(nav).getByRole('link', { name: 'Properties' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Business' })).not.toHaveAttribute('aria-current');
  });
});
```

`router.tsx` imports every page. If importing it in a unit test pulls in modules that fail in jsdom, move `OPERATOR_NAV` and `PLATFORM_NAV` to a new `apps/app/src/nav.ts`, re-export them from `router.tsx`, and import from `../../nav` in the test.

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @boogbe/app exec vitest run src/components/shell`
Expected: the new tests FAIL (no `More` button, no `SettingsLayout`, `Business` not in the nav). The two old tests may still pass.

- [ ] **Step 3: Sidebar preference helper**

Create `apps/app/src/components/shell/sidebar-pref.ts`:

```ts
const KEY = 'boogbe:sidebar-collapsed';

/** Private mode or blocked site data can make storage throw; the sidebar then just starts expanded. */
export function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCollapsed(v: boolean): void {
  try {
    if (v) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* preference is a convenience; ignore */
  }
}
```

- [ ] **Step 4: Nav model in `router.tsx`.** Replace `OPERATOR_NAV` and its icon import with:

```tsx
import { BookOpen, Building2, CalendarDays, Contact, Globe, MonitorSmartphone, ScrollText, Settings, ShieldCheck, TriangleAlert, UserRound, Users, Wallet } from 'lucide-react';

/** One source of truth for nav. `tab` = phone bottom bar; `section: 'settings'` = the settings side nav. */
export const OPERATOR_NAV: NavItem[] = [
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, permission: 'calendar.read', tab: true },
  { to: '/bookings', label: 'Bookings', icon: BookOpen, permission: 'bookings.read', tab: true },
  { to: '/guests', label: 'Guests', icon: Contact, permission: 'guests.read', tab: true },
  { to: '/money', label: 'Money', icon: Wallet, permission: 'payments.read', tab: true },
  { to: '/conflicts', label: 'Conflicts', icon: TriangleAlert, permission: 'bookings.read' },
  { to: '/settings', label: 'Business', icon: Settings, permission: 'org.settings.read', section: 'settings', end: true },
  { to: '/settings/properties', label: 'Properties', icon: Building2, permission: 'inventory.read', section: 'settings' },
  { to: '/settings/owners', label: 'Owners', icon: UserRound, permission: 'owners.read', section: 'settings' },
  { to: '/settings/team', label: 'Team', icon: Users, permission: 'members.write', section: 'settings' },
  { to: '/settings/online-booking', label: 'Online booking', icon: Globe, permission: 'org.settings.write', section: 'settings' },
  { to: '/settings/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.read', section: 'settings' },
  { to: '/settings/sessions', label: 'Signed-in devices', icon: MonitorSmartphone, section: 'settings' },
];
```

Then add a helper next to `operator`:

```tsx
const settings = (children: ReactNode) => operator(<SettingsLayout nav={OPERATOR_NAV}>{children}</SettingsLayout>);
```

Switch these routes from `operator(...)` to `settings(...)`:
- `/settings`
- `/settings/team`
- `/settings/online-booking`
- `/settings/sessions`
- `/settings/audit`
- `/settings/properties`
- `/settings/properties/:id`
- `/settings/owners`

Import `SettingsLayout` from `./components/shell/SettingsLayout`.

- [ ] **Step 5: `OrgSwitcher` for a dark background.** Add a `tone?: 'light' | 'dark'` prop (default `'light'`).
- With one membership, it renders `<span className={clsx('truncate font-semibold', tone === 'dark' ? 'text-sidebar-ink' : 'text-ink')}>`.
- With several, it renders the same `Select` (`aria-label="Operator"` is unchanged). For `tone === 'dark'` it adds `className="min-h-10 border-white/10 bg-sidebar-hover text-sidebar-ink focus:bg-sidebar-hover"`.

- [ ] **Step 6: Write `AppShell.tsx`**

```tsx
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { House, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { can, OrgSettingsResponse, ROLE_LABELS, type OrgRole, type Permission } from '@boogbe/shared';
import { authClient } from '../../lib/auth-client';
import { useMe } from '../../lib/use-me';
import { useApi } from '../../lib/api';
import { NotificationBell } from './NotificationBell';
import { useConflicts } from '../../features/ical/hooks';
import { OrgSwitcher } from './OrgSwitcher';
import { readCollapsed, writeCollapsed } from './sidebar-pref';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  section?: 'main' | 'settings';
  tab?: boolean;
  end?: boolean;
}

export function visibleNav(nav: NavItem[], role: OrgRole | undefined): NavItem[] {
  return nav.filter((n) => !n.permission || (role && can(role, n.permission)));
}

/**
 * How the sidebar body lays out:
 *   rail — icons only (collapsed desktop);
 *   auto — rail at md–xl, full from xl (the aside's default);
 *   full — labels everywhere (the phone drawer).
 * One body per container, so jsdom (no CSS) never sees duplicate links. Tailwind needs the literal
 * class strings, so each mode's classes are spelled out here rather than built with string prefixes.
 */
type Mode = 'rail' | 'auto' | 'full';
const LABEL: Record<Mode, string> = { rail: 'sr-only', auto: 'sr-only xl:not-sr-only xl:truncate', full: 'truncate' };
const ONLY_FULL: Record<Mode, string> = { rail: 'hidden', auto: 'hidden xl:flex', full: 'flex' };
const ROW: Record<Mode, string> = { rail: 'justify-center', auto: 'justify-center xl:justify-start xl:px-3', full: 'px-3' };
const BAR: Record<Mode, string> = { rail: 'hidden', auto: 'hidden xl:block', full: 'block' };
const COUNT: Record<Mode, string> = { rail: 'absolute right-1 top-1', auto: 'absolute right-1 top-1 xl:static xl:ml-auto', full: 'ml-auto' };

const ITEM = 'relative flex min-h-11 items-center gap-2.5 rounded-control text-[13.5px] font-semibold transition-colors';
const IDLE = 'text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink';
const ACTIVE = 'bg-[linear-gradient(90deg,var(--color-brand-600),color-mix(in_oklab,var(--color-brand-500)_60%,transparent))] text-white shadow-[inset_0_0_0_1px_rgb(63_181_155/.3)]';

function SideLink({ item, active, mode, badge }: { item: NavItem; active?: boolean; mode: Mode; badge?: number }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={mode === 'full' ? undefined : item.label}
      aria-current={active ? 'page' : undefined}
      className={({ isActive }) => clsx(ITEM, ROW[mode], (active ?? isActive) ? ACTIVE : IDLE)}
    >
      {({ isActive }) => (
        <>
          {(active ?? isActive) && <span aria-hidden="true" className={clsx('absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-brand-400', BAR[mode])} />}
          <item.icon size={18} aria-hidden className="shrink-0" />
          <span className={LABEL[mode]}>{item.label}</span>
          {!!badge && <span className={clsx('rounded-full bg-danger px-1.5 text-[10px] font-bold text-danger-ink', COUNT[mode])}>{badge}</span>}
        </>
      )}
    </NavLink>
  );
}

export function AppShell({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  const { me } = useMe();
  const role = me?.activeOrg?.role;
  const items = visibleNav(nav, role);
  const main = items.filter((n) => (n.section ?? 'main') === 'main');
  const settingsItems = items.filter((n) => n.section === 'settings');
  const tabs = main.filter((n) => n.tab);
  const { pathname } = useLocation();
  const inSettings = pathname === '/settings' || pathname.startsWith('/settings/');
  const { data: orgSettings } = useApi(role && can(role, 'org.settings.read') ? '/v1/org/settings' : null, OrgSettingsResponse);
  const logo = orgSettings?.settings.logoUrl;
  const canSeeConflicts = !!role && can(role, 'bookings.read');
  const { data: conflicts } = useConflicts(canSeeConflicts ? 'open' : null);
  const openConflicts = canSeeConflicts ? (conflicts?.items.length ?? 0) : 0;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);

  const signOut = async () => {
    await authClient.signOut();
    window.location.assign('/auth/sign-in');
  };

  const body = (mode: Mode) => (
    <>
      <div className={clsx('flex items-center gap-2.5', ROW[mode])}>
        <span className="grid size-9 shrink-0 place-items-center rounded-chip bg-brand text-brand-ink">
          <House size={18} aria-hidden />
        </span>
        <span className={clsx(LABEL[mode], 'text-[17px] font-bold tracking-[-0.02em] text-sidebar-ink')}>Boogbe</span>
      </div>
      <div className={clsx('min-w-0 items-center gap-2 rounded-panel bg-white/[0.045] p-2', ONLY_FULL[mode])}>
        {logo && <img src={logo} alt="" className="size-8 shrink-0 rounded-chip bg-white object-contain" />}
        <OrgSwitcher tone="dark" />
      </div>
      <nav aria-label="Sidebar" className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {main.length > 0 && <p className={clsx(LABEL[mode], 'eyebrow px-3 pb-1 pt-2 text-sidebar-muted')}>Operations</p>}
        {main.map((n) => (
          <SideLink key={n.to} item={n} mode={mode} badge={n.to === '/conflicts' ? openConflicts : undefined} />
        ))}
        {settingsItems.length > 0 && (
          <>
            <p className={clsx(LABEL[mode], 'eyebrow px-3 pb-1 pt-5 text-sidebar-muted')}>Setup</p>
            <SideLink item={{ ...settingsItems[0], label: 'Settings', icon: SettingsIcon, end: false }} active={inSettings} mode={mode} />
          </>
        )}
      </nav>
      <div className="flex flex-col gap-1 border-t border-white/[0.07] pt-3">
        {me && (
          <p className={clsx('flex-col px-3 text-[13px] text-sidebar-ink', ONLY_FULL[mode])}>
            <span className="truncate">{me.user.name}</span>
            {role && <span className="text-xs text-sidebar-muted">{ROLE_LABELS[role]}</span>}
          </p>
        )}
        <button onClick={signOut} title={mode === 'full' ? undefined : 'Sign out'} className={clsx(ITEM, IDLE, ROW[mode])}>
          <LogOut size={18} aria-hidden />
          <span className={LABEL[mode]}>Sign out</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-dvh bg-surface-2 md:flex">
      {/* md–xl rail, full from xl unless collapsed — CSS only, no matchMedia, one body. */}
      <aside
        className={clsx(
          'sticky top-0 hidden h-dvh shrink-0 flex-col gap-5 border-r border-white/5 bg-sidebar px-2.5 py-5 md:flex',
          collapsed ? 'w-[76px]' : 'w-[76px] xl:w-[248px] xl:px-3.5',
        )}
      >
        {body(collapsed ? 'rail' : 'auto')}
        <button
          onClick={() => {
            setCollapsed(!collapsed);
            writeCollapsed(!collapsed);
          }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={clsx('hidden min-h-9 items-center gap-2 rounded-control px-3 text-[12.5px] font-semibold text-sidebar-muted hover:bg-sidebar-hover xl:flex', collapsed && 'justify-center px-0')}
        >
          {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          {!collapsed && <span aria-hidden>Collapse</span>}
        </button>
      </aside>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {logo ? (
            <img src={logo} alt="" className="size-8 shrink-0 rounded-chip border border-line object-contain" />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-chip bg-brand text-brand-ink">
              <House size={16} aria-hidden />
            </span>
          )}
          <OrgSwitcher />
        </div>
        {/* Conflicts is not a tab — keep open conflicts one tap away on a phone. */}
        <span className="flex items-center gap-2">
          {canSeeConflicts && openConflicts > 0 && (
            <NavLink to="/conflicts" className="flex min-h-11 items-center gap-1 rounded-full px-2 text-xs font-semibold text-ink-muted">
              <TriangleAlert size={16} aria-hidden />
              Conflicts
              <span className="rounded-full bg-danger px-1.5 text-[10px] font-bold text-danger-ink">{openConflicts}</span>
            </NavLink>
          )}
          <NotificationBell />
        </span>
      </header>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hidden justify-end px-6 pt-3 md:flex xl:px-[26px]">
          <NotificationBell />
        </div>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-28 pt-4 md:px-6 md:pb-8 md:pt-2 xl:px-[26px]">{children}</main>
      </div>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex h-[68px] items-stretch border-t border-line bg-surface/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        {tabs.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              clsx('flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold', isActive ? 'text-brand' : 'text-ink-muted')
            }
          >
            <n.icon size={20} aria-hidden />
            <span className="truncate">{n.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setMenuOpen(true)}
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold text-ink-muted"
        >
          <Menu size={20} aria-hidden />
          More
        </button>
      </nav>
      <MenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)}>
        {body('full')}
      </MenuDrawer>
    </div>
  );
}

function MenuDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label="Menu"
      className="m-0 h-dvh max-h-none w-[min(300px,85vw)] bg-sidebar p-0 text-sidebar-ink backdrop:bg-ink/50 backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="flex h-full flex-col gap-5 px-3.5 py-5">
          <button onClick={onClose} aria-label="Close menu" className="ml-auto grid min-h-11 min-w-11 place-items-center rounded-control text-sidebar-muted hover:bg-sidebar-hover">
            <X size={20} aria-hidden />
          </button>
          {children}
        </div>
      )}
    </dialog>
  );
}
```

**Things to check when writing the code:**
- **Settings link:** the sidebar's Settings link reuses the first visible settings item's `to` (for front desk that's `/settings`), with `end: false` and `active={inSettings}`. NavLink would otherwise mark it active only on `/settings` itself. Passing `aria-current` explicitly overrides NavLink's own.
- **One body per container:** the aside renders one body and the drawer renders one, only while open. A query scoped to `complementary` or to the `Menu` dialog always finds exactly one match, so the two existing tests pass unchanged. In jsdom the `auto` labels are `sr-only` text, which keeps them as accessible names.
- **Tailwind conflicts:** don't put a padding class in `ITEM` and another in `ROW`, because Tailwind resolves conflicting utilities by stylesheet order, not class order. That's why `ITEM` has no `px-*`.

- [ ] **Step 7: Write `SettingsLayout.tsx`**

```tsx
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useMe } from '../../lib/use-me';
import { visibleNav, type NavItem } from './AppShell';

/** Settings pages share one sub-navigation: a side list from md, scrolling chips on phones. */
export function SettingsLayout({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  const { me } = useMe();
  const items = visibleNav(nav, me?.activeOrg?.role).filter((n) => n.section === 'settings');
  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
      <nav
        aria-label="Settings"
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:sticky md:top-4 md:mx-0 md:w-[216px] md:shrink-0 md:flex-col md:gap-1 md:overflow-visible md:rounded-panel md:border md:border-line md:bg-surface md:p-2 md:shadow-card"
      >
        <p aria-hidden="true" className="eyebrow hidden px-3 pb-1 pt-2 text-ink-muted md:block">
          Settings
        </p>
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              clsx(
                'flex min-h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full border px-4 text-[13.5px] font-semibold md:rounded-control md:border-0 md:px-3',
                isActive ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink-muted hover:text-ink md:bg-transparent md:hover:bg-surface-2',
              )
            }
          >
            <n.icon size={17} aria-hidden className="hidden md:block" />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
```

`AppShell.tsx` exports `visibleNav`, and `SettingsLayout` imports from `AppShell`. That isn't a cycle, because `AppShell` doesn't import `SettingsLayout`.

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `pnpm --filter @boogbe/app exec vitest run src/components/shell`, then `pnpm --filter @boogbe/app test`.
Expected: all pass.

- [ ] **Step 9: Gate, E2E and screenshots**

1. Run the gate and `pnpm test:e2e`. The mobile project at 360px exercises the new bottom bar; `e02` navigates by URL, so it doesn't depend on the nav.
2. Take screenshots of `/calendar` and `/settings/properties` at 375, 1024 (rail) and 1440, light and dark, plus one at 375 with the More drawer open.

- [ ] **Step 10: Commit and open the PR**

```bash
git add apps/app/src
git commit -m "feat(app): Unclutter-style shell — dark sidebar with rail, phone tabs + More drawer, settings layout [T-UI-02]"
```

---

### Task 3 (T-UI-03): Bookings, calendar, guests and conflicts

**Files (modify only):**
- `apps/app/src/features/bookings/`: `BookingsPage.tsx`, `BookingDetail.tsx`, `NewBookingPage.tsx`, `WebsiteRequestsCard.tsx`, `PriceBreakdown.tsx`, `HoldCountdown.tsx`
- `apps/app/src/features/calendar/`: `CalendarPage.tsx`, `CalendarGrid.tsx`, `DayList.tsx`
- `apps/app/src/features/guests/`: `GuestsPage.tsx`, `GuestDetail.tsx`, `GuestPicker.tsx`
- `apps/app/src/features/ical/`: `ConflictsPage.tsx`

**Interfaces:**
- Consumes `PageHeader`, `CardHeader`, `Card`, `Badge`, `EmptyState` (with `icon`) and `Button size` from T-UI-01.
- Produces nothing new.

**Rule for every page in Tasks 3–5:**
1. Replace the hand-made title row with `<PageHeader>`, keeping the exact `h1` text.
2. Move the row's controls into `actions`.
3. Replace each `<h2 className="…">X</h2>` that opens a `Card` with `<CardHeader title="X" />`.
4. Use the `num` class on money figures.

Everything else (logic, props, copy) stays as it is.

- [ ] **Step 1: Write the failing test.** Create `apps/app/src/features/bookings/BookingDetail.test.tsx`.
- Mock `./hooks` (`useBooking`) and `../../lib/api` the way `StatusActions.test.tsx` mocks its modules.
- Use a tentative fixture with ref `TAN-2610-0001` and an empty `BOOKING_PANELS` (import `./panels` and leave it empty).
- Render `<BookingDetail />` inside `<MemoryRouter initialEntries={['/bookings/b1']}><Routes><Route path="/bookings/:id" element={<BookingDetail />} /></Routes></MemoryRouter>`.

```tsx
it('puts the ref, status and actions in the page header, with a way back on phones', () => {
  // render as above
  const h1 = screen.getByRole('heading', { level: 1, name: 'TAN-2610-0001' });
  const header = h1.closest('.border-b')!; // PageHeader's row
  expect(within(header as HTMLElement).getByText('Tentative')).toBeInTheDocument();
  expect(within(header as HTMLElement).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to bookings' })).toHaveAttribute('href', '/bookings');
  expect(screen.getByRole('heading', { level: 2, name: 'History' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Price' })).toBeInTheDocument();
});
```

The other screens in this task have no new behaviour. Their existing tests (`GuestsPage`, `ConflictsPage`, `CalendarGrid`, `DayList`, `WebsiteRequestsCard`, `HoldCountdown`, `BookingForm`, `GuestPicker`) are the guard, and they must pass unchanged.

- [ ] **Step 2: Run it.** `pnpm --filter @boogbe/app exec vitest run src/features/bookings/BookingDetail.test.tsx`. Expected: FAIL. There is no "Back to bookings" link yet, and Edit sits in a Card rather than the header row.

- [ ] **Step 3: BookingsPage.**
1. Replace `<h1 className="text-xl font-semibold">Bookings</h1>` with `<PageHeader title="Bookings" />`. There's no "New booking" button on this page today; bookings start from the calendar. Don't add one.
2. Wrap the filter grid in `<Card className="p-3">`, keeping its children.
3. Pass `hideOnMobile: true` on the columns that aren't the ref, guest, dates, status or balance.

- [ ] **Step 4: BookingDetail.**

The back link is the one new control in T-UI-03. DESIGN-PROMPT asks for a back button on mobile. It shows on phones only, and its visible text is the chevron plus "Bookings":

```tsx
const back = (
  <Link to="/bookings" aria-label="Back to bookings" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand">
    <ChevronLeft size={16} aria-hidden />
    Bookings
  </Link>
);
```

1. Change the outer grid to `grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]`.
2. Put a `PageHeader` first, spanning both columns (`<div className="xl:col-span-2">`):

```tsx
<PageHeader
  title={b.ref}
  back={back}
  meta={
    <>
      <Badge tone={TONE[b.status]}>{STATUS_LABELS[b.status]}</Badge>
      <WebsiteBadge source={b.source} />
      {b.status === 'tentative' && b.holdUntil && <HoldCountdown holdUntil={b.holdUntil} />}
    </>
  }
  actions={
    <>
      <StatusActions booking={b} onChanged={() => mutate()} />
      {editable && (
        <Button variant="secondary" onClick={() => setEdit(true)}>
          Edit
        </Button>
      )}
    </>
  }
/>
```

3. Remove the h1, the badges and the actions from the first Card. That Card keeps the guest link, the stay line and the notes exactly as they are. The guest line becomes `text-[17px] font-bold`, and there's no new heading, so no copy is added.
4. In the History card, use `<CardHeader title="History" />`. Restyle the list as a timeline: `ol` gets `relative ml-2 border-l border-line pl-4 flex flex-col gap-3`, and each `li` gets a dot, `before:absolute before:-left-[5px] before:mt-1.5 before:size-2 before:rounded-full before:bg-brand`.
5. In the Price card, use `<CardHeader title="Price" />` and `rounded-control` on the stale banner.

- [ ] **Step 5: NewBookingPage.**

```tsx
<div className="flex max-w-2xl flex-col gap-5">
  <PageHeader title="New booking" />
  <Card>
    <BookingForm /* unchanged props */ />
  </Card>
</div>
```

- [ ] **Step 6: WebsiteRequestsCard, PriceBreakdown, HoldCountdown.**
- `WebsiteRequestsCard`: `<CardHeader title="New website requests" />`, and the Card gets `border-brand/30 bg-brand-soft`.
- `PriceBreakdown`: add `num` to amount cells, and give the total row `border-t border-line pt-2 font-bold`.
- `HoldCountdown`: render the countdown as `<Badge tone="warning">`, keeping its text.

- [ ] **Step 7: CalendarPage, CalendarGrid, DayList.**

**CalendarPage:** the title row becomes `<PageHeader title="Calendar" actions={…the existing day/week controls, unchanged…} />`.

**CalendarGrid** (classes only; geometry, `CELL`, the 180px column and `data-testid` stay):
- Outer: `overflow-x-auto rounded-card border border-line bg-surface shadow-card`.
- Day header cells: `eyebrow py-2 text-center`, with `text-ink-muted` normally and `text-brand` on today.
- Property group row: `eyebrow sticky left-0 bg-surface-2 px-3 py-1.5 text-ink-muted`.
- Today's column cells: `bg-brand-soft` instead of `bg-brand/5`.
- Booking bars: `rounded-l-chip` / `rounded-r-chip` instead of `rounded-l-md` / `rounded-r-md`, plus `font-semibold shadow-sm`.

**DayList:** each section is a `Card`; its `h2` becomes `<CardHeader title={`${s.title} (${s.items.length})`} />`. Same for "Free tonight".

- [ ] **Step 8: Guests and conflicts.**

**GuestsPage:**

```tsx
<PageHeader title="Guests" actions={<>{/* the existing search Input (keep aria-label "Search guests"), now className="w-full md:w-64" */}{/* the existing add-guest Button */}</>} />
```

**GuestDetail:**
- `PageHeader title={g.fullName} actions={…the existing edit actions…}`.
- The phone/email line and the "{n} stays · ₦… lifetime" line stay as they are, as two `<p>`s directly under the header (`text-sm text-ink-muted`, with `num` on the amount). They aren't moved into the eyebrow, which would uppercase the email.
- `<CardHeader title="Bookings" />`.

**GuestPicker:** the selected-guest chip gets `rounded-full border border-brand/30 bg-brand-soft px-3 py-1 text-sm font-semibold text-brand`. Its text is unchanged; E2E waits on `getByText('Adaeze Okafor')`.

**ConflictsPage:** `PageHeader title="Channel conflicts"`. The Open/Resolved buttons become a segmented control in `actions`:

```tsx
<div role="group" aria-label="Show" className="inline-flex rounded-control bg-surface-2 p-1">
  {(['open', 'resolved'] as const).map((t) => (
    <button
      key={t}
      aria-pressed={tab === t}
      onClick={() => setTab(t)}
      className={clsx('min-h-9 rounded-[10px] px-4 text-sm font-semibold', tab === t ? 'bg-surface text-ink shadow-card' : 'text-ink-muted')}
    >
      {t === 'open' ? 'Open' : 'Resolved'}
    </button>
  ))}
</div>
```

The button names stay "Open" and "Resolved". `ConflictsPage.test.tsx` finds them by role and name, which `aria-pressed` doesn't change. Import `clsx`.

- [ ] **Step 9: Run tests, gate, E2E and screenshots**

1. Run `pnpm --filter @boogbe/app test`, then the gate, then `pnpm test:e2e`. E02, E03 and E04 all walk these screens.
2. Take screenshots at 375 and 1440, light and dark, of `/bookings`, a booking detail, `/bookings/new`, `/calendar` (desktop grid and phone day list), `/guests`, a guest, and `/conflicts`.

- [ ] **Step 10: Commit and open the PR.** `feat(app): bookings, calendar, guests, conflicts in the new layout [T-UI-03]`

---

### Task 4 (T-UI-04): Money and inventory

**Files (modify only):**
- `apps/app/src/features/payments/`: `MoneyPage.tsx`, `PaymentsPanel.tsx`, `RecordEntryForm.tsx`, `VoidDialog.tsx`
- `apps/app/src/features/inventory/`: `PropertiesPage.tsx`, `PropertyDetail.tsx`, `OwnersPage.tsx`, `UnitFees.tsx`, `UnitForm.tsx`, `PropertyForm.tsx`, `OwnerForm.tsx`, `PropertyOwnerDialog.tsx`, `UnitOwnerDialog.tsx`, `money-input.tsx`
- `apps/app/src/features/ical/CalendarSyncPanel.tsx`
- `apps/app/src/components/PhoneInput.tsx`

**Interfaces:** consumes `PageHeader`, `CardHeader`, `StatTile` and `Badge` from T-UI-01.

- [ ] **Step 1: Write the failing test.** In `apps/app/src/features/payments/MoneyPage.test.tsx`, add a test using the existing fixture:

```tsx
it('shows the three totals as stat tiles and the owed list as a card', async () => {
  // render as the existing test does
  expect(screen.getByRole('heading', { level: 1, name: 'Money' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Guests who still owe' })).toBeInTheDocument();
  const received = screen.getByText('Received');
  expect(received).toHaveClass('eyebrow'); // StatTile label
});
```

- [ ] **Step 2: Run it** (`vitest run src/features/payments`). Expected: FAIL on the `eyebrow` class.

- [ ] **Step 3: MoneyPage.**
1. The header becomes `<PageHeader title="Money" actions={<>{From input}{To input}</>} />`. Keep both `aria-label`s, and give the inputs `className="w-40"`.
2. The totals become `<div className="grid gap-4 md:grid-cols-3">` with:
   - `<StatTile label="Received" value={formatNaira(data.totalReceivedKobo)}>`, keeping its `<ul>` of methods as `children` with `className="mt-3 flex flex-col gap-1 text-sm"` and `num` on the amounts.
   - `<StatTile label="Refunded" value={formatNaira(data.refundsKobo)} />`
   - `<StatTile label="Caution deposits held" value={formatNaira(data.depositsHeldKobo)} />`
3. Both lists use `<CardHeader title="…" />`. Rows get `flex items-center justify-between border-t border-line py-3 text-sm first:border-t-0`, and amounts get `num font-semibold`.

- [ ] **Step 4: PaymentsPanel, RecordEntryForm, VoidDialog.**
- **PaymentsPanel:** `<CardHeader title="Payments" action={…the existing Record payment button…} />`. Rows keep their `<tr>` and the `line-through` class on voided rows; add `num` to amounts.
- **The two forms:** no markup change beyond what the primitives already did. Check them at 375px in the bottom sheet and fix any `grid-cols-2` that's too tight (make it `md:grid-cols-2`).

- [ ] **Step 5: Properties, PropertyDetail, Owners.**
- **PropertiesPage:** `PageHeader title="Properties" actions={canWrite && <Button onClick={() => setOpen(true)}>Add property</Button>}`. Give `EmptyState` `icon={<Building2 />}`.
- **OwnersPage:** `PageHeader title="Property owners" actions={<Button onClick={() => setEdit('new')}>Add owner</Button>}`. Give `EmptyState` `icon={<UserRound />}`.
- **PropertyDetail:**
  - `PageHeader title={p.name} back={…} actions={…existing edit buttons…}`. The back link has the same shape as T-UI-03's: `aria-label="Back to properties"`, `to="/settings/properties"`, with a chevron and "Properties".
  - The address, fee summary and default owner lines stay as `<p>`s, in a `Card` directly under the header, with no new heading.
  - Each unit block is a `Card` with `<CardHeader title={unit.name} action={…unit actions…} />`.
  - `CalendarSyncPanel` and `UnitFees` sit inside their unit cards unchanged.
- **CalendarSyncPanel and UnitFees:** feed-health `Badge`s keep their tones. Rows get `rounded-control border border-line p-3`.

- [ ] **Step 6: Inputs.** In `PhoneInput.tsx` and `money-input.tsx`, the prefix adornments (`+234`, `₦`) become `absolute inset-y-0 left-0 grid place-items-center pl-3.5 text-sm font-semibold text-ink-muted`, and the input gets `pl-12` or `pl-9`. If they're currently rendered as separate boxes, keep the DOM and only change the classes.

- [ ] **Step 7: Run tests, gate, E2E and screenshots.** Screenshots: `/money`, a booking's payments panel, the record-payment sheet at 375, `/settings/properties`, a property, and `/settings/owners`.

- [ ] **Step 8: Commit and open the PR.** `feat(app): money and inventory in the new layout [T-UI-04]`

---

### Task 5 (T-UI-05): Settings, auth, choose operator, platform and placeholders

**Files (modify only):**
- `apps/app/src/routes/settings/`: `OrgProfile.tsx`, `Team.tsx`, `OnlineBooking.tsx`, `AuditLog.tsx`, `Sessions.tsx`, `LogoUpload.tsx`
- `apps/app/src/routes/auth/`: `SignIn.tsx`, `AcceptInvite.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`
- Create: `apps/app/src/routes/auth/AuthFrame.tsx`
- `apps/app/src/routes/ChooseOperator.tsx`, `routes/NotFound.tsx`
- `apps/app/src/routes/platform/`: `OperatorsList.tsx`, `CreateOperator.tsx`, `OperatorDetail.tsx`
- `apps/app/src/router.tsx` (the three placeholder routes)

**Interfaces:**
- Consumes `PageHeader`, `CardHeader` and `EmptyState` with `icon`.
- Produces `AuthFrame({ children })`, used only by the auth pages and ChooseOperator.

- [ ] **Step 1: Write the failing test.** Create `apps/app/src/routes/auth/AuthFrame.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthFrame } from './AuthFrame';

describe('AuthFrame', () => {
  it('wraps the form in a main landmark with the brand panel hidden from assistive tech', () => {
    render(
      <AuthFrame>
        <h1>Sign in to Boogbe</h1>
      </AuthFrame>,
    );
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Sign in to Boogbe' }));
    expect(screen.getAllByRole('heading')).toHaveLength(1); // brand panel adds no heading
    expect(screen.getByText('Your shortlets, at home.').closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it.** Expected: FAIL (the module doesn't exist).

- [ ] **Step 3: AuthFrame.**

```tsx
import { House } from 'lucide-react';
import type { ReactNode } from 'react';

/** Auth pages: a brand panel from lg (decorative), the form card centred on phones. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-surface-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div aria-hidden="true" className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-ink lg:flex">
        <span className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-chip bg-brand text-brand-ink">
            <House size={20} />
          </span>
          <span className="text-xl font-bold tracking-[-0.02em]">Boogbe</span>
        </span>
        <div>
          <p className="text-[40px] font-bold leading-tight tracking-[-0.03em]">Your shortlets, at home.</p>
          <p className="mt-3 max-w-md text-sidebar-muted">Bookings, payments and calendars, under one roof.</p>
        </div>
        <p className="text-sm text-sidebar-muted">by EDGD Media</p>
      </div>
      <main className="mx-auto flex w-full max-w-md flex-col justify-center p-4 py-10">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Auth pages.**

In SignIn, AcceptInvite (both branches), ForgotPassword, ResetPassword and ChooseOperator:
1. Replace the outer `<main className="mx-auto flex min-h-dvh max-w-sm …">` with `<AuthFrame>`.
2. Keep the `h1` text, now styled `mb-6 text-[26px] font-bold tracking-[-0.02em]`.
3. Keep the `Card`, adding `className="p-6"`.

In ChooseOperator, each operator button becomes a full-width `Card`-styled button: `flex min-h-14 w-full items-center justify-between rounded-panel border border-line bg-surface px-4 text-left font-semibold shadow-card hover:border-brand`. Its accessible name is unchanged.

E2E `e01` asserts `heading { name: 'Join … as Admin' }` and the labels "Your name" and "Password". These are unchanged.

- [ ] **Step 5: Settings pages.** Each page now sits inside `SettingsLayout`, so drop its own `max-w-2xl` outer Card and use this shape:

```tsx
<div className="flex max-w-3xl flex-col gap-5">
  <PageHeader title="Business settings" />
  <Card>{/* LogoUpload + the existing form, unchanged */}</Card>
</div>
```

None of these pages has an `h2` today, so they get no `CardHeader`, and no headings are added.

| Page | Title (unchanged) | Notes |
|---|---|---|
| OrgProfile | "Business settings" | One Card holding `LogoUpload`, then the form, as today. |
| Team | "Team" | The invite form stays in its own Card. The members list is a Card with rows `flex items-center justify-between border-t border-line py-3 first:border-t-0`. |
| OnlineBooking | "Online booking" (both branches) | The intro paragraph stays as the first line inside the Card (`text-sm text-ink-muted`). It isn't moved to `eyebrow`, which would uppercase it. Every label is kept. |
| AuditLog | "Audit log" | The filter `Input` (`aria-label="Filter by type"`) goes in `actions`. |
| Sessions | "Signed-in devices" | Each session is a row `border-t border-line py-3 text-sm first:border-t-0` in one Card. The sign-out-others `Button` stays where it is, inside the Card. |

- [ ] **Step 6: Platform.**
- **OperatorsList:** `PageHeader title="Operators" actions={<Link to="/platform/new"><Button>New operator</Button></Link>}`, and `EmptyState icon={<Building2 />}`.
- **CreateOperator:** `<div className="flex max-w-lg flex-col gap-5"><PageHeader title="New operator" /><Card>…form…</Card></div>`.
- **OperatorDetail:** `PageHeader title={data.name} meta={<Badge …>{data.status}</Badge>}`. The three `h2`s become `CardHeader`s with the same text. "Invitations" sits in the same Card as "Members", so give it `<h2 className="mb-3 mt-6 text-[17px] font-bold">` rather than a second `CardHeader`.

E2E `e01` uses the heading `{ name }` (the operator name), the labels "Business name", "Slug" and "Email", and the buttons "Create operator" and "Send". These are unchanged.

- [ ] **Step 7: Placeholders.** In `router.tsx`:
- `/no-access`: `<main className="grid min-h-dvh place-items-center p-6"><EmptyState icon={<KeyRound />} title="No operator yet" body="Ask your operator to invite you." /></main>`
- `/hk` and `/owner`: the same frame, with `icon={<Sparkles />}` and `icon={<FileText />}`, keeping their titles.
- `NotFound`: the same frame, with `icon={<Compass />}`.

- [ ] **Step 8: Run tests, gate, E2E and screenshots.** Screenshots: sign-in at 375 and 1440, accept-invite, choose-operator, each settings page with the side nav (1440) and chips (375), `/platform`, an operator, `/no-access` and a 404. All light and dark.

- [ ] **Step 9: Commit and open the PR.** `feat(app): settings, auth, platform and placeholders in the new layout [T-UI-05]`

---

## After T-UI-05

- Delete `rounded-[var(--radius-card)]` uses that remain (`grep -rn "radius-card" apps/app/src`) in favour of `rounded-card`. Fold this into T-UI-05 if any remain.
- Board: set T-UI-01 to 05 to `done`.
- Tell the owner the redesign is on `dev` and ready for a local walk-through before the next release.
