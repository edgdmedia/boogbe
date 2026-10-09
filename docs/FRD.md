# Boogbe — Functional Requirements Document (v1, Phase A)

**Status:** Draft for owner review · 2026-10-09
Each requirement has a stable ID. Plans, commits, tests and PRs reference these IDs (e.g. `BKG-03`). Acceptance criteria (AC) are the definition of done.

**Conventions used below**
- "Operator" = tenant (Better Auth *organization*). "Org context" = the operator the signed-in user is currently acting in.
- Roles: `admin`, `frontdesk`, `housekeeper`, `owner`. Platform role: `platform_admin`.
- Money is in kobo (integer). Dates are calendar dates in the operator's timezone. A stay is `[checkIn, checkOut)`; nights = `checkOut − checkIn`.
- "Audited" = writes an `audit_log` row (see AUD-01).

---

## PLT — Platform administration

| ID | Requirement | Acceptance criteria |
|---|---|---|
| PLT-01 | Platform admin can create an operator (name, slug, timezone, currency, contact email/phone). | Operator appears in platform list; slug unique, lowercase `[a-z0-9-]{3,40}`; defaults `Africa/Lagos`, `NGN`. |
| PLT-02 | Platform admin can invite the operator's first admin by email. | Invite email sent; link valid 7 days; accepting creates/links the user as `admin` of that operator. |
| PLT-03 | Platform admin can suspend / reactivate an operator. | Suspended operator's members get `403 ORG_SUSPENDED` on every API call; crons skip it; data retained. |
| PLT-04 | Platform admin pages are only reachable by `platform_admin` users. | Non-platform users get 404 for `/platform/*` UI and 403 for `/v1/platform/*` API. |
| PLT-05 | Platform admin can view an operator's member list and resend/revoke invites. | Actions are audited. |

## AUTH — Authentication, membership, roles

| ID | Requirement | Acceptance criteria |
|---|---|---|
| AUTH-01 | Email + password sign-in. | Passwords ≥ 10 chars; Better Auth hashing; generic error on failure (no user enumeration). |
| AUTH-02 | Account lockout / rate limit on sign-in. | 5 failed attempts per account within 15 min → locked 15 min; per-IP rate limit on auth routes. |
| AUTH-03 | Password reset by email. | Reset link valid 1 hour, single-use; all other sessions revoked on reset. |
| AUTH-04 | Admin can invite team members with a role. | Invite email with role; pending invites listed; revocable; expire after 7 days. |
| AUTH-05 | A user may belong to several operators and switch between them. | Org switcher lists memberships; switching sets the session's active organization; data shown changes accordingly. |
| AUTH-06 | Role is checked against the database on every request. | Removing a member or changing their role takes effect on their next request without re-login. |
| AUTH-07 | Users can see and revoke their active sessions. | "Sign out other sessions" works. |
| AUTH-08 | Admin can change a member's role or remove them. | Cannot remove/demote the last `admin`. Audited. |
| AUTH-09 | Permission matrix (below) is enforced server-side. | Each endpoint declares required permission; a test asserts every route has one. |

**Permission matrix**

| Capability | admin | frontdesk | housekeeper | owner |
|---|:-:|:-:|:-:|:-:|
| View calendar, bookings, guests | ✓ | ✓ | — | own units, guest names per setting |
| Create/edit bookings, guests | ✓ | ✓ | — | — |
| Record payments, refunds, deposits | ✓ | ✓ | — | — |
| Override booking total | ✓ | ✓ (reason required) | — | — |
| Properties, units, rates, fees, iCal feeds | ✓ | view | — | — |
| Owners, expenses, statements | ✓ | — | — | own statements (read) |
| Tasks | ✓ all | ✓ all | own assigned | — |
| Message templates | ✓ | view | — | — |
| Team & settings | ✓ | — | — | — |
| Audit log | ✓ | — | — | — |

## ORG — Operator settings

