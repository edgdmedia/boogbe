# Boogbe — Decision Log

Format: ADR-lite. Newest at the bottom. Changing a decision = new entry that supersedes the old one.

| # | Date | Decision | Why | Alternatives rejected |
|---|---|---|---|---|
| D-001 | 2026-10-09 | Build Boogbe as a multi-tenant SaaS; Tanuhomes is tenant #1. | Owner does not want to rebuild for the next client; effort should be sellable. | Custom booking inside the Tanuhomes Astro site (would break its static, low-cost design). |
| D-002 | 2026-10-09 | Phase A = operator back office; Phase B = guest online booking + Paystack. | Lagos short-lets close on WhatsApp with transfers; the trustworthy calendar/ledger is the foundation for online booking. | Guest-first booking engine; both at once. |
| D-003 | 2026-10-09 | v1 includes payments ledger, owner statements, housekeeping, guest messaging. | Owner requirement. Ordered as milestones so Tanuhomes goes live at M4. | Smaller v1. |
| D-004 | 2026-10-09 | Invite-only onboarding; no billing in v1. | Owner signs up operators personally. Tenancy model keeps self-serve/billing additive later. | Self-serve + Paystack subscriptions now. |
| D-005 | 2026-10-09 | Roles: admin, frontdesk, housekeeper, owner (+ platform_admin). | Owner requirement. | — |
| D-006 | 2026-10-09 | Pricing: nightly base rate + unit fees, computed total overridable with reason. | Prices are negotiated on WhatsApp. | Seasonal/date-based rates (later); manual totals only. |
| D-007 | 2026-10-09 | Management fee configurable per property with unit override: % gross, % net, plus optional fixed monthly. | Different owner deals. | Single global rule. |
| D-008 | 2026-10-09 | Messaging: automatic email + WhatsApp click-to-send (wa.me). | Free, no Meta verification. | WhatsApp Business API (cost, setup per operator). |
| D-009 | 2026-10-09 | iCal only for OTA sync. No Airbnb/Booking.com APIs. | Owner decision; APIs need partner approval. | Channel-manager APIs. |
| D-010 | 2026-10-09 | Stack mirrors Unclutter Desk: React/Vite SPA on Cloudflare Pages; NestJS + Prisma + Postgres on a VPS via PM2/nginx. | Owner already runs and knows this stack; patterns and code reusable. | All-Cloudflare (Workers + D1); Next.js + Supabase; Laravel. |
| D-011 | 2026-10-09 | Host API on **edgdmedia's VPS**. | Owner decision. | Unclutter's VPS; new VPS. |
| D-012 | 2026-10-09 | Tenant isolation = app-layer scoping (Prisma extension, as Unclutter) **plus Postgres RLS (forced)**. | Booking and money data; defence in depth against the "accepted tenantId but ignored it" bug class Unclutter hit three times. | App-layer only. |
| D-013 | 2026-10-09 | Better Auth (organization + admin plugins) instead of Unclutter's hand-rolled JWT auth. | Users can belong to multiple operators with different roles; invitations/roles built in; free MIT, self-hosted, data in own Postgres. | Copy Unclutter auth and extend for multi-org. |
| D-014 | 2026-10-09 | Owner is set per unit (effective-dated), with property default owner. | Some properties have one owner; others have different owners per unit. | Owner per property only. |
| D-015 | 2026-10-09 | One owner per unit; joint owners recorded as one owner. | Simplicity for v1. | Co-ownership with shares. |
| D-016 | 2026-10-09 | Property-level expenses allocated to units equally by default or by custom bps. | Shared costs (diesel, estate dues) in multi-owner buildings. | Unit-only expenses. |
| D-017 | 2026-10-09 | Revenue on statements recognised per night (accrual by stay), not by cash received; outstanding balances shown as a note. | Matches how stays map to months; payments are usually upfront in this market. Revisit if operators ask for cash basis. | Cash basis. |
| D-018 | 2026-10-09 | zod schemas in `packages/shared` are the API contract for both apps (nestjs-zod on API, react-hook-form resolver on app). | Two AI agents build API and UI in parallel against one contract. | class-validator DTOs (Unclutter) — not shareable with the frontend. |
| D-019 | 2026-10-09 | Crons run in a separate PM2 process (`boogbe-worker`) from the API. | API reloads don't interrupt jobs; jobs never run twice. | Crons inside the API process. |
| D-020 | 2026-10-09 | Emails go through a DB outbox dispatched by the worker. | No lost or phantom emails on transaction rollback; retries. | Send inline in request. |
| D-021 | 2026-10-09 | Two builders: Claude Code and OpenCode, coordinated via `AGENTS.md` + `docs/COORDINATION.md`. | Owner decision. | — |
