# Public booking requests (Stage 1 of online booking) — design

Date: 2026-10-15 · Status: approved in conversation, awaiting written-spec review · Owner: edgdmedia

## 1. Goal

Guests on tanuhomes.com see live availability and an exact quote from Boogbe, and submit a **booking request** that lands in Boogbe as a short-held tentative booking for the front desk to confirm. The team and the guest are notified by email. Payment stays offline (transfer/WhatsApp) in this stage.

Success looks like: a guest on a Tanuhomes property page picks an apartment and dates, sees the same total the back office would compute, submits, gets a reference on screen and by email; the front desk gets an email and sees the request in Boogbe; a confirmed request emails the guest; an unconfirmed one expires on its own.

## 2. Roadmap context (only Stage 1 is specified here)

| Stage | Scope | Spec |
|---|---|---|
| **1** | Boogbe public API + emails + front-desk handling + booking widget on the static Tanuhomes site | this document |
| 2 | Resume v1: M5–M8 | existing plans in `docs/plans/` |
| 3 | Hosted booking page `<slug>.boogbe.com` via `apps/tenant-router`, reusing the Stage 1 public API (the long-term destination) | later |
| 4 | Paystack checkout and auto-confirm; automated WhatsApp (Meta Cloud API) for team alerts and guest messages | later |