| ID | Requirement | Acceptance criteria |
|---|---|---|
| ORG-01 | Admin edits operator profile: display name, logo, contact email, WhatsApp number (E.164), address. | Logo stored in R2; shown in app header, emails, PDFs. |
| ORG-02 | Operational defaults: timezone, currency (NGN only in v1), default check-in time (14:00), check-out time (12:00), tentative hold hours (24). | Values used by bookings, crons and messages. |
| ORG-03 | Receipt and statement numbering prefixes. | Receipt `<PREFIX>-R-000001`, statement `<PREFIX>-S-2026-10-<seq>`; sequential per operator, no gaps from concurrency (sequence per operator). |
| ORG-04 | Owner visibility setting: whether owners see guest names. | Default off → owners see "Guest" + nights only. |

## INV — Properties, units, owners, fees

| ID | Requirement | Acceptance criteria |
|---|---|---|
| INV-01 | CRUD properties: name, address, area, default owner (optional), notes, active flag. | Archived (inactive) properties hidden from calendar but retained. |
| INV-02 | CRUD units under a property: name, bedrooms, max guests, nightly rate, active flag, sort order. | Unit name unique within property. Rate > 0. |
| INV-03 | Unit owner: each unit has an effective owner = unit.owner ?? property.defaultOwner ?? operator (self-owned). | UI shows the effective owner and where it comes from. Changing ownership affects statements only from the change date forward (see OWN-07). |
| INV-04 | Management fee config at property level with optional unit override: `type` ∈ {`pct_gross`, `pct_net`, `none`}, `percentBps` (0–10000), `fixedMonthlyKobo`. | Effective config = unit override ?? property config. |
| INV-05 | Unit fees: kind ∈ {`caution_deposit`, `cleaning`, `extra_guest`, `other`}, label, amount, basis ∈ {`per_stay`, `per_night`, `per_guest_night`}, `includedGuests` (for extra_guest), refundable flag (true only for caution_deposit), active flag. | Fees feed the price calculation (BKG-04). |
| INV-06 | Owners: CRUD owner records — name, phone, email, bank name, account number, account name, notes. | Owner may exist without a login. "Invite to portal" creates a Better Auth invitation with role `owner` and links `owner.userId` on acceptance. |
| INV-07 | Manual blocks: admin/frontdesk can block a unit for a date range with reason ∈ {`maintenance`, `owner_stay`, `other`} and note. | Block refused if it overlaps an active booking (409 `DATES_UNAVAILABLE`). |

## CAL — Calendar

| ID | Requirement | Acceptance criteria |
|---|---|---|
| CAL-01 | Grid view: units (rows, grouped by property) × dates (columns), default 14 days from today, scroll/jump by date. | Loads ≤ 1 s for 50 units × 31 days on 4G. |
| CAL-02 | Bookings shown as bars coloured by status; manual blocks hatched; iCal blocks grey with source label. | Bar shows guest name (admin/frontdesk), nights. |
| CAL-03 | Tap/click empty cell(s) → new booking prefilled with unit and dates. | Range selection by drag on desktop, start/end taps on mobile. |
| CAL-04 | Conflict markers: cells where an iCal block overlaps a Boogbe booking show a warning icon linking to the conflict. | See ICS-05. |
| CAL-05 | Mobile list view: per-day list of arrivals, departures, in-house. | Default view on narrow screens. |

## GST — Guests

| ID | Requirement | Acceptance criteria |
|---|---|---|
| GST-01 | CRUD guests: full name, phone (E.164), email (optional), notes. | Phone normalised to E.164 with default country NG. |
| GST-02 | Search guests by name, phone, email. | Prefix/contains match, ≤ 300 ms for 10k guests. |
| GST-03 | Duplicate hint: creating a guest with an existing phone or email shows the existing record. | User can pick existing or continue. |
| GST-04 | Guest detail shows booking history and lifetime value. | — |

## BKG — Bookings

