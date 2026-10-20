# WL — Website listings (Boogbe as the website's apartment dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim tasks on the board in `docs/COORDINATION.md` as usual.

**Goal:** Operators edit their website's apartments in Boogbe (text, photos, units, publish), and tanuhomes.com renders those pages from Boogbe's API within about 30 s of a save, staying up if Boogbe is down.

**Architecture:** A new `modules/website` in the API holds listings and listing photos. Every write that changes the website bumps `org_settings.site_version`. A cron job turns uploaded originals into WebP variants in a public R2 bucket (`media.boogbe.com`). Two public endpoints serve the version and the whole versioned site payload. The Tanuhomes Astro site gets the Cloudflare adapter. Pages that show listings render on demand from that payload, with HTML cached per `path + version`, and fall back to the last good payload and then to a snapshot built into the deploy. The app gets a **Website → Listings** section.

**Tech Stack:** NestJS + Prisma + Postgres (RLS), `@nestjs/schedule`, `@aws-sdk/client-s3` (R2), **sharp** (new API dependency), React/Vite app, Astro 7 + `@astrojs/cloudflare` (new site dependency) on the existing `tanuhomes` Worker.

**Spec:** `docs/superpowers/specs/2026-10-20-website-listings-design.md` (v2, API-driven)

**Prerequisites:** WB is merged and live (it is). The owner's open points take the spec's proposals: the name is **"Website → Listings"** and the media domain is **`media.boogbe.com`**.

## Spec deviations (decided while planning, 2026-10-20)

