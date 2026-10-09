# Boogbe — Product Requirements Document

**Product:** Boogbe by EDGD Media
**Version:** v1 (Phase A — operator back office)
**Status:** Draft for owner review · 2026-10-09
**Owner:** EDGD Media

> *Boogbe* — from the Yoruba "ibùgbé", a dwelling, an abode. It's the place your guests call home, and the place you run it from.
>
> Taglines: "Your shortlets, at home." · "Every stay, in one place." · "Bookings, payments and calendars, under one roof."

---

## 1. Problem

Short-let operators and property managers in Nigeria (starting with Lagos) run their business across WhatsApp chats, phone calls, bank-transfer alerts, Airbnb/Booking.com extranets, spreadsheets and notebooks. The consequences:

- **Double bookings** — a WhatsApp booking is not reflected on Airbnb (or the reverse) until someone remembers to update it.
- **Lost money trail** — part-payments, caution deposits and refunds arrive by transfer, cash or POS and live only in bank alerts and memory. Nobody can say, at a glance, what each guest still owes or which deposits must be returned.
- **Owner reporting is manual** — managers of other people's properties compile monthly income/expense/commission statements by hand.
- **Turnovers slip** — housekeeping is coordinated by chat; a missed clean is discovered by the arriving guest.

Global tools (Lodgify, Hostaway, Guesty, Smoobu, Beds24) are priced in dollars, are built around online card checkout and channel-manager APIs, and do not model how Lagos operators actually work: WhatsApp-first conversations, negotiated prices, bank-transfer payments, refundable caution deposits, and property-management-for-owners as a core business line.

## 2. Product vision

Boogbe is the back office for short-let operators: **one calendar, one ledger, one place** for every booking, payment, clean and owner statement — built for naira, WhatsApp and bank transfers.

Phase A (this document) delivers the operator back office. Phase B adds guest-facing online booking with Paystack checkout.

## 3. Customers and users