Stage 1 is built **before** finishing v1 (owner decision, 2026-10-15). M5 pauses after in-flight PRs (#71 and T-M5-04) merge.

## 3. Constraints and decisions

- **Integration shape:** the Tanuhomes site stays pure static Astro (see Tanuhomes decision "pure static, min Cloudflare cost"). The widget is a browser script calling `api.boogbe.com` directly. No Pages Functions, no proxy.
- **Inventory model:** Tanuhomes properties map to Boogbe `property`; each apartment is a Boogbe `unit` with its own rate and calendar (e.g. Destiny → "1 bedroom" ₦175,000 and "2 bedrooms" ₦210,000). Guests choose the apartment.
- **Holds:** a request is a `tentative` booking, `source = 'website'`, held for `public_hold_minutes` (default 120). Front desk confirms or declines; otherwise the existing hold-expiry job cancels it.
- **Notifications:** email only (Resend). No automated WhatsApp in Stage 1. Team email carries a click-to-send "WhatsApp the guest" link.
- **Generic per operator:** everything is keyed by org slug and off by default, so Stage 3 and other operators reuse it unchanged.

## 4. Data changes (one migration)

| Table | Column | Type / default | Purpose |
|---|---|---|---|
| `unit` | `public_listed` | bool, false | Only listed units are visible publicly |
| `org_settings` | `public_enabled` | bool, false | Master switch for `/public/:slug/*` |
| `org_settings` | `public_hold_minutes` | int, 120 (CHECK 15–1440) | Hold length for website requests |
| `org_settings` | `public_origins` | text[], `{}` | Exact origins allowed by CORS on `/public/*` (e.g. `https://tanuhomes.com`, `https://www.tanuhomes.com`) |
| `org_settings` | `public_site_url` | text, null | Operator's website, linked from guest emails |
| `org_settings` | `notify_emails` | text[], `{}` | Extra team recipients for request emails, in addition to `organization.contact_email` |

Booking `source` gains `website` (update `booking-source.ts`, DATA_MODEL.md, any CHECK constraint). RLS policies are unchanged; public reads go through `orgDb.forOrg(orgId)` after resolving the slug.

Settings UI (admin only): Settings → Online booking: on/off, hold minutes, allowed origins, website URL, notify emails; Units: "Show on website" toggle.

## 5. Public API (`apps/api/src/modules/public/`)

All routes are unauthenticated and resolve `:slug` → org. If the org does not exist, is not `active`, or `public_enabled` is false, every route returns `404 UNAVAILABLE` (no distinction, so slugs cannot be probed). Unlisted or inactive units also return `UNAVAILABLE`.

| Route | Response | Throttle (per IP) |
|---|---|---|
| `GET /public/:slug/units` | `[{ id, propertyId, propertyName, name, bedrooms, maxGuests, nightlyRateKobo }]` for listed active units | 60/min |
| `GET /public/:slug/units/:unitId/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` | `{ unitId, from, to, blockedNights: ["YYYY-MM-DD", …], checkInTime, checkOutTime }`; window ≤ 90 days, `from` ≥ today (org timezone) | 60/min |
| `GET /public/:slug/units/:unitId/quote?checkIn&checkOut&guests` | `{ lines: [{ label, amountKobo }], totalKobo, depositKobo, nights }` | 30/min |
| `POST /public/:slug/requests` | `201 { ref, holdUntil, totalKobo }` | 5 per 10 min |

**Availability** merges every source that blocks a night (active bookings incl. tentative, blocks, iCal-imported events) into a flat list of dates. It never returns guest names, refs, sources or block reasons. Implemented on top of the existing calendar/inventory sources, not a parallel query.

**Quote** calls the same pricing function `BookingsService` uses for back-office creation; no second implementation. Errors: `DATES_UNAVAILABLE`, `TOO_MANY_GUESTS`, `INVALID_DATES` (checkOut ≤ checkIn, past dates, > 30 nights).

**Request body:** `{ unitId, checkIn, checkOut, guests, fullName, phone, email?, note?, turnstileToken }`. Validation: name 2–100 chars, phone normalised to E.164 (default region NG), email optional and validated, note ≤ 1000 chars.

**Request flow:**
1. Verify Turnstile token server-side (`TURNSTILE_SECRET_KEY`); failure → `400 VERIFICATION_FAILED`.
2. In one transaction under `forOrg`: find guest by `phone_e164` (update email/name only if empty) or create; create booking via the existing booking-creation path with `status = 'tentative'`, `source = 'website'`, `hold_until = now + public_hold_minutes`, guest note stored in `notes` prefixed "Website request:". `created_by_member_id = null`. The existing exclusion constraint guards double-booking; a conflict maps to `409 DATES_UNAVAILABLE`.
3. Write audit log entry (actor: `public`, IP hash) and a `notification` for admins/front desk.
4. After commit: enqueue emails (§6). Email failure never fails the request.

**CORS:** a per-route middleware on `/public/*` reflects `Origin` only if it is in the resolved org's `public_origins`; no credentials. The app-wide CORS (`APP_ORIGIN`, credentials) is unchanged for all other routes.

**Errors** use the existing error filter format: `UNAVAILABLE`, `DATES_UNAVAILABLE`, `TOO_MANY_GUESTS`, `INVALID_DATES`, `VERIFICATION_FAILED`, `VALIDATION_FAILED`, `RATE_LIMITED`.

## 6. Emails

Sent through the existing mailer/messaging layer (Resend), as org-editable `message_template` rows seeded for every org, each logged in `outbound_message`. From `MAIL_FROM`; Reply-To `organization.contact_email`.

| Key | Trigger | To | Content |
|---|---|---|---|
| `website_request.team` | request created | `contact_email` + `notify_emails` | ref, property/unit, dates, nights, guests, quote total, guest name/phone/email, note, hold expiry (org timezone), **Confirm in Boogbe** deep link, **WhatsApp the guest** `wa.me` link |
| `website_request.received` | request created | guest, if email given | ref, stay summary, quote, "dates held for N hours while we confirm", what happens next, operator contact |
| `booking.confirmed_guest` | a `website` booking moves tentative → confirmed | guest, if email | confirmation, check-in/out times, payment instructions (template text), caution deposit |
| `website_request.closed` | a `website` booking is cancelled (declined or `hold_expired`) while tentative | guest, if email | polite notice, link back to `public_site_url` (omitted when null) |

Failures: message marked `failed` and retried by the existing outbound retry; front desk can see it on the booking.

## 7. Front desk (Boogbe app)

- Tentative `website` bookings show a "Website" badge and a hold countdown on the calendar, bookings list and booking detail.
- Today dashboard: "New website requests" card at the top, listing open requests (soonest expiry first), empty state hidden.
- Bell notification on each new request, linking to the booking.
- Actions on the booking: **Confirm** (existing confirm transition) and **Decline** (existing cancel with reason, preset "Dates not available" / "Other"). Both audited. Hold expiry stays with `booking-holds.job.ts`.

## 8. Tanuhomes site (`~/Projects/tanuhomes`, branch off `main`)

- `property-schema.ts`: optional `boogbe: { units: [{ label, unitId }] }` on each property. Properties without it keep today's `RateCard` unchanged, so the rollout can go one property at a time.
- `site.ts`: `BOOGBE_API`, `BOOGBE_SLUG`, `TURNSTILE_SITE_KEY` (build-time env, public values).
- `BookingWidget.astro`: replaces `RateCard` on linked properties. Server-rendered fallback = current indicative rates + WhatsApp/Call buttons (works without JS or when the API is down).
- `src/scripts/booking.ts` (vanilla TS, no new dependencies):
  1. Apartment toggle when a property has more than one unit.
  2. Two-month calendar, blocked nights struck through, tap check-in then check-out, keyboard accessible, swipe on mobile; fetches availability in 90-day windows.
  3. Guests select 1…`maxGuests`.
  4. Live quote (lines, deposit, total), refreshed on any change.
  5. Request form: name, phone, optional email, optional note, invisible Turnstile; button "Request to book"; copy states the hold length and that payment details follow on WhatsApp.
  6. Success: ref, hold expiry, "Message us on WhatsApp" prefilled with the ref (`waLink`).
  7. Errors: `DATES_UNAVAILABLE` → refresh calendar + message; network/`RATE_LIMITED`/`UNAVAILABLE` → "Couldn't reach booking right now" with WhatsApp kept visible.
- `EnquiryForm` stays for general questions. `privacy.astro` gains a paragraph on booking requests being stored in Boogbe. `track.ts` emits `booking_quote` and `booking_request`.

## 9. Testing

- **API integration (Vitest + test DB):** tenant isolation for every public route (other org's slug/unit → `UNAVAILABLE`); availability exposes no guest data; `public_enabled = false` → `UNAVAILABLE`; quote equals back-office pricing for the same inputs; two concurrent requests for the same nights → one `201`, one `409`; Turnstile failure path; throttle limits; CORS reflects only listed origins.
- **Email:** each trigger produces the right `outbound_message` with `MemoryMailer`; request succeeds when the mailer throws.
- **App:** badge/countdown and Today card render; confirm/decline transitions send the guest emails.
- **Site:** unit tests for date-range selection and quote rendering; one Playwright run against staging: pick dates → quote → request → ref shown.

## 10. Rollout

1. Build behind `public_enabled = false`; verify on staging (`staging-api.boogbe.com`).
2. Production: create Turnstile widget for tanuhomes.com; set `TURNSTILE_SECRET_KEY` on the API.
3. Enter Tanuhomes' six properties and their units with real rates and fees in Boogbe; list them; set origins and notify emails; enable.
4. Ship the site with only **Alaska** linked; watch for a few days (requests, emails, holds expiring).
5. Link the remaining five properties.
6. Resume M5.

## 11. Ownership

- Claude builder: migration, `modules/public`, Turnstile verification, CORS middleware, email templates/triggers, API tests.
- OpenCode: settings and unit toggle UI, front-desk badge/countdown/Today card/decline, Tanuhomes widget and site changes.
- Planner (with owner): Turnstile setup, Tanuhomes data entry, staged rollout.

## 12. Out of scope (Stage 1)

Online payment, auto-confirm, automated WhatsApp, hosted booking pages and custom domains, seasonal/dynamic pricing, promo codes, guest accounts, request edits by the guest.