1. **Photo categories.** Today's site groups the gallery (Living spaces, Bedrooms, Kitchen & dining…), and the mosaic picks photos by category. So `listing_photo` gets a required `category` from the fixed list in Global Constraints.
2. **Two more listing fields.** `bathrooms_label` (free text, optional, e.g. "2 bathrooms · 3 toilets") and `layout_label` (optional, e.g. "2-bedroom maisonette"). When `layout_label` is empty, the site derives it: one unit gives "N bedroom(s)", several give "1 or 2 bedrooms".
3. **More pages render on demand.** Every page that reads listings, not only the four in spec §6: `/`, `/short-lets/`, `/short-lets/[slug]`, `/about/`, `/contact/`, `/property-management/`, `/property-sales/`, `/rentals/` (they use `PropertyCard` or the enquiry form's apartment list) and `/sitemap.xml`. All of them share the same cache and fallbacks.
4. **`/site` does not depend on online booking being switched on.** A new `public_site_lookup(slug)` needs only an active org. When `public_enabled` is false, every unit is `bookable: false`, so switching off booking never takes the apartment pages down.
5. **No HEIC.** sharp's prebuilt binaries can't decode iPhone HEIC. Uploads accept JPEG, PNG and WebP; iOS Safari already converts photos to JPEG on upload. A HEIC file is refused at presign with "Use a JPEG, PNG or WebP photo."
6. **Import provenance.** `listing_photo.source_ref` (nullable) makes the import script idempotent.

## Global Constraints

- The UI name is **Website → Listings**. Routes are `/website/listings` and `/website/listings/:id`. API routes are `/v1/listings…`, and the public ones are `/v1/public/:slug/site/version` and `/v1/public/:slug/site`.
- Money is in kobo integers on the wire. ₦ formatting happens only in the app and on the site.
- Every new table has `org_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, and the `org_isolation` policy, as in `0002_tenant_base`.
- Every write that changes `/site` output calls `bumpSiteVersion(tx)` **in the same transaction**. Nothing else bumps it.
- Photo uploads: `image/jpeg`, `image/png` or `image/webp`; at most **15 MB** each; at most **60 photos per listing**.
- Variant widths are **480, 800, 1600 and 2400**. A width is only made when the oriented original is at least that wide, but 480 is always made. Variants are WebP at quality 80, with metadata stripped, at the public key `org/<orgId>/listing/<photoId>-<w>.webp`.
- sharp runs with `limitInputPixels: 100_000_000` and `.rotate()` (EXIF orientation) before resizing.
- Publish blockers, with this exact copy: "Add a name", "Add an intro", "Add a description", "Add at least 3 photos" (counting only ready photos), "Every photo needs a description", "Choose a cover photo", "Link at least one unit".
- Photo categories, a fixed list in this order: `Living spaces`, `Bedrooms`, `Kitchen & dining`, `Bathrooms`, `Outdoor spaces`, `Building & shared spaces`, `Cinema & leisure`, `Design details`.
- Slugs match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 60 characters, and are unique per org across current **and** historical slugs of *other* listings.
- Public responses carry no member data, guest data or internal notes. Unknown or inactive org slugs give the same `404 UNAVAILABLE` as WB.
- Cache headers: `/site/version` sends `public, max-age=15`. `/site?v=<current>` sends `public, max-age=31536000, immutable`. A mismatched or missing `v` gives `302` to `?v=<current>` with `no-store`.
- Throttle per IP: `/site/version` 120/min and `/site` 60/min.
- After a save, the app shows: "Saved. Live on your website within a minute."
- Boogbe holds no Cloudflare API token. The site uses no KV, D1 or Cloudflare Images.

## Review Focus

1. **A 48-megapixel phone photo, or a picture with EXIF rotation** should come out the right way up, resized, and with its location data stripped. *Test in Task 5:* a 8000×6000 JPEG with orientation 6 gives variants 480/800/1600/2400, the stored width/height is 6000×8000, and the output has no EXIF.
2. **A listing whose units are all archived or unlisted** should still show its page with rates and WhatsApp, without the booking widget. *Tests in Task 6 (`bookable: false` everywhere) and Task 10 (the mapping gives no `boogbe.units`, so the page uses the rate card).*
3. **A slug renamed a→b→c and then back to a** should send every old address to the current one, with no loops and no 404. *Test in Task 4:* history is {b, c} after the return to a, `oldSlugs` excludes the current slug, and the public payload never lists the current slug as old.
4. **A save landing while a page is being rendered:** the page renders against the version it started with, and `/site?v=old` gives a 302 that the site's fetch follows. *Test in Task 10:* `fetchSite` follows the 302, and the cache key uses the version read at the start of the request.
5. **The operator switches off online booking:** the apartment pages stay up and the widget falls back to the rate card. *Tests in Task 6 (`public_enabled = false` gives `/site` 200 with every unit `bookable: false`) and Task 1 (`public_site_lookup` ignores `public_enabled`).*

---

## Task overview

| Task | Area | Depends on |
|---|---|---|
| T-WL-01 Migration 0009: listings, photos, unit link, site_version, `public_site_lookup` | schema | — |
| T-WL-02 Shared contracts: listing, photo, site payload, publish blockers, slugify, file kind | contract | 01 |
| T-WL-03 `bumpSiteVersion` and wiring into units, fees and properties | api | 01, 02 |
| T-WL-04 Listings API: CRUD, units, order, publish, slug history | api | 03 |
| T-WL-05 Listing photos API, media storage, resize job | api | 04 |
| T-WL-06 Public `/site/version` and `/site` | api | 05 |
| T-WL-07 App: Website → Listings list and editor (text, units, publish) | ui | 04 |
| T-WL-08 App: photo manager; unit form "On website" line | ui | 05, 07 |
| T-WL-09 Import script for today's six Tanuhomes listings | api/script | 05 |
| T-WL-10 Site: data layer, cache and fallbacks, snapshot (tanuhomes repo) | site | 06 |
| T-WL-11 Site: Cloudflare adapter, on-demand pages, redirects, removal of JSON and link script, parity | site | 10 |
| T-WL-12 Owner: media bucket, deploy, import, production checks, handoff note | infra | all |

---

### Task 1 (T-WL-01) [schema]: Migration 0009 — website listings

**Files:**
- Create: `prisma/migrations/0009_website_listings/migration.sql`
- Modify: `prisma/schema.prisma` (new `Listing`, `ListingSlugHistory`, `ListingPhoto`; `Unit.listingId`, `Unit.listingLabel`; `OrgSettings.siteVersion`)
- Modify: `docs/DATA_MODEL.md` (the three tables, the two unit columns, `org_settings.site_version`, `public_site_lookup()`)
- Test: `apps/api/test/listings-schema.int.ts`

**Interfaces:**
- Produces these tables and columns:
  - `listing(id, org_id, name, slug, area, highlight, intro, description, amenities text[], house_rules text[], bathrooms_label, layout_label, seo_title, seo_description, cover_photo_id, sort_order int, published bool, published_at, created_at, updated_at)`, with `UNIQUE(org_id, slug)`
  - `listing_slug_history(id, org_id, listing_id, slug, replaced_at)`, with `UNIQUE(org_id, slug)`
  - `listing_photo(id, org_id, listing_id, file_id, alt, category, width, height, sort_order, variants int[] default '{}', variants_ready bool default false, attempts int default 0, last_error text, source_ref text, created_at)`
  - `unit.listing_id` (FK to listing, `ON DELETE SET NULL`) and `unit.listing_label`
  - `org_settings.site_version bigint NOT NULL DEFAULT 1`
- Produces `public_site_lookup(p_slug text) RETURNS TABLE(org_id text, timezone text, public_enabled bool, public_origins text[])`. It is `SECURITY DEFINER` and matches `o.slug = p_slug AND o.status = 'active'` only. Ownership and grants follow `public_org_lookup`.
- `listing.cover_photo_id` is a FK to `listing_photo(id) ON DELETE SET NULL` (deferrable). `listing_photo.listing_id` cascades on delete.
- `CHECK (category IN (…8 values…))`, `alt text NOT NULL DEFAULT ''` (blank allowed while editing; publishing is blocked instead), `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60)`.
- `file.kind`: if a CHECK constraint exists, recreate it with `listing_photo` added.

- [x] **Step 1: Write the failing test** `listings-schema.int.ts`, covering:
  - org A cannot read org B's listing, photo or slug history (RLS)
  - a duplicate slug in one org is rejected, and the same slug in two orgs is allowed
  - a photo with category `'Garden'` is rejected
  - deleting a listing deletes its photos and sets `unit.listing_id` to null
  - `public_site_lookup('tanuhomes')` returns the org when `public_enabled = false`, and nothing when the org is suspended
  - `site_version` defaults to 1
- [x] **Step 2: Run it.** `pnpm --filter @boogbe/api run test:int -- listings-schema` gives FAIL, because the relation `listing` doesn't exist.
- [x] **Step 3: Write the migration and the Prisma models.** Follow the `0003_inventory` and `0008_public_booking` patterns, plus the grants loop from `0002`. Then run `pnpm db:migrate`. (Done 2026-10-20: grants ride 0001's default privileges; `pnpm db:migrate` script was broken — outer-shell expansion of `$DATABASE_MIGRATE_URL` — applied via direct `prisma migrate dev`, script fixed on dev.)
- [x] **Step 4: Run the test** and the existing `migrations.int.ts`. Both PASS. (7/7 + 2/2; full int gate 261/261)
- [x] **Step 5: Commit.** `feat(db): website listings, photos, site_version [T-WL-01]` — merged via [#95](https://github.com/edgdmedia/boogbe/pull/95)

---

### Task 2 (T-WL-02) [contract]: Shared contracts

**Files:**
- Create: `packages/shared/src/contracts/listings.ts`, `packages/shared/src/contracts/listings.test.ts`
- Modify: `packages/shared/src/contracts/files.ts` (`FileKind` gains `listing_photo`; `FILE_LIMITS.listing_photo = { maxBytes: 15 * 1024 * 1024, types: ['image/jpeg','image/png','image/webp'], uploadable: true }`)
- Modify: `packages/shared/src/index.ts` (exports)

**Interfaces (produced):**
- `PHOTO_CATEGORIES` (readonly tuple, in Global Constraints order) and `type PhotoCategory`
- `slugify(name: string): string`: lower case, strips accents, collapses non-alphanumerics to `-`, trims `-`, cuts to 60 characters
- `ListingInput`: a zod object with name (1–80), slug (regex, optional on create), area, highlight, intro, description (≤ 4000), amenities (string[] ≤ 40, each ≤ 60), houseRules (string[] ≤ 30, each ≤ 200), bathroomsLabel, layoutLabel, seoTitle (≤ 70), seoDescription (≤ 160)
- `ListingUpdate = ListingInput.partial().extend({ expectedUpdatedAt: z.string().datetime() })`
- `ListingUnitsInput = z.array(z.object({ unitId: z.string(), label: z.string().max(40).nullable() })).max(10)`
- `ListingPhotoAttach = { fileId, alt?: string (default ''), category?: PhotoCategory (default 'Living spaces') }` and `ListingPhotoUpdate = { alt?, category? }`
- `Listing` (the response): the fields above plus `id`, `published`, `publishedAt`, `coverPhotoId`, `sortOrder`, `updatedAt`, `units: { id, name, label, nightlyRateKobo, maxGuests, bookable }[]` and `photos: ListingPhoto[]`
- `ListingPhoto = { id, alt, category, width|null, height|null, sortOrder, ready: boolean, failed: boolean, previewUrl: string|null }`
- `publishBlockers(l: Pick<Listing,'name'|'intro'|'description'|'coverPhotoId'|'units'|'photos'>): string[]`, which returns the exact copy from Global Constraints, in that order
- `SitePayload`: the zod shape of spec §5.6, with `photos[].src` the base URL **without** `-<w>.webp`, and `photos[].category` added

- [x] **Step 1: Write the failing tests** in `listings.test.ts`:
  - `slugify('Josephine’s Apartment (Ologolo)') === 'josephines-apartment-ologolo'`
  - `publishBlockers` on an empty draft returns all 7 messages in order
  - a complete listing whose only problem is 2 ready photos and 1 still processing returns only `['Add at least 3 photos']`
  - `ListingUnitsInput` rejects 11 entries
- [x] **Step 2: Run them.** `pnpm --filter @boogbe/shared test` gives FAIL.
- [x] **Step 3: Implement** `listings.ts` and the `files.ts` change. (+ review catch: `.partial()` re-applied the create-time `amenities/houseRules` defaults; ListingUpdate fields are plain-optional now, pinned by a test.)
- [x] **Step 4: Run them.** PASS. `pnpm typecheck` is clean (API and app compile against the new `FileKind`; add `listing_photo` to `UPLOAD_PERMS: ['inventory.write']` and `READ_PERMS: ['inventory.read']` in `files.service.ts`). — 8/8, gates green
- [x] **Step 5: Commit.** `feat(shared): listing and site contracts [T-WL-02]` — merged via [#96](https://github.com/edgdmedia/boogbe/pull/96)

---

### Task 3 (T-WL-03) [api]: `bumpSiteVersion` and its wiring

**Files:**
- Create: `apps/api/src/modules/website/site-version.ts`
- Modify: `apps/api/src/modules/inventory/units.service.ts` (`create` when it sets `listingId`; `update` when rate, bedrooms, maxGuests, name or listing fields change; `setActive`); the unit `publicListed` toggle (the T-WB-03 route); `fees.service.ts` (any fee write on a unit with a `listingId`); `properties.service.ts` (`setActive`); and the org settings write that changes `public_enabled`
- Test: `apps/api/test/site-version.int.ts`

**Interfaces:**
- Produces `bumpSiteVersion(tx: OrgTx): Promise<void>`. It runs `UPDATE org_settings SET site_version = site_version + 1 WHERE org_id = app_current_org()`.
- Produces `siteRelevant(unit: { listingId: string | null }): boolean`. Inventory writes on units with no listing don't bump.

- [ ] **Step 1: Write the failing test.** It's a table-driven test: for each write, read `site_version` before and after. These must give **+1**:
  - unit rate change on a linked unit
  - maxGuests change
  - `setActive(false)`
  - `publicListed` toggle
  - deposit fee update
  - property `setActive(false)` with a linked unit
  - `public_enabled` toggle

  These must give **+0**:
  - rate change on an unlinked unit
  - `checkInInstructions` change
  - a block created

  A failed write (the validation error path) must not bump.
- [ ] **Step 2: Run it.** FAIL.
- [ ] **Step 3: Implement the helper** and call it inside each listed `orgDb.run` transaction.
- [ ] **Step 4: Run it** together with `inventory.int.ts`, `fees-blocks.int.ts` and `public-settings.int.ts`. All PASS.
- [ ] **Step 5: Commit.** `feat(api): site_version bumps on website-relevant writes [T-WL-03]`

---

### Task 4 (T-WL-04) [api]: Listings API

**Files:**
- Create: `apps/api/src/modules/website/website.module.ts`, `listings.controller.ts`, `listings.service.ts`, `listings.mappers.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/listings.int.ts`, plus routes added to `apps/api/test/helpers/routes.ts` (the permissions sweep in `guards.int.ts`)

**Interfaces (routes; read with `inventory.read`, everything else with `inventory.write`):**
- `GET /v1/listings` returns `Listing[]` in `sort_order`. `GET /v1/listings/:id` returns `Listing`.
- `POST /v1/listings` takes a `ListingInput` and returns `Listing`. The slug defaults to `slugify(name)`, with `-2`, `-3`… appended on collision.
- `PATCH /v1/listings/:id` takes a `ListingUpdate`. A mismatched `expectedUpdatedAt` gives **409 `STALE`** with the details `{ updatedAt, updatedBy }`. A slug change pushes the old slug into history and removes the new slug from history if it was this listing's own. Taking a slug that is current *or* historical for another listing gives 409 `SLUG_TAKEN`.
- `PUT /v1/listings/:id/units` takes `ListingUnitsInput`. It sets `listing_id` and `listing_label` on those units and clears them on units no longer included. A unit already linked to another listing gives 409 `UNIT_LINKED`. Only the org's own active units are allowed.
- `PUT /v1/listings/order` takes `{ ids: string[] }` and sets `sort_order`.
- `POST /v1/listings/:id/publish`: when `publishBlockers` is non-empty it gives **422 `PUBLISH_BLOCKED`** with the details `{ blockers: string[] }`; otherwise it sets `published = true` and `published_at`. `POST /v1/listings/:id/unpublish` is the reverse.
- `DELETE /v1/listings/:id` works only when `published = false` and no slug history exists (otherwise 409 `PUBLISHED_BEFORE`; unpublish instead). Deleted photos' variants are left for the public bucket's lifecycle.
- Every write calls `bumpSiteVersion` and writes an audit entry (`listing.created|updated|published|unpublished|deleted|units_set|reordered`).

- [ ] **Step 1: Write the failing tests:**
  - CRUD round trip
  - the slug default and collision suffix
  - the a→b→c→a history case (Review Focus 3)
  - `SLUG_TAKEN` for another listing's historical slug
  - `STALE` on an old `expectedUpdatedAt`
  - `UNIT_LINKED`
  - `PUBLISH_BLOCKED` blockers on an empty draft
  - publish succeeds with fixtures (3 ready photos seeded directly in the DB)
  - a front-desk role gets 403 on writes
  - every write bumps the version once
- [ ] **Step 2: Run them.** FAIL.
- [ ] **Step 3: Implement** the controller, service and mappers. `Listing.units[].bookable = unit.active && unit.publicListed && property.active`.
- [ ] **Step 4: Run them**, plus `guards.int.ts`. PASS.
- [ ] **Step 5: Commit.** `feat(api): website listings CRUD, units, publish [T-WL-04]`

---

### Task 5 (T-WL-05) [api]: Listing photos, media storage, resize job

**Files:**
- Modify: `apps/api/package.json` (add `sharp`), `apps/api/src/env.ts` (`MEDIA_R2_BUCKET`, `MEDIA_PUBLIC_BASE`, both required in production and reusing the `R2_ENDPOINT` and keys), `apps/api/src/common/files/files.module.ts` (provide `MEDIA_STORAGE`: an `R2Storage` on the media bucket, or the existing dev or test storage under a `media/` prefix)
- Create: `apps/api/src/modules/website/listing-photos.service.ts`, `listing-photos.controller.ts`, `listing-photos.job.ts`, `image-variants.ts`
- Test: `apps/api/test/listing-photos.int.ts`, `apps/api/src/modules/website/image-variants.spec.ts`, fixtures `apps/api/test/fixtures/photo-rotated.jpg` (a small JPEG with EXIF orientation 6 and GPS tags; generate it with sharp in the test setup if a binary fixture is unwanted)

**Interfaces:**
- `makeVariants(input: Buffer): Promise<{ width: number; height: number; variants: { w: number; body: Buffer }[] }>` in `image-variants.ts`. It is pure, with no I/O, and follows the Global Constraints rules.
- Routes (`inventory.write`):
  - `POST /v1/listings/:id/photos` takes `ListingPhotoAttach` and returns `ListingPhoto`. The file must be a confirmed `listing_photo`. There are at most 60 photos per listing (beyond that, 422 `TOO_MANY_PHOTOS`). The first photo becomes the cover if none is set.
  - `PATCH /v1/listings/:id/photos/:photoId` takes `ListingPhotoUpdate`.
  - `PUT /v1/listings/:id/photos/order` takes `{ ids }`.
  - `PUT /v1/listings/:id/cover` takes `{ photoId }`, and the photo must be ready.
  - `DELETE /v1/listings/:id/photos/:photoId` clears the cover if it pointed there.
  - Each write calls `bumpSiteVersion`.
- `ListingPhoto.previewUrl` is `${MEDIA_PUBLIC_BASE}/org/<org>/listing/<id>-480.webp` when ready, otherwise null.
- `ListingPhotosJob.tick()` runs on `@Cron('* * * * *')` through `JobRunner.once('website.photos', …)`. It takes up to 10 photos where `variants_ready = false AND attempts < 3`, across orgs, the same way as `claim_outbound`. Add a `SECURITY DEFINER` function `claim_listing_photos(n int)` in **this task's own migration `0010_listing_photo_claim`**.
  - For each photo: read the original via `STORAGE.get`, run `makeVariants`, and `MEDIA_STORAGE.put` each variant with `image/webp` and `Cache-Control: public, max-age=31536000, immutable` (extend `Storage.put` with an optional `cacheControl`).
  - Then, under the org's RLS: set width, height, `variants` and `variants_ready = true`, and call `bumpSiteVersion`.
  - On error: `attempts + 1` and `last_error`. `failed` in the response means `attempts >= 3 && !variants_ready`.

- [ ] **Step 1: Write the failing tests.**
  - `image-variants.spec.ts`:
    - an 8000×6000 orientation-6 JPEG gives width 6000, height 8000, and variant widths `[480, 800, 1600, 2400]`
    - a 700 px-wide PNG gives `[480]`
    - the output metadata (`sharp(v).metadata()`) has no `exif`
    - a non-image buffer throws
  - `listing-photos.int.ts`:
    - presign rejects `image/heic` with "Use a JPEG, PNG or WebP photo." (add the message to the files service for that case)
    - attach requires a confirmed file
    - the 61st photo gives `TOO_MANY_PHOTOS`
    - the job processes a photo, after which the variants exist in the media storage and `ready` is true
    - a corrupt file fails 3 times and then shows `failed: true`
    - ordering, cover and delete each bump the version
- [ ] **Step 2: Run them.** FAIL.
- [ ] **Step 3: Implement** in this order: `image-variants.ts`, then the storage and env changes, then the service and controller, then migration 0010 and the job.
- [ ] **Step 4: Run them** with `files.int.ts` and `jobs.int.ts`. PASS.
- [ ] **Step 5: Commit.** `feat(api): listing photos with WebP variants on media storage [T-WL-05]`

---

### Task 6 (T-WL-06) [api]: Public `/site/version` and `/site`

**Files:**
- Create: `apps/api/src/modules/public/public-site.service.ts`
- Modify: `apps/api/src/modules/public/public.controller.ts` (two routes), `public-org.service.ts` (`resolveSite(slug)` using `public_site_lookup`), `public-cors.ts` (the same per-org origins; GET only)
- Test: `apps/api/test/public-site.int.ts`

**Interfaces:**
- `GET /v1/public/:slug/site/version` returns `{ version: number }`.
- `GET /v1/public/:slug/site?v=` returns a `SitePayload` (from T-WL-02). Headers and the 302 rule are in Global Constraints. It throttles at the limits in Global Constraints.
- What the payload contains:
  - only published listings, in `sort_order`
  - only ready photos, in `sort_order`
  - `units[].bookable = public_enabled && unit.active && unit.publicListed && property.active`
  - `depositKobo` from the unit's deposit fee (0 when none), using the same source the quote uses
  - `oldSlugs` from history, excluding the current slug
  - `photos[].src = ${MEDIA_PUBLIC_BASE}/org/<org>/listing/<photoId>` and `widths = variants`

- [ ] **Step 1: Write the failing tests:**
  - the shape is validated with `SitePayload.parse`
  - drafts are left out
  - a processing photo is left out
  - `public_enabled = false` gives 200 with every unit `bookable: false` (Review Focus 5)
  - an archived unit is `bookable: false`, and the listing still appears (Review Focus 2)
  - `v` missing or old gives 302 to the current version with `no-store`
  - the current `v` sends the immutable header
  - an unknown or suspended org gives 404 `UNAVAILABLE`
  - the payload contains no `notes`, check-in instructions or member fields (assert on a JSON string search)
- [ ] **Step 2: Run them.** FAIL.
- [ ] **Step 3: Implement** the service and routes.
- [ ] **Step 4: Run them** with `public-read.int.ts`. PASS.
- [ ] **Step 5: Commit.** `feat(api): public site payload with versioned caching [T-WL-06]`

---

### Task 7 (T-WL-07) [ui]: Website → Listings, list and editor

**Files:**
- Create: `apps/app/src/features/website/hooks.ts`, `ListingsPage.tsx`, `ListingEditor.tsx`, `ListingUnitsField.tsx`, `ChipListInput.tsx`, and tests `ListingsPage.test.tsx`, `ListingEditor.test.tsx`
- Modify: `apps/app/src/router.tsx` (`/website/listings` and `/website/listings/:id`, behind the `inventory.read` guard used for properties), `apps/app/src/components/shell/AppShell.tsx` (a "Website" item in the **Setup** group, above Settings)

**Interfaces:**
- Consumes the T-WL-04 routes and `publishBlockers` and `slugify` from shared.
- **List page:** each row shows the cover thumbnail (`previewUrl`), the name, "N units", a Published or Draft badge, and drag to reorder (which calls `PUT /order`). It has a **New listing** button and a **View on website** link (`org_settings.public_site_url` + `/short-lets/<slug>/`, shown only when published).
- **Editor:**
  - Text fields, as in the spec.
  - The slug field: an inline warning appears when it changes on a published listing: "The old address will redirect to the new one."
  - The units field: a multi-select of active units, grouped by property, with a label input each. It shows the rate and guests read-only, and links to the unit.
  - After a save, a toast with the exact copy from Global Constraints.
  - On a 409 `STALE`, a banner: "Someone else updated this listing at {time}. Reload to see their changes."
  - The publish bar shows the blockers as a list while blocked, and **Publish** stays disabled until there are none. Published listings show **Unpublish**.

- [ ] **Step 1: Write the failing tests:**
  - the list renders badges and order
  - the editor saves and shows the toast
  - `STALE` shows the banner
  - an empty draft lists all 7 blockers and Publish is disabled
  - changing the slug on a published listing shows the redirect warning
  - a front-desk role sees no edit controls
- [ ] **Step 2: Run them.** `pnpm --filter @boogbe/app test -- website` gives FAIL.
- [ ] **Step 3: Implement** them with the existing form, card and toast components (see `features/inventory/PropertyDetail.tsx` and `UnitForm.tsx`).
- [ ] **Step 4: Run them.** PASS. `pnpm typecheck` and `pnpm lint` are clean.
- [ ] **Step 5: Commit.** `feat(app): Website → Listings list and editor [T-WL-07]`

---

### Task 8 (T-WL-08) [ui]: Photo manager; the "On website" line on units

**Files:**
- Create: `apps/app/src/features/website/PhotoManager.tsx`, `PhotoManager.test.tsx`, `upload-photos.ts`
- Modify: `ListingEditor.tsx` (mount the manager), `apps/app/src/features/inventory/UnitForm.tsx` (a read-only "On website: {listing} ({label})" line with a link, or "Not on your website")

**Interfaces:**
- `uploadPhotos(listingId, files: File[], onProgress)`. For each file in turn: presign (`kind: 'listing_photo'`), then PUT to R2, then confirm, then attach with the defaults (blank alt, `Living spaces`). Photos with a blank alt show a "Needs description" tag, and the "Every photo needs a description" blocker stays until every photo has one.
- **The grid:** each photo shows a thumbnail, or "Processing…" (refetching the listing every 5 s while any photo isn't ready), or "Couldn't process this photo – try another file" when failed. It has an alt input, a category select, **Set as cover**, delete, and drag to reorder.
- Client checks before presign: type and 15 MB, with the same copy as the server.

- [ ] **Step 1: Write the failing tests:**
  - uploading 2 files calls presign, PUT, confirm and attach twice, in order
  - a HEIC file is refused with the copy and makes no network call
  - a processing photo shows "Processing…" and refetches
  - a failed photo shows the failure copy
  - Set as cover calls `PUT /cover`
  - a new photo shows "Needs description", and the blocker clears once an alt is typed
  - UnitForm shows "On website: Destiny (1 bedroom)"
- [ ] **Step 2: Run them.** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** PASS. Then run the app e2e smoke: `pnpm test:e2e -- website` (add `e2e/website.spec.ts`: create a listing, upload 3 small JPEGs with the job triggered through the test-support route, add descriptions, link a unit, publish, and see the Published badge).
- [ ] **Step 5: Commit.** `feat(app): listing photo manager; unit shows its listing [T-WL-08]`

---

### Task 9 (T-WL-09) [api/script]: Import today's Tanuhomes listings

**Files:**
- Create: `apps/api/scripts/import-site-listings.ts`
- Test: `apps/api/test/import-site-listings.int.ts`, plus the fixture dir `apps/api/test/fixtures/site-import/` (one property JSON shaped like tanuhomes' `src/content/properties/*.json`, with three 1600 px WebPs generated in the test setup)

**Interfaces:**
- Run it as `pnpm --filter @boogbe/api exec tsx scripts/import-site-listings.ts <org id|slug> <path to tanuhomes repo> [--dry-run]`.
- For each `src/content/properties/*.json` whose `status` isn't `draft` or `archived`:
  1. Upsert the listing by slug. The fields map as `feature`→`highlight`, `notes`→property `notes` (appended once, with the marker `[website import]`), `bathrooms`→`bathrooms_label` (as a string), `config`→`layout_label` only when it isn't derivable, and `rate` ignored. It stays **unpublished**.
  2. Link the units from `boogbe.units[]` (`unitId`, `label`). A unit is given no label when the file has only one rate.
  3. For each gallery image, in order: if no photo has `source_ref = '<slug>/<file>'`, read `public/assets/images/<file>-1600.webp`, `STORAGE.put` it as a confirmed `listing_photo` file, and attach it with the image's alt and category. The cover is the `hero` image.
- It prints a per-listing summary (created or updated, photos added or skipped, units linked). `--dry-run` writes nothing. Publishing happens in the app after review (T-WL-12), not in the script.

- [ ] **Step 1: Write the failing test:**
  - the import creates 1 listing, links 2 units and attaches 3 photos with `source_ref`
  - a second run adds nothing
  - `--dry-run` writes nothing
  - property notes gain the marker once
  - an unknown unit id fails with a clear message and writes nothing for that listing
- [ ] **Step 2: Run it.** FAIL.
- [ ] **Step 3: Implement** it, reusing the services from Tasks 4 and 5 through the Nest application context (the same pattern as `scripts/seed-tanuhomes.ts`).
- [ ] **Step 4: Run it.** PASS.
- [ ] **Step 5: Commit.** `feat(api): import website listings from the Tanuhomes repo [T-WL-09]`

---

### Task 10 (T-WL-10) [site]: Data layer, cache and fallbacks, snapshot (repo `~/Projects/tanuhomes`)

**Files:**
- Create: `src/lib/site-data.ts`, `src/lib/site-cache.ts`, `scripts/site-snapshot.mjs`, `tests/unit/site-data.test.ts`, `tests/unit/site-cache.test.ts`, `tests/fixtures/site.json` (generated once from today's six JSON files by a small script in `scripts/`, so parity tests start from today's content)
- Modify: `src/lib/property-schema.ts` (the `GalleryImage` change below), `src/lib/format.ts` (`imageUrl`), `package.json` (`build` runs `node scripts/site-snapshot.mjs` first), `.gitignore` (`src/generated/`)

**Interfaces:**
- `GalleryImage` becomes `{ id: number; src: string; widths: number[]; category; alt; width; height }`. `id` is the 1-based position in the order Boogbe sends. `imageUrl(g: GalleryImage, w: number)` gives `${g.src}-${pick(w, g.widths)}.webp`, where `pick` returns the smallest available width ≥ w, otherwise the largest. Update `Picture.astro`, the `srcset` builders, the gallery, the lightbox and the mosaic call sites to the new signature.
- `toProperties(p: SitePayload): Property[]` maps:
  - `name`, `slug`, `area`, `highlight`→`feature`, `intro`, `description`, `amenities`, `houseRules`→`notes`
  - `bathroomsLabel`→`bathrooms`
  - `layoutLabel` or the derived value → `config` (deviation 2)
  - `beds` = the most bedrooms
  - `rate` = the lowest nightly rate among **bookable** units, or the lowest of all units when none are bookable, ÷100
  - `rates` = each unit's `{label ?? config, amount}`
  - `cautionFee` = the first unit's `depositKobo/100` or null
  - `hero` = the cover's position id
  - `boogbe = { units: bookable units as {label, unitId} }`, or `undefined` when none are bookable
  - `service: 'short-let'`, `status: 'enquire'`, `seo`
- `fetchVersion(api, slug, fetchImpl): Promise<number>` and `fetchSite(api, slug, version, fetchImpl): Promise<SitePayload>`, which follows redirects (Review Focus 4) and validates with a local zod copy of `SitePayload`.
- `getListings(ctx: { api: string; slug: string; cache: Cache; snapshot: SitePayload; fetchImpl? }): Promise<{ properties: Property[]; version: number | 'snapshot' }>`. It applies spec §4's fallback order. It stores the last good payload under the cache key `https://site-cache.internal/<slug>/last-good` for 30 days, and keeps the last version this data centre saw under `…/last-version`.
- `scripts/site-snapshot.mjs` writes `src/generated/site-snapshot.json` from `BOOGBE_SITE_FIXTURE` when that is set, otherwise from the API. It exits non-zero when the API is unreachable or returns zero listings.

- [ ] **Step 1: Write the failing tests:**
  - `toProperties(fixture)` deep-equals today's six properties on every field the pages use (name, slug, rates, cautionFee, beds, config, feature, intro, description, amenities, gallery order, alt, category, hero)
  - all units unbookable gives `boogbe` undefined and a rate still present
  - `getListings` covers four cases, each with a mocked fetch and an in-memory `Cache`:
    - the happy path
    - the version call failing, which uses the last version and the cached payload
    - `/site` failing, which uses last-good
    - everything failing with an empty cache, which uses the snapshot
  - `fetchSite` follows a 302
- [ ] **Step 2: Run them.** `npm test` gives FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** PASS.
- [ ] **Step 5: Commit** on `astro-rebuild`: `feat: site data layer from Boogbe with cache fallbacks [T-WL-10]`

---

### Task 11 (T-WL-11) [site]: Cloudflare adapter, on-demand pages, redirects, removals, parity

**Files:**
- Modify: `astro.config.mjs` (add `adapter: cloudflare()` and keep `output: 'static'`; pages opt out of prerendering), `wrangler.jsonc` (`main` from the adapter's build output, plus the `assets` binding; check the current adapter docs through Context7 for Astro 7), every page in deviation 3 (`export const prerender = false`; replace `loadProperties()` with `getListings` through `src/lib/load.ts`), `src/pages/sitemap.xml.ts` (rendered on demand)
- Create: `src/middleware.ts`
  - for rendered routes, look in the HTML cache under the key `https://site-cache.internal/html/<path>?v=<version>`, render on a miss, and store the result (only for status 200)
  - send `Cache-Control: public, max-age=0, s-maxage=60`
  - for `/short-lets/<old>/`, give a 301 to the current slug from `oldSlugs`
  - for an unknown slug, use the existing 404 page with status 404
- Delete: `src/content/properties/*.json`, `src/content.config.ts` (the collection), `scripts/link-boogbe.mjs`, `scripts/boogbe-link-core.mjs`, `tests/unit/boogbe-link.test.ts`, the `link-boogbe` script, the property images under `public/assets/images/` (only after T-WL-12 has run the import on production; until then, keep them in this branch's final commit and delete them in a follow-up commit)
- Modify tests: `test:booking` and `test:draft` build from `BOOGBE_SITE_FIXTURE` variants instead of writing JSON files. The Playwright `webServer` uses `wrangler dev` (or the adapter's preview) so that the rendered routes run.
- Test: `tests/e2e/site-from-boogbe.spec.ts`:
  - parity: each of the 8 rendered pages matches the previous static build pixel for pixel (reuse `parity-visual.spec.ts` against a reference build made from `main` before this change)
  - an old slug gives a 301
  - an unknown slug gives 404
  - with `BOOGBE_API` pointed at a dead port and the snapshot present, every rendered page returns 200

**Interfaces:**
- Consumes `getListings` from T-WL-10. `Astro.locals.listings` is set by the middleware once per request.

- [ ] **Step 1: Write the failing e2e** `site-from-boogbe.spec.ts`.
- [ ] **Step 2: Run it.** `npx playwright test site-from-boogbe` gives FAIL (no adapter).
- [ ] **Step 3: Implement** the adapter, the middleware, the page changes and the removals. `npm run build` with `BOOGBE_SITE_FIXTURE=tests/fixtures/site.json` succeeds, and `node scripts/validate.mjs` passes.
- [ ] **Step 4: Run** `npm test`, `npm run test:booking`, `npm run test:draft` and `npx playwright test`. All PASS, including parity.
- [ ] **Step 5: Commit.** `feat: apartment pages render from Boogbe on Cloudflare [T-WL-11]`

---

### Task 12 (T-WL-12) [infra]: Owner setup, go-live, checks

**Owner + builder.** Nothing here is code. The board records each step's outcome.

1. **Owner, in Cloudflare (EDGD Media account):**
   - create the R2 bucket `boogbe-media`
   - **Settings → Custom domains →** `media.boogbe.com`
   - create an R2 API token with object read/write on `boogbe-media` and the existing private bucket
2. **Owner, on the server:** add `MEDIA_R2_BUCKET=boogbe-media` and `MEDIA_PUBLIC_BASE=https://media.boogbe.com` to the API env, updating the R2 keys if the token changed.
3. **Owner:** merge `dev` into `main`. The API and app deploy, and migrations 0009 and 0010 run.
4. **Builder:** run T-WL-09 for Tanuhomes on the server (`--dry-run` first, then for real), then wait about 2 minutes for the photo job.
5. **Owner:** in Boogbe, open Website → Listings, review the six listings, and **Publish** each one.
6. **Owner:** deploy the site: `cd ~/Projects/tanuhomes && npm run build && npx wrangler deploy`.
7. **Checks on production:**
   - (a) the six pages and the listing page look as before
   - (b) change Alaska's rate in Boogbe, and tanuhomes.com shows it within 60 s; then change it back
   - (c) owner: `pm2 stop boogbe-api` for 2 minutes; the apartment pages still load and the widget shows the rate card; then `pm2 start boogbe-api`
   - (d) upload a photo from a phone to a listing, and it appears on the site
8. **Builder:** delete the old property images from the site repo (the T-WL-11 follow-up commit) and deploy again.
9. **Builder:** update the handoff note: replace "Edit unit → website details" with "Website → Listings", and confirm the "about a minute" timings.

---

## Self-review notes (completed)

- **Spec coverage:**
  - §3 concepts → T1, T2, T4
  - §4 versioning and fallbacks → T3, T10, T11
  - §5.1 data → T1
  - §5.2 versioning → T3
  - §5.3 photos → T5
  - §5.4 permissions → T4, T5, T7
  - §5.5 app → T7, T8
  - §5.6 public API → T6
  - §6 site → T10, T11
  - §7 import and parity → T9, T11
  - §8 edge cases → T4 (STALE, slugs), T5 (failed photos, large uploads), T6 (unknown org, archived units), T11 (API down)
  - §9 production checks → T12
  - The unpublish-everything case (§8) is covered by T11: the listing pages render with zero listings. Add the "New apartments coming soon" copy to `short-lets/index.astro` in T11 Step 3.
- **Types:**
  - `SitePayload`, `Listing`, `ListingPhoto`, `publishBlockers` and `slugify` are defined in T2 and used by T4–T8 and T10 (the site keeps a local zod copy, so it has no workspace dependency).
  - `bumpSiteVersion(tx)` is defined in T3 and used by T4, T5 and T9 (through the services).
  - `getListings` is defined in T10 and used in T11.
- **Proportion:** the spec is about 250 lines and this plan about 400. Code blocks are only signatures and exact values.
