# Website listings: Boogbe as the dashboard for the operator's website

**Status:** draft for owner review · **Date:** 2026-10-20 · **First tenant:** Tanuhomes (tanuhomes.com)

## 1. Goal

An operator edits everything about the apartments on their website in Boogbe: names, rates, photos, description, amenities and house rules. The website updates itself within a few minutes, without EDGD Media. Design and layout stay with EDGD Media.

**Success looks like this:** a Tanuhomes admin adds a new apartment in Boogbe, with photos, and ticks "Publish". About 3 minutes later tanuhomes.com has a working page for it, with live booking, and nobody at EDGD Media touched anything.

## 2. Decisions already made (owner, 2026-10-19/20)

- **Rebuild on change, not cache and revalidate.** The site stays fully static on Cloudflare (no Worker code, lowest cost; see the Tanuhomes rebuild decision). Its pages are built from Boogbe data. A save in Boogbe triggers a rebuild and deploy. Cache and revalidate is kept for the later hosted `<slug>.boogbe.com` pages.
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

The pages of the six current Tanuhomes listings map like this:

| Listing | Units (option label) |
|---|---|
| Alaska | Alaska |
| Destiny | Destiny 1 bedroom ("1 bedroom"), Destiny 2 bedrooms ("2 bedrooms") |
| Ebony | Ebony 1 bedroom, Ebony 2 bedrooms |
| Kairo | Kairo |
| Lumina | Lumina 1 bedroom, Lumina 2 bedrooms |
| Veyra | Veyra |

## 4. Boogbe changes