**Customer (the tenant / "operator"):** a short-let business or property-management company running roughly 1–50 units. First customer: **Tanuhomes** (Lekki, Lagos — 6 apartments, plus management of owners' properties).

| Persona | Who | Primary needs |
|---|---|---|
| **Admin / Manager** | Operator owner or operations lead | Full picture: calendar, money, owners, settings, team |
| **Front desk** | Reservation / guest-relations staff | Take bookings fast, record payments, message guests |
| **Housekeeper** | Cleaning / maintenance staff, mostly on Android phones | Know what to clean today, mark it done, report issues |
| **Property owner** | Owner whose unit(s) the operator manages | See bookings/occupancy and download monthly statements — read only |
| **Platform admin** | EDGD Media | Create operators, invite their first admin, suspend if needed |

A single person may belong to more than one operator with a different role in each (e.g. an owner whose units are managed by two operators).

## 4. Goals and success metrics

| Goal | Metric | Target |
|---|---|---|
| Tanuhomes runs on Boogbe | All Tanuhomes bookings recorded in Boogbe | 100% within 2 weeks of M4 go-live |
| No double bookings | Overlapping active bookings on one unit | 0 (enforced by database) |
| Money is traceable | Bookings with a correct, explainable balance | 100% |
| Owner statements are automatic | Time to produce a month's owner statements | < 10 minutes for the admin |
| Reusable product | Second operator onboarded with **zero code changes** | Achieved at M8 |
| Low running cost | Infra cost at ≤ 10 operators | Fits on the existing edgdmedia VPS + Cloudflare free/low tiers |

## 5. Scope

### 5.1 In scope — v1 (Phase A)

1. **Multi-tenancy** — operators, team members, roles, invitations; strict data isolation.
2. **Properties & units** — properties group units; owner per unit (default from property); nightly rate; fees.
3. **Calendar** — units × dates grid; bookings and blocks; create from an empty cell.
4. **Bookings & guests** — booking flow with clash check, price calculation with overridable total, statuses, source channel, guest records.
5. **Payments ledger** — payments, part-payments, caution deposits, refunds, receipts (PDF), balances.
6. **iCal sync** — import external calendars every 15 minutes; per-unit export links; clash alerts.
7. **Guest messaging** — automatic emails from templates; WhatsApp click-to-send with prefilled text.
8. **Housekeeping** — automatic turnover tasks on checkout; housekeeper mobile view; issue reporting.
9. **Owners & statements** — owners, expenses (with property-level allocation), monthly statements (PDF), owner read-only portal.
10. **Platform admin** — create/suspend operators, invite first admin.
11. **Audit log** for bookings, money and settings.

### 5.2 Out of scope — v1 (explicitly)

- Self-serve operator signup, subscription billing (Paystack subscriptions come later).
- Guest-facing online booking and online payment (Phase B).
- Airbnb / Booking.com API integration (iCal only).
- WhatsApp Business API (automatic WhatsApp sending).
- Dynamic/seasonal pricing, length-of-stay discounts, rate plans.
- Co-ownership of a single unit with income split by share (record joint owners as one owner).
- Guest ID-document storage, KYC.
- Accounting integrations, multi-currency, multi-language.
- Native mobile apps (the web app is mobile-first and installable as a PWA later).

### 5.3 Phase B (next, not in this spec)

Public booking pages per operator (`<operator>.boogbe.<tld>` and custom domains via Cloudflare for SaaS), Paystack checkout and webhooks, an embeddable booking widget (first used on tanuhomes.com), availability API.

## 6. Key product principles

1. **Never double-book.** The database is the last line of defence, not the UI.
2. **Money is append-only.** Payments and finalised statements are never edited; corrections are new entries.
3. **Negotiation is normal.** Every computed price can be overridden, with a reason recorded.
4. **WhatsApp is the channel.** Every guest message has a one-tap WhatsApp version.
5. **Mobile first** for front desk and housekeepers; desktop-comfortable for admins.
6. **One operator can never see another's data.** Enforced in code *and* in Postgres row-level security.
7. **Naira and Lagos time by default**, stored as configurable per operator.

## 7. Release plan

| Milestone | Outcome |
|---|---|
| M0 Foundation | Platform admin can create an operator and invite an admin who can log in |
| M1 Inventory & calendar | Operator configures properties, units, owners, fees; sees the calendar |
| M2 Bookings & guests | Operator records bookings with clash protection and pricing |
| M3 Payments | Operator records payments/deposits/refunds; receipts; balances |
| M4 iCal | Calendars sync with Airbnb/Booking.com — **Tanuhomes go-live** |
| M5 Messaging | Automatic emails + WhatsApp click-to-send |
| M6 Housekeeping | Turnover tasks + housekeeper view |
| M7 Owners & statements | Expenses, statements, owner portal |
| M8 Hardening | Security review, restore drill, **second operator onboarded** |

## 8. Risks

| Risk | Mitigation |
|---|---|
| Cross-tenant data leak | App-level scoping + Postgres RLS + isolation tests on every endpoint |
| iCal is slow/unreliable (Airbnb refreshes every few hours) | 15-min pulls, clear "last synced" display, clash alerts; document the limitation to operators |
| Building too much before Tanuhomes uses it | Go-live at M4; M5–M7 shaped by real use |
| Single VPS failure | Nightly off-site backups to R2, monthly restore drill, documented rebuild runbook |
| Two AI agents colliding | Contract-first (`packages/shared`), single-owner schema changes, task board in `docs/COORDINATION.md` |

## 9. Related documents

- Functional requirements: [`FRD.md`](FRD.md)
- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Data model: [`DATA_MODEL.md`](DATA_MODEL.md)
- Decisions: [`DECISIONS.md`](DECISIONS.md)
- Testing: [`TESTING.md`](TESTING.md)
- Design spec: [`superpowers/specs/2026-10-09-boogbe-v1-design.md`](superpowers/specs/2026-10-09-boogbe-v1-design.md)
- Agent coordination: [`COORDINATION.md`](COORDINATION.md)
