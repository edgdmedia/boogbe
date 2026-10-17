# app.boogbe.com redesign — design

**Date:** 2026-10-17 · **Status:** proposed, waiting for owner review · **Plan:** `docs/plans/UI-redesign.md`

## Goal

Give every screen of app.boogbe.com the layout and component style of Unclutter Desk (`~/Projects/Unclutter/unclutterdesk`, packages `ui` and `apps/app`), while keeping Boogbe's own brand and the rules in `DESIGN-PROMPT.md`.

## Decisions (owner, 2026-10-17)

1. **Take Unclutter's layout, keep Boogbe's brand.** We take its shell, component shapes, spacing, radius, shadows and type style. We keep the Boogbe teal and token values, Inter, light *and* dark mode, AA contrast, phone-first layouts and 44px touch targets.
2. **Staged rollout, five PRs to `dev`:**
   1. tokens and primitives
   2. the shell
   3. bookings, calendar, guests and conflicts
   4. money and inventory
   5. settings, auth and platform

   Each PR leaves the app working.
3. T-WB-06/07 were merged before this plan (#79, #80). Their screens are restyled with the rest.

## Not changing

- Routes, URLs, permissions, API calls, page copy, and accessible names (headings, labels, button names). Unit and E2E tests find elements by role, label and text, and they must pass unchanged.
  - A test may change only where this spec moves an element: the sidebar's Settings group (§3) and the bottom bar (§3).
  - The only new copy is in the shell and the navigation: "Operations", "Setup", "Settings", "Business", "More", "Menu", "Collapse", and the phone-only back links on booking and property detail ("Back to bookings", "Back to properties").
- `data-testid` attributes (`cell-*` in `CalendarGrid`, the `data-kind-icon` markers in `NotificationBell`), and the `line-through` class on a voided payment row.
- The calendar grid's mechanics: horizontal scroll, sticky unit column, drag-to-create, and the narrow-screen day list.
- No Unclutter branding: no logos, no pine, clay, navy or gold colours, no therapist wording, no tour, no tenant white-label code, and no `unclutter_*` storage keys.
- No new UI library (no shadcn, Radix or Headless UI). The only new dependency is the self-hosted Inter font package `@fontsource-variable/inter`, because the CSP allows only `'self'` fonts and Inter is currently declared but never loaded.

## 1. Tokens (`packages/ui/src/tokens.css`)

These are Tailwind 4 `@theme` variables. The existing names keep their values, light and dark.

**Added:**
- **Brand scale** (light): `brand-50 #ecf6f3`, `brand-100 #d3ebe4`, `brand-200 #a8d6c9`, `brand-300 #6fb9a6`, `brand-400 #3fb59b`, `brand-500 #1c8a75`, `brand-600 #0f6b5c` (= `brand`), `brand-700 #0c574b`, `brand-800 #0a463c`, `brand-900 #08362f`.
- **Soft brand:** `brand-soft` = `#ecf6f3` light, `#13302a` dark.
- **Sidebar** (dark in both modes, as in Unclutter):

  | Token | Light mode | Dark mode |
  |---|---|---|
  | `sidebar` | `#0b1f1b` | `#08120f` |
  | `sidebar-hover` | `#153530` | `#12231f` |
  | `sidebar-ink` | `#e8eeec` | `#e8eeec` |
  | `sidebar-muted` | `#9fb0ab` | `#9fb0ab` |

  The active item has a `brand-600 → brand-500` gradient and a 3px `brand-400` bar on its left.
- **`line-strong`:** `#c9d3d0` light, `#34443f` dark.
- **Dark values for the status colours,** which today have none:

  | Token | Dark |
  |---|---|
  | `success` | `#4fbf86` |
  | `warning` | `#e0a24a` |
  | `danger` | `#f2766b` |
  | `info` | `#7aa7ff` |

  The light values are unchanged.
- **`danger-ink`** (text on a danger fill): `#ffffff` light, `#2a0703` dark. White on the dark-mode red would fail AA. It replaces the four `text-white` uses.
- **Radius:**

  | Token | Value |
  |---|---|
  | `card` | 24px |
  | `panel` | 20px |
  | `control` | 14px |
  | `chip` | 12px |

  The brief said to keep 14px for cards "or justify a change". The owner chose Unclutter's radius.
- **Shadows** (Unclutter's, tinted with Boogbe ink `rgb(24 45 50)`):
  - `card`: `0 1px 3px rgb(24 45 50/.06), 0 1px 2px rgb(24 45 50/.04)`
  - `raised`: `0 12px 34px rgb(24 45 50/.09)`
  - `modal`: `0 24px 80px rgb(24 45 50/.24)`
  - `button`: `0 6px 18px rgb(15 107 92/.22)`
  
  They're defined as `--elev-*` custom properties, so the dark-mode override applies at runtime. In dark mode, shadows are dropped (`none`) and borders carry the edges.
- **Fonts:** `--font-sans: 'Inter Variable', 'Inter', system-ui, sans-serif`. The font is loaded from the `@fontsource-variable/inter` import in `apps/app/src/main.tsx`.
- **Utilities:**
  - `eyebrow`: 11px, weight 800, uppercase, `0.16em` tracking, `ink-muted`.
  - `num`: tabular numbers.

  Unclutter's eyebrow is 9px in `#94A3B8`, which fails AA on white. Ours is larger and uses `ink-muted` (5.4:1).

## 2. Primitives (`packages/ui/src`)

The existing exports keep their names and props. New props are optional.

| Component | Change |
|---|---|
| `Button` | `rounded-control`, semibold. `primary` gets `shadow-button` and `hover:brightness-110`. New `size?: 'sm' \| 'md'` (default `md`, 44px). `sm` is 36px and only for dense desktop rows. |
| `Input`, `Select` | `rounded-control`, `bg-surface-2` that turns `bg-surface` on focus, a 3px `brand/25` focus ring, and a `line-strong` border. |
| `Textarea` (new) | Same styling as `Input`. Replaces the raw `<textarea>` in `UnitForm`, `BookingForm` and `EditBookingDialog`. |
| `Field` | Label 13px semibold, hint and error 12px. |
| `Card` | `rounded-card`, `shadow-card`, border `line`, `p-5`. New `CardHeader({ title, eyebrow?, action? })` with an `h2` title. |
| `Badge` | A pill with a border and a tone-coloured dot: `dot` defaults to true for status tones and false for `neutral`. The text stays, so colour is never the only signal. |
| `Dialog` | `rounded-card`, `shadow-modal`. **Below `md` it is a bottom sheet:** full width, pinned to the bottom, top corners rounded, with a grab bar. The title id comes from `useId()`; today it is a fixed `dlg-title` shared by every dialog. |
| `Table` | Restyled header (eyebrow cells). **Below `md` each row becomes a card in CSS only:** the same `<tr>`/`<td>` DOM, with labels from `data-label={column.header}`. This avoids duplicate text that would break `getByText` in tests. |
| `EmptyState` | Optional `icon`; surface card with a dashed border. |
| `PageHeader` (new) | `({ title, eyebrow?, meta?, back?, actions? })`. The page's title row: an optional eyebrow, then an `h1` (22px, 26px from `md`, bold, `tracking-[-0.02em]`) with `meta` (badges) beside it. Actions wrap below the title on phones, and a hairline runs underneath. `back` is a link shown on phones only. It sits in the page's normal flow with no negative margins, so it also works inside the settings layout. |
| `StatTile` (new) | `({ label, value, sub?, children? })`. Eyebrow label, a 26px bold `num` value and an optional sub line. |

## 3. Shell (`apps/app/src/components/shell`)

The layout stays CSS-responsive: both the desktop and phone parts render, and breakpoints hide one or the other, as they do today. There is no `matchMedia` in the shell, so tests and the first paint behave the same as now.

**Sidebar** (`<aside>`, `md` and up):
- Dark (`bg-sidebar`).
- **Top:** the Boogbe wordmark tile (a `House` icon in a `brand` square plus "Boogbe"). The org logo and `OrgSwitcher` sit under it.
- **Section "Operations":** Calendar, Bookings, Guests, Money, Conflicts (with its count badge).
- **Section "Setup":** one **Settings** item. It goes to the first settings page the role can see, and is active on every `/settings/*` path.
- **Bottom:** the account block (user name, role, Sign out).
- **Item style:** 44px high, `rounded-control`, 13.5px semibold. Active items use the gradient and bar described in §1.
- **Widths:** the rail (76px, icons only, label shown as a tooltip and kept as the accessible name) is used at `md`–`xl`. Full width (248px) is used at `xl` and up, unless the user collapses it. The collapse choice is saved in `localStorage['boogbe:sidebar-collapsed']`; a failed read means expanded.

**Top strip** (`md` and up): a slim right-aligned strip above the content, holding `NotificationBell`.

**Phone header** (`<header>`, below `md`): logo, `OrgSwitcher`, the conflicts chip when the count is above 0 (kept), and the bell.

**Bottom bar** (below `md`, `aria-label="Main"`):
- Shows the nav items marked `tab: true` that the role can see: Calendar, Bookings, Guests, Money.
- Then a **More** button that opens a left drawer, a native `<dialog>` with the full sidebar inside. The drawer closes on navigation or Escape.
- Style: 68px, `bg-surface/90 backdrop-blur`, active item in `brand`. Safe-area padding at the bottom.

**Nav model:** `NavItem` gains `section: 'main' | 'settings'` and `tab?: true`.
- `OPERATOR_NAV` stays the one source of truth.
- The settings items are Business (`/settings`), Properties, Owners, Team, Online booking, Audit log and Signed-in devices (`/settings/sessions`).
- These leave the sidebar and appear in a **settings layout** (`apps/app/src/components/shell/SettingsLayout.tsx`), which wraps every `/settings/*` route. It's a grouped 216px side list at `md` and up, and scrolling chips below `md`.
- The nav label for `/settings` becomes **Business**; the page's heading stays "Business settings".
- Signed-in devices, which today can only be reached by typing its URL, gets a settings entry. It needs no permission.

## 4. Screens

Every page swaps its hand-made title row for `PageHeader`, keeping the same `h1` text and the same controls in `actions`.

**Detail pages** (BookingDetail, GuestDetail, PropertyDetail, OperatorDetail):
- The title and status badges go in `PageHeader`.
- The body uses `CardHeader` sections.
- From `xl` up there is a main column plus a 360px side column for the booking's payments panel and the guest's stats.

**Money:** the three totals become `StatTile`s. "Guests who still owe" and "Deposits to return" become cards with row lists.

**Calendar:**
- The grid is restyled: `rounded-card`, `shadow-card`, eyebrow day headers, today in `brand-soft`, booking bars in `rounded-chip`.
- Bar colours come from the existing status classes, now using the token tints.
- The mechanics are unchanged (see "Not changing").

**Auth pages:**
- Two panes at `lg` and up: a dark `sidebar`-coloured brand panel with the wordmark and the tagline "Your shortlets, at home.", and the form card on the right.
- One centred card on phones.

**Placeholders** (`/no-access`, `/hk`, `/owner`, NotFound): `EmptyState` on the new surface.

## 5. Verification for every PR

1. **Gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int`, green on the branch rebased onto `dev`.
2. **E2E:** `pnpm test:e2e` (desktop and the 360px mobile project), green.
3. **Screenshots:** a Playwright walk of the PR's screens at 375×812 and 1440×900, in light and dark (`colorScheme`). The screenshots are attached to the PR.
4. **Reviewer:** a fresh reviewer subagent per PR, per `docs/COORDINATION.md`.
5. **No deploys.** There's no staging. The owner checks with a local walk-through, then on production through the normal release.

## Risks

- **Mixed look on `dev`:** between PR 2 and PR 5, some screens look old. This is accepted; it only affects `dev`.
- **Dark mode:** status colours had no dark values. The new ones need a contrast check in the screenshot step (text ≥ 4.5:1 on `surface` and `surface-2`).
- **CSS-only table cards:** `display: block` on table rows. Screen readers on some browsers drop table semantics in that layout. That is acceptable for the phone layout, because each cell carries its label as text.