### 4.1 Data (migration 0009)
- `listing`: id, org_id, name, slug (unique per org), area, highlight (the current site's `feature`), intro, description, amenities (text[]), house_rules (text[]), seo_title, seo_description, cover_photo_id, sort_order, published (bool), published_at, created_at, updated_at.
- `listing_slug_history`: listing_id, slug, replaced_at. Old slugs become redirects.
- `listing_photo`: id, listing_id, file_id, alt (required), width, height, sort_order.
- `unit`: add listing_id (nullable FK) and listing_label (nullable text; empty means the unit has no option label, as with Kairo).
- `file.kind`: add `listing_photo`. Photos are JPEG, PNG or WebP, up to 15 MB each, and up to 60 photos per listing.
- `organization` settings: `site_rebuild` (kind, target, secret held encrypted), `site_rebuild_due_at`, `site_last_build` (status, started_at, finished_at, message).
- RLS on every new table, as on all org tables.

### 4.2 Permissions
`inventory.write` holders (admins) edit listings. Everyone with `inventory.read` can view them.

### 4.3 App: a new **Website** section in the sidebar (Setup group)
- **Listings list:** name, cover, number of units, Published/Draft, and drag to reorder.
- **Listing editor:**
  - name; slug (filled in automatically from the name, and editable)
  - area, highlight, intro, description, amenities and house rules (chip inputs), SEO text
  - **Units:** pick existing units and give each an option label. Shows each unit's rate and guests, read-only, with a link to edit the unit.
  - **Photos:** upload several at once, drag to order, set the cover, and alt text is required. The server reads the width and height on confirm.
  - **Publish / Unpublish.** Publishing is refused until there is a name, intro, description, at least 3 photos with alt text, a cover, and at least one unit.
- **Status strip:** "Website updated 10:42", "Updating your website…" or "Last update failed – we've been notified". The button **Update website now** is for admins.
- **Settings → Online booking** gains a **Website updates** box (platform admin only) for the rebuild target.
- Unit form: a read-only line "On website: Destiny (1 bedroom)" with a link to the listing.

### 4.4 Public API (read-only, same CORS and probing rules as WB)
`GET /v1/public/:slug/site` returns everything a build needs, in one call:

```jsonc
{
  "org": { "name": "Tanuhomes", "slug": "tanuhomes" },
  "contentVersion": "sha256…",          // changes whenever anything below changes
  "listings": [{
    "id": "lst_…", "slug": "destiny", "oldSlugs": ["destiny-ikate"], "name": "Destiny",
    "area": "Ikate, Lekki", "highlight": "…", "intro": "…", "description": "…",
    "amenities": ["…"], "houseRules": ["…"], "seo": { "title": null, "description": null },
    "units": [{ "id": "u_…", "label": "1 bedroom", "bedrooms": 1, "maxGuests": 2,
                "nightlyRateKobo": 17500000, "depositKobo": 10000000, "bookable": true }],
    "photos": [{ "id": "ph_…", "alt": "…", "width": 4032, "height": 3024,
                 "url": "https://…presigned, valid 1 hour" }],
    "coverPhotoId": "ph_…", "updatedAt": "…"
  }]
}
```

- Only **published** listings appear, in `sort_order`.
- A unit shows `bookable: true` only when it is active and `publicListed`. Units that aren't bookable still appear, so the rate is shown with a WhatsApp prompt instead.
- The response is not cached at the edge. Builds are rare.

### 4.5 The rebuild trigger
- Any change that affects `/site` sets `site_rebuild_due_at = now + 90 s`, pushing it back if it is already set. Such changes are a listing edit, a photo change, publishing, a unit rate, fee, bedroom, guest or `publicListed` change on a linked unit, or archiving a linked unit. Several edits in a row cause **one** rebuild.
- An existing-style job runs every 30 s, picks orgs whose time is due, and fires the target:
  - `github_dispatch`: POST `https://api.github.com/repos/{owner}/{repo}/dispatches` with `{"event_type":"boogbe-content"}` and a fine-grained token limited to that one repo's Actions.
  - `url`: a plain POST to a deploy-hook URL (for example a Cloudflare Pages deploy hook, for other tenants later).
- The job records the build status. GitHub reports the result back with a signed `POST /v1/hooks/site-build`, using a per-org secret, and that sets "Website updated 10:42" or "failed". If no report arrives within 15 minutes, the status shows "unknown", not success.
- If firing fails, it retries 3 times with backoff, then shows failed and raises an EDGD platform alert (the existing alert mailer).

## 5. Website changes (tanuhomes repo)

- **The content source** becomes a custom Astro content loader that calls `/site` at build time. It maps the data onto the existing `Property` shape, so pages, cards and the booking widget barely change. The `boogbe.units` link now comes straight from the API, so `scripts/link-boogbe.mjs` and the name matching are **removed**.
- **Images:** the build downloads each photo once. It caches by photo id in the CI cache, and resizes with the existing sharp pipeline (`scripts/images.mjs`: 800 and 1600 WebP, plus the sizes the cards use). The original never reaches the site.
- **Redirects:** `oldSlugs` produce a `_redirects` file (301), and unpublished listings simply stop existing (404).
- **Safety:**
  - The build **fails** if `/site` is unreachable, returns no listings, or fails the existing schema validation, so the live site is left untouched.
  - `validate.mjs` still blocks placeholder text and missing alt text.
- **Local and test builds** use `BOOGBE_SITE_FIXTURE=path.json`, so tests never need the network.
- **CI:** a new GitHub Actions workflow `deploy.yml` in EDGD-Media/tanuhomes:
  - runs on `repository_dispatch: boogbe-content`, push to the release branch, and manual runs
  - steps: install, build, test (unit tests plus the booking e2e on the fixture), then `wrangler deploy` with the `CF_API_TOKEN` and `CF_ACCOUNT_ID` secrets, then a signed report back to Boogbe
  - one run at a time; a newer run cancels a queued older one
- Design changes still ship by pushing to the repo. The same workflow deploys them.

## 6. Moving the six current apartments

A one-off script, `apps/api/scripts/import-site-listings.ts`, run the same way as the Tanuhomes seed:
- It reads the six `src/content/properties/*.json` files and creates the listings, the text and the unit links (by the unit ids those files already hold).
- It uploads the photos: the 1600 px WebP of each gallery image (the best copy we hold), with its alt, order and cover.
- It is idempotent and has `--dry-run`. Afterwards the site's JSON files are deleted in the same tanuhomes PR that switches on the loader.
- Rates come from Boogbe from then on. They already match, which `link-boogbe` checked.
- Internal notes in the current files (for example "Gym is currently listed as inactive") are **not** published. They are moved to the property's `notes` in Boogbe for the team.

## 7. Errors and edge cases

| Situation | Behaviour |
|---|---|
| An admin unpublishes the only listing | Allowed. The build fails ("no listings") and the site stays as it was. Boogbe shows "Last update failed: no published listings". |
| A photo upload is abandoned | An unconfirmed `file` row; the existing clean-up removes it. |
| A unit linked to a listing is archived | It drops from `units`. If no bookable units are left, the page shows rates and WhatsApp only. |
| Two admins edit the same listing | Last save wins, and the editor shows "updated by X at 10:41" when the server version is newer (an `updatedAt` check returns 409). |
| GitHub or Cloudflare is down | The trigger retries, then reports failed. The live site is untouched. **Update website now** retries later. |
| A slug changes | The old slug goes into the history, gets a 301, and the booking widget is unaffected (it uses unit ids). |
| Very large photos | Refused above 15 MB with a clear message. Phone photos are typically 2–5 MB. |

## 8. Testing

- **API integration:**
  - listing CRUD and the publish rules
  - slug uniqueness and history
  - RLS isolation between orgs
  - the `/site` shape, including that drafts and non-bookable units are handled as specified
  - debounce (three edits give one fire)
  - the signed build hook rejects bad signatures
  - retries, then the alert
- **App:**
  - the listing editor validation
  - photo ordering, cover and alt text
  - the publish button's blocked reasons
  - the status strip states
- **Site:**
  - a loader unit test from a fixture
  - the existing e2e suites run on a fixture built from today's six listings, with a pixel parity check against the current pages so the switch-over changes nothing visible
- **End to end, once, on production:** edit a rate in Boogbe, then check tanuhomes.com shows it within 5 minutes.

## 9. Out of scope

Editing general pages, the homepage slideshow or campaigns (EDGD Media). Image cropping or editing in Boogbe. More than one website per org. Hosted `<slug>.boogbe.com` pages (they will reuse `/site` later). Paystack.

## 10. Phases

1. **Boogbe listings:** data, permissions, Website section, photo upload, `/site`. It can ship alone, because nothing reads it yet.
2. **Import:** run the import script for Tanuhomes and review the listings in Boogbe.
3. **Site loader and CI deploy:** the tanuhomes PR with the loader, the image pipeline, the fixture tests, the parity check and `deploy.yml`. After this a manual run deploys from Boogbe data.
4. **Rebuild trigger:** the debounced job, the build hook and the status strip. Then the production end-to-end check.
5. **Handoff note:** update the wording to "Website → Listings" and send it.

## 11. Open points for the owner

1. **Naming in the app:** "Website → Listings", as proposed, or "Website → Apartments"?
2. **The rebuild token:** a fine-grained GitHub token limited to EDGD-Media/tanuhomes Actions, stored encrypted in Boogbe. Agreed?
3. **The handoff note** currently says to edit website details on the unit ("Edit unit → website details"). With listings it becomes "Website → Listings". I'll update it in phase 5.
