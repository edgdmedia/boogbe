# Website listings: Boogbe as the dashboard for the operator's website

**Status:** draft v2 for owner review (API-driven) · **Date:** 2026-10-20 · **First tenant:** Tanuhomes (tanuhomes.com)

## 1. Goal

An operator edits everything about the apartments on their website in Boogbe: names, rates, photos, description, amenities and house rules. The website shows the change **within about 30 seconds**, without EDGD Media. Design and layout stay with EDGD Media.

**Success looks like this:**
- A Tanuhomes admin adds a new apartment in Boogbe, with photos, and ticks "Publish". Moments later tanuhomes.com has a working page for it, with live booking.
- If Boogbe's server goes down, tanuhomes.com keeps serving its apartment pages.

## 2. Decisions (owner)

- **2026-10-20: API-driven, not rebuild on change.** The apartment pages are rendered on Cloudflare from Boogbe's API and cached at the edge. Reasons:
  - updates appear in seconds
  - no CI pipeline or GitHub token to maintain
  - the same renderer later serves other operators (the hosted `<slug>.boogbe.com` pages)

  This relaxes the Tanuhomes "pure static" decision **for the apartment pages only**. The design pages stay static files.
- **Content managed by the operator:** apartment content. **Managed by EDGD Media:** design, layout, general pages, the homepage slideshow and seasonal campaigns.
- Apartment edits are covered by the subscription (handoff note §5).

## 3. Concepts

A website page and a Boogbe unit are not one-to-one. "Destiny" is one page with two bookable units ("1 bedroom" and "2 bedrooms"). The estate (the Boogbe property) is an address, not a brand. So this design adds one new concept:

**Listing:** one apartment page on the operator's website. It belongs to the org and has its own content and photos. It groups **one or more units**, each with a short **option label** ("1 bedroom"). A unit belongs to at most one listing.

| | Owned by | Examples |
|---|---|---|
| **Listing** (new) | website content | name, slug, area, highlight, intro, description, amenities, house rules, photos, cover photo, SEO text, order, published |
| **Unit** (existing) | booking and pricing | bedrooms, max guests, nightly rate, fees including the caution deposit, `publicListed` |
| **Property** (existing) | the building or estate | address; not shown on the site except through the listing's area |

Figures shown on the site are **derived from the units**, never typed twice:
- the headline "From ₦…" is the lowest nightly rate among the listing's bookable units
- the rate list is each unit's option label and rate
- the caution deposit is the unit's deposit fee
- the guest limit is the unit's max guests
- "beds" is the most bedrooms among its units

The six current Tanuhomes listings:

| Listing | Units (option label) |
|---|---|
| Alaska | Alaska |
| Destiny | Destiny 1 bedroom ("1 bedroom"), Destiny 2 bedrooms ("2 bedrooms") |
| Ebony | Ebony 1 bedroom, Ebony 2 bedrooms |
| Kairo | Kairo |
| Lumina | Lumina 1 bedroom, Lumina 2 bedrooms |
| Veyra | Veyra |

## 4. Architecture

```
 Boogbe app ──save──▶ Boogbe API (VPS) ──bumps──▶ org.site_version
                         │  ▲
     photo upload ──▶ R2 (private originals) ──resize job──▶ R2 public bucket ──▶ media.boogbe.com (CDN)
                         │
            GET /v1/public/:slug/site/version   (tiny, edge-cached 15 s)
            GET /v1/public/:slug/site?v=<n>     (all listings, edge-cached by version)
                         ▼
 tanuhomes.com Worker (Astro, Cloudflare adapter)
   ├─ static assets: home, about, contact, … (prerendered, served without running the Worker)
   └─ rendered: /short-lets/, /short-lets/:slug, the homepage apartment cards, /sitemap.xml
        └─ page cache keyed by (path, site_version); fallback: last good copy, then the snapshot built into the deploy
```

**Why versioned caching and not purge.** Every change bumps one number per org, `site_version`. The Worker asks for the current version (a 15-second edge-cached call), and every cache key includes it. A new version means fresh pages. Old ones simply age out. Boogbe needs no Cloudflare API token, and there is no purge call that can fail. Changes are live within about 15–30 seconds.

**Staying up when Boogbe is down.** In order:
1. If the version call fails, use the last version this data centre saw, and serve the cached pages.
2. If `/site` fails, serve the last good `/site` kept in the Worker's Cache API (stored for 30 days).
3. Otherwise, use the **snapshot built into each deploy**: `/site` fetched at build time and bundled with the Worker.

The site therefore never shows an error because of Boogbe. At worst it shows content from the last deploy.

## 5. Boogbe changes