| ID | Requirement | Acceptance criteria |
|---|---|---|
| BKG-01 | Create booking: unit, check-in, check-out, guest count, guest, source ∈ {`whatsapp`, `phone`, `walk_in`, `direct`, `airbnb`, `booking_com`, `other`}, notes. | nights ≥ 1; guestCount ≤ unit.maxGuests (overridable by admin with reason). |
| BKG-02 | Availability check before save: no overlap with active bookings (DB exclusion constraint) or manual blocks (checked under a unit row lock). | Overlap → 409 `DATES_UNAVAILABLE` with the conflicting item. Two concurrent creates for the same dates: exactly one succeeds (tested). |
| BKG-03 | iCal-imported blocks overlapping the requested dates produce a **warning** (not a refusal) that must be acknowledged. | Acknowledgement stored on the booking. |
| BKG-04 | Price calculation: `nightly = rate × nights`; fees per basis; extra_guest = amount × max(0, guests − includedGuests) × nights; result is a list of price lines. Caution deposit is a separate line flagged refundable and **excluded from revenue**. | Pure function in `packages/shared`, unit-tested with fixtures. |
| BKG-05 | Total override: user may set a different accommodation total; system stores computed total, final total, and an `adjustment` line for the difference; reason required. | Audited. |
| BKG-06 | Price lines are snapshotted on the booking; later rate/fee changes never alter existing bookings. | Editing dates recomputes only if user chooses "Reprice"; otherwise lines kept and difference flagged. |
| BKG-07 | Statuses: `tentative` → `confirmed` → `checked_in` → `checked_out`; `tentative`/`confirmed` → `cancelled`; `confirmed` → `no_show`. | Invalid transitions → 422. Each transition audited with actor and time. |
| BKG-08 | Tentative holds expire: `holdUntil` = created + operator hold hours; cron cancels expired tentatives (reason `hold_expired`) and notifies creator. | Recording any payment or manual confirm clears the hold. |
| BKG-09 | Auto-confirm on first payment (configurable per operator, default on). | — |
| BKG-10 | Edit booking: dates, unit (move), guest count, guest, notes — re-runs BKG-02. | Moving to another unit keeps price lines unless repriced. |
| BKG-11 | Cancel booking with outcome: refund amount (0..paid), retained amount auto-computed, reason. Refund recorded as a ledger entry (PAY-03). | Cancelled bookings free the dates immediately. |
| BKG-12 | Booking list with filters: date range, status, unit, source, balance due > 0. | Paginated, sortable by check-in. |
| BKG-13 | Booking reference: human-friendly per-operator code, e.g. `TNH-2610-0042`. | Unique per operator. |

## PAY — Payments ledger

| ID | Requirement | Acceptance criteria |
|---|---|---|
| PAY-01 | Record payment against a booking: amount, method ∈ {`bank_transfer`, `cash`, `pos`, `card`, `paystack`, `other`}, date received, reference, note. | Amount > 0. Audited. Generates receipt number (ORG-03). |
| PAY-02 | Record caution deposit received / returned / withheld (with reason). | Withheld amount counts as operator/owner income (damage recovery) on the statement. |
| PAY-03 | Record refund (money returned to guest, non-deposit). | Refund ≤ total paid − total refunded. |
| PAY-04 | Ledger entries are immutable. Corrections = `void` entry referencing the original with reason (admin only). | No UPDATE/DELETE on `payment` rows by app role (enforced by DB grants). |
| PAY-05 | Balance due = Σ non-deposit price lines − Σ payments + Σ refunds (voids excluded). Deposit held = received − returned − withheld. | Computed, never stored; shown on booking, list, guest. |
| PAY-06 | Receipt PDF per payment (operator branding, booking ref, amount, method, balance after). | Downloadable; emailable via MSG. |
| PAY-07 | Money dashboard: received this period by method, outstanding balances list, deposits to return (checked-out bookings with deposit held > 0). | Filters by date range and property. |

## ICS — iCal sync

| ID | Requirement | Acceptance criteria |
|---|---|---|
| ICS-01 | Add import feeds per unit: label/channel, URL (https only). | URL validated by fetching once on save; error shown if not a valid calendar. |
| ICS-02 | Import cron every 15 minutes per feed (jittered); upsert VEVENTs as `block(source=ical, feedId, externalUid)`; delete future blocks whose UID disappeared. | Respects ETag/Last-Modified; timeout 15 s; max 2 MB. |
| ICS-03 | Feed health: `lastSyncedAt`, `lastStatus`, `lastError`, `consecutiveFailures`. Admin alerted after 3 consecutive failures. | Shown on unit settings and calendar header. |
| ICS-04 | Export: per unit, per channel export URL with secret token (`/ical/<token>.ics`), containing active bookings, manual blocks, and iCal blocks from **other** feeds (never echoes a channel's own events back). | Token rotatable; rotating invalidates old URL. Events contain no guest PII (summary "Reserved"/"Blocked"). |
| ICS-05 | Conflicts: an imported block overlapping an active Boogbe booking creates/updates a `sync_conflict` (open/resolved) and notifies admins. | Resolution actions: "Resolved externally", "Cancel Boogbe booking", "Move booking". |
| ICS-06 | "Sync now" button per feed. | Rate-limited to once per minute per feed. |

## MSG — Guest messaging

| ID | Requirement | Acceptance criteria |
|---|---|---|
| MSG-01 | Templates per operator for: `booking_confirmation`, `payment_receipt`, `check_in_details`, `pre_arrival_reminder`, `post_checkout_thanks`, `deposit_returned`; each has email (subject + body) and WhatsApp (text) variants. | Seeded defaults on operator creation; editable by admin. |
| MSG-02 | Placeholders: `{{guest.firstName}}`, `{{booking.ref}}`, `{{booking.checkIn}}`, `{{booking.checkOut}}`, `{{booking.nights}}`, `{{unit.name}}`, `{{property.address}}`, `{{money.total}}`, `{{money.balance}}`, `{{money.lastPayment}}`, `{{operator.name}}`, `{{operator.phone}}`, `{{checkIn.time}}`, `{{checkOut.time}}`, `{{unit.checkInInstructions}}`. | Unknown placeholder → validation error on save. Preview with sample data. |
| MSG-03 | Automatic emails (when guest has email): confirmation on `confirmed`, receipt on payment, check-in details at 10:00 operator time the day before arrival. | Toggle per template per operator. Retries with backoff ×3; failures visible on booking. |
| MSG-04 | WhatsApp click-to-send: each template has a button that opens `https://wa.me/<digits>?text=<encoded>` for the guest's phone. | Logged as `whatsapp_opened` in message log. |
| MSG-05 | Message log per booking: channel, template, recipient, status, time, actor. | — |
| MSG-06 | Email sender: platform domain, display name = operator name, reply-to = operator contact email. | SPF/DKIM/DMARC on platform domain (Resend). |
| MSG-07 | Unit check-in instructions field (rich text, private) used by `check_in_details`. | Not visible to owners. |

## HSK — Housekeeping & tasks

| ID | Requirement | Acceptance criteria |
|---|---|---|
| HSK-01 | Tasks: type ∈ {`turnover`, `cleaning`, `maintenance`, `inspection`}, unit, optional booking, title, notes, dueAt, assignee (member), priority, status ∈ {`todo`, `in_progress`, `done`, `cancelled`}. | — |
| HSK-02 | Auto-create a `turnover` task when a booking is checked out (or at check-out date 12:00 if not marked), due before the next arrival's check-in time (else end of next day). | Idempotent: one turnover per booking. |
| HSK-03 | Default assignee per unit (optional). | Auto tasks assigned to it. |
| HSK-04 | Housekeeper view (mobile): "Today" and "Upcoming" lists of own tasks with unit, address, next arrival time; start / done; add note and up to 5 photos. | Works on a 360 px wide screen; photos compressed client-side ≤ 500 KB each. |
| HSK-05 | "Report issue" from a task or unit → creates `maintenance` task for admins. | — |
| HSK-06 | Admin task board: filters by status, assignee, unit, date. | — |
| HSK-07 | Cancelling a booking cancels its open turnover task. | — |

## OWN — Owners, expenses, statements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| OWN-01 | Expenses: date, property, optional unit, category ∈ {`cleaning`, `repairs`, `utilities`, `diesel`, `estate_dues`, `supplies`, `internet`, `other`}, amount, description, receipt image, `chargeToOwner` flag. | Audited. |
| OWN-02 | Property-level expense allocation across selected units: `equal` (default) or `custom` basis-points summing to 10000. Remainder kobo assigned to the first unit by sort order. | Allocation stored as rows; deterministic. |
| OWN-03 | Revenue recognition: accommodation + non-refundable fee lines of non-cancelled bookings are recognised **per night** (prorated by nights falling in the month; per-stay fees recognised on check-in night); retained amounts of cancelled bookings and withheld deposits recognised on the cancellation/withholding date. | Pure function in `packages/shared`, fixture-tested, sums reconcile to the kobo. |
| OWN-04 | Statement per owner per month: gross revenue per unit, expenses charged to owner (direct + allocated), management fee, fixed fee, opening balance (carried from previous statement if negative), net payout. | `pct_gross`: fee = pct × gross. `pct_net`: fee = pct × max(0, gross − expenses). Rounding half-up per line. |
| OWN-05 | Statement lifecycle: `draft` (regenerable) → `finalised` (immutable snapshot + PDF in R2) → `paid` (payout date, reference). | Finalised statement figures never change; later corrections appear as adjustments in the next statement. |
| OWN-06 | Cron on the 1st at 06:00 operator time generates drafts for the previous month and notifies admins. | Idempotent. |
| OWN-07 | Ownership history: unit ownership changes are effective-dated; statements use the owner effective on each night. | — |
| OWN-08 | Owner portal (role `owner`): own units' calendar (guest names per ORG-04), occupancy % and revenue month-to-date, list and download of finalised statements. | Owner cannot see other owners' units, expenses detail of others, guests' contact details. |
| OWN-09 | Statement shows outstanding guest balances for the period as a note (not deducted). | — |

## NTF — In-app notifications

| ID | Requirement | Acceptance criteria |
|---|---|---|
| NTF-01 | Bell with notifications for: iCal conflict, feed failing, hold expired, statements ready, task reported issue. | Read/unread; per user. |
| NTF-02 | Email copy of critical notifications (conflict, feed failing) to admins. | — |

## AUD — Audit

| ID | Requirement | Acceptance criteria |
|---|---|---|
| AUD-01 | Audit log rows for create/update/delete/status changes on bookings, payments, price overrides, statements, settings, members: actor, action, entity, entityId, before/after JSON (PII-minimised), IP, time. | Append-only (DB grants). |
| AUD-02 | Admin audit viewer with filters. | — |

## NFR — Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | **Tenant isolation:** every tenant table has `org_id` + RLS `FORCE`d; runtime DB role cannot bypass RLS; cross-tenant tests on every endpoint. |
| NFR-02 | **Performance:** p95 API < 300 ms for list/detail endpoints at 50 units / 10k bookings per operator. |
| NFR-03 | **Availability/backups:** nightly `pg_dump` to R2 (30-day retention), pre-deploy dump (14-day local), monthly restore drill documented. RPO 24 h, RTO 4 h. |
| NFR-04 | **Security:** OWASP ASVS L1 basics; helmet; CORS allow-list; CSRF-safe cookie config (SameSite=Lax, same-site subdomains); rate limits; secrets only in env; Sentry with PII scrubbing. |
| NFR-05 | **Privacy (NDPA 2023):** collect minimum guest PII; privacy notice; operator can export and delete a guest's data (delete = anonymise when bookings exist). |
| NFR-06 | **Accessibility:** WCAG 2.2 AA for core flows; touch targets ≥ 44 px. |
| NFR-07 | **Mobile:** usable on Android Chrome at 360 px; first load ≤ 250 KB JS gzipped for the housekeeper route. |
| NFR-08 | **Observability:** structured JSON logs, request IDs, Sentry, `/health` endpoint, cron run log with duration and outcome. |
| NFR-09 | **Localisation:** `en-NG` formatting; ₦ with thousands separators; dates `9 Oct 2026`. |