### 5.1 Data (migration 0009)
- `listing`: id, org_id, name, slug (unique per org), area, highlight (the current site's `feature`), intro, description, amenities (text[]), house_rules (text[]), seo_title, seo_description, cover_photo_id, sort_order, published (bool), published_at, created_at, updated_at.
- `listing_slug_history`: listing_id, slug, replaced_at. Old slugs become 301 redirects.
- `listing_photo`: id, listing_id, file_id, alt (required), width, height, sort_order, variants_ready (bool).
- `unit`: add listing_id (nullable FK) and listing_label (nullable text; empty means the unit has no option label, as with Kairo).
- `file.kind`: add `listing_photo`. Photos are JPEG, PNG, WebP or HEIC, up to 15 MB each, and up to 60 photos per listing.
- `organization`: `site_version` bigint, default 1.
- RLS on every new table, as on all org tables.

### 5.2 Versioning
Any change that affects `/site` increments `site_version` **in the same transaction**. Such changes are:
- a listing or photo change, or publishing
- on a linked unit: a change to the rate, fees, bedrooms, guests or `publicListed`, or archiving it

One helper, `bumpSiteVersion(tx)`, is used everywhere. A test proves that each of these writes bumps the version.

### 5.3 Photos
- **Upload:** the client asks the API for a presigned PUT and uploads the original straight to the private R2 bucket (as with logos today). Confirming the upload queues a resize job.
- **Resize job** (sharp on the API server): it reads EXIF orientation and strips metadata, including GPS location from phones. It writes WebP at **480, 800, 1600 and 2400 px wide** to the **public** bucket at `org/<orgId>/listing/<photoId>-<w>.webp` (2400 only when the original is that wide). It then sets `variants_ready` and bumps the version.
- **Public bucket:** `boogbe-media`, served at `media.boogbe.com` with long immutable caching (photo ids never get reused). It holds only published-safe derivatives. Originals and all other files stay private.
- Photos without ready variants are left out of `/site`, and Publish waits for them.

### 5.4 Permissions
`inventory.write` holders (admins) edit listings. Everyone with `inventory.read` can view them.

### 5.5 App: a new **Website** section (Setup group in the sidebar)
- **Listings list:** name, cover, number of units, Published/Draft, drag to reorder, and **View on website** (using the existing website address from Online booking).
- **Listing editor:**
  - name; slug (filled in automatically from the name, and editable, with a warning that the old address will redirect)
  - area, highlight, intro, description, amenities and house rules (chip inputs), SEO text
  - **Units:** pick existing units and give each an option label. Shows each unit's rate and guests, read-only, with a link to edit the unit.
  - **Photos:** upload several at once with progress, drag to order, set the cover, and alt text is required. Each photo shows "Processing…" until its sizes are ready.
  - **Publish / Unpublish.** Publishing is refused until there is a name, intro, description, at least 3 ready photos with alt text, a cover, and at least one unit.
- After a save: "Saved. Live on your website within a minute."
- Unit form: a read-only line "On website: Destiny (1 bedroom)" with a link to the listing.

### 5.6 Public API (read-only, the same CORS and probing rules as the existing public routes)
- `GET /v1/public/:slug/site/version` returns `{ "version": 42 }`, with `Cache-Control: public, max-age=15`.
- `GET /v1/public/:slug/site?v=42` returns everything the site needs. It is immutable per version: `Cache-Control: public, max-age=31536000, immutable`, and a mismatched `v` redirects to the current one.

```jsonc
{
  "version": 42,
  "org": { "name": "Tanuhomes", "slug": "tanuhomes" },
  "listings": [{
    "id": "lst_…", "slug": "destiny", "oldSlugs": ["destiny-ikate"], "name": "Destiny",
    "area": "Ikate, Lekki", "highlight": "…", "intro": "…", "description": "…",
    "amenities": ["…"], "houseRules": ["…"], "seo": { "title": null, "description": null },
    "units": [{ "id": "u_…", "label": "1 bedroom", "bedrooms": 1, "maxGuests": 2,
                "nightlyRateKobo": 17500000, "depositKobo": 10000000, "bookable": true }],
    "photos": [{ "id": "ph_…", "alt": "…", "width": 4032, "height": 3024,
                 "src": "https://media.boogbe.com/org/…/ph_…", "widths": [480, 800, 1600, 2400] }],
    "coverPhotoId": "ph_…", "updatedAt": "…"
  }]
}
```

- Only **published** listings appear, in `sort_order`.
- A unit shows `bookable: true` only when it is active and `publicListed`. Units that aren't bookable still appear, so the page shows the rate with a WhatsApp prompt instead.

## 6. Website changes (tanuhomes repo)

- **Astro switches to on-demand rendering** with the Cloudflare adapter, deployed as the same `tanuhomes` Worker.
  - Every existing page stays **prerendered** (static assets, no Worker run), except these four, which render on demand: `/short-lets/`, `/short-lets/[slug]`, `/sitemap.xml`, and the homepage.
  - The homepage shows apartment cards. It is rendered but cached like the others.
  - The homepage slideshow and its campaigns stay in the repo.
- **Data layer:** `src/lib/site-data.ts` gets the version, then `/site`, then maps the result onto the existing `Property` shape, so `PropertyCard`, the gallery, the lightbox, the rate card and the booking widget barely change. The widget's unit ids now come straight from the API, so `scripts/link-boogbe.mjs`, the name matching and `src/content/properties/*.json` are **removed**.
- **Page cache:** the Worker caches rendered HTML in the Cache API, keyed `path + version`, and sends `Cache-Control: public, max-age=0, s-maxage=60` to browsers and the CDN, so visitors always revalidate cheaply. The fallback order is in §4.
- **Images:** `<img srcset>` points at `media.boogbe.com` WebP variants, with the same `sizes` the site uses today. Nothing is resized at request time, so there is no Cloudflare Images cost.
- **Redirects:** an old slug redirects (301) to the current one. An unpublished or unknown slug gives the existing 404 page.
- **The build snapshot:** `npm run build` fetches `/site` into `src/generated/site-snapshot.json` (the build fails if it's unreachable or empty), and the snapshot is bundled. Local development and tests use `BOOGBE_SITE_FIXTURE=path.json`, so they never need the network.
- **Design changes** still ship as they do today: a commit, then `npm run build`, then `wrangler deploy`.

**Cost:** the Worker runs only for the rendered pages, at a few thousand requests a day for Tanuhomes, well inside Cloudflare's free 100,000 a day. No KV, no D1, no Images.

## 7. Moving the six current apartments

A one-off script, `apps/api/scripts/import-site-listings.ts`, run the same way as the Tanuhomes seed:
- It reads the six `src/content/properties/*.json` files and creates the listings, the text and the unit links (by the unit ids those files already hold).
- It uploads each gallery image's **best copy we hold** (the 1600 px WebP; the 2400 size is skipped) as the original, with its alt, order and cover. The resize job makes the variants.
- It is idempotent and has `--dry-run`.
- Internal notes in today's files (for example "Gym is currently listed as inactive") are **not** published. They go into the property's `notes` in Boogbe.
- Switching over is one tanuhomes PR that deletes the JSON files and turns on the data layer. Before merging, a **pixel parity check** compares the six pages and the listing page with today's live site.

## 8. Errors and edge cases

| Situation | Behaviour |
|---|---|
| Boogbe API is down | Pages are served from the cache, then the last good copy, then the deploy snapshot (§4). The booking widget already falls back to the rate card and WhatsApp. |
| An admin unpublishes every listing | The short-let index shows "New apartments coming soon" plus WhatsApp, and the cards are hidden on the homepage. Boogbe warns before the last unpublish. |
| A photo is still processing | Left out of the page. Publish is blocked until at least 3 photos are ready. |
| A resize job fails | Retried 3 times, then the photo shows "Couldn't process this photo – try another file". |
| A unit linked to a listing is archived | It drops from `units`. If no bookable units are left, the page shows rates and WhatsApp only. |
| Two admins edit the same listing | An `updatedAt` check returns 409, and the editor shows "updated by X at 10:41 – reload". |
| A slug changes | 301 from the old one. The booking widget is unaffected (it uses unit ids). |
| A malicious or very large upload | Content type and size are checked on presign. The resize job decodes with sharp limits (`limitInputPixels`) and refuses non-images. |
| A request for an unknown org slug | The same 404 as any unknown org (no probing). |

## 9. Testing

- **API integration:**
  - listing CRUD and the publish rules
  - slug uniqueness and history
  - RLS isolation between orgs
  - every write that affects `/site` bumps `site_version`, and others don't
  - the `/site` shape: drafts are left out, non-bookable units are flagged, unready photos are left out, and a mismatched `v` redirects
  - the resize job: orientation, metadata stripping, widths, the failure path
- **App:**
  - the listing editor validation
  - photo upload, ordering, cover, alt text and the processing state
  - the publish button's blocked reasons
- **Site:**
  - a data-layer unit test (fixture to `Property`)
  - the cache-key and fallback order, with Boogbe mocked down at each step
  - the existing e2e suites run on a fixture of today's six listings
  - the pixel parity check against today's pages
- **Once, on production:**
  - Edit a rate in Boogbe, then check tanuhomes.com shows it within 60 seconds.
  - Stop the API briefly, then check the apartment pages still load.

## 10. Out of scope

Editing general pages, the homepage slideshow or campaigns (EDGD Media). Image cropping or editing in Boogbe. More than one website per org. The hosted `<slug>.boogbe.com` renderer (it will reuse `/site` and this rendering approach). Paystack.

## 11. Phases

1. **Boogbe listings:** data, versioning, permissions, the Website section, photo upload with the resize job and the public bucket, and the `/site` endpoints. It ships alone, because nothing reads it yet.
2. **Import:** run the import script for Tanuhomes and review the six listings in Boogbe.
3. **Site renderer:** the tanuhomes PR with the Cloudflare adapter, the data layer, the cache and fallbacks, the snapshot, the fixture tests and the parity check. You deploy it.
4. **Production check:** edit a rate and watch the site, then stop the API and confirm the pages still load.
5. **Handoff note:** update the wording to "Website → Listings" and send it.

## 12. Open points for the owner

1. **Naming in the app:** "Website → Listings", as proposed, or "Website → Apartments"?
2. **Media domain:** `media.boogbe.com` for the public photo bucket. Agreed?
3. **Infrastructure the owner sets up:**
   - create the R2 bucket `boogbe-media`, attach it to `media.boogbe.com`, and give the API an R2 key for it
   - the existing private bucket is unchanged
