# Destination resolution preview

This branch is a review version, not a deployment. It keeps Leaflet and OSM map tiles.
Google search is not active: a restricted key, Google billing setup and a compatible
map/search implementation are still required for that migration.

## What changed

- Searches submit on Enter or Search. Typing no longer calls public Nominatim.
- The selected object type/ID is preserved. Exact selected polygons and exact-ID
  lookup precede boundary discovery.
- A city label node can be resolved through an OSM relation that explicitly uses
  it as `label` or `admin_centre`. Merely containing the point is not sufficient.
- Ambiguous outlines are rejected rather than silently choosing the first.
- Only homes with genuinely missing outlines may receive a circle. Network,
  timeout and throttling errors never mean “boundary absent”.
- Destination areas use polygons; addresses, streets, POIs and postcodes use pins.
- Editing inputs clears the corresponding old result. Out-of-order requests cannot
  replace newer selections. Radius/units changes reuse existing geometry.
- Administrative outlines are labelled as such. They are not asserted to be the
  built-up settlement boundary required by the intended travel interpretation.
- Near-threshold approximate pins and straddling destination areas get guidance.

## Deploy the shared request service BEFORE merging

The existing site is static. `/api/geo/*` must be routed to this Worker; a GitHub
Pages deployment alone will not create that route. This setup needs access to the
Cloudflare account for the domain (or an equivalent hosted service).

1. `cd service && npm ci`
2. Authenticate Wrangler to the Cloudflare account managing musafirmap.com.
3. `npx wrangler secret put GEO_CONTACT` and enter a monitored project contact
   email or the project URL identifying the application.
4. Deploy with `npm run deploy` and route both `musafirmap.com/api/geo/*` and
   `www.musafirmap.com/api/geo/*` to it. Use a preview hostname for testing first.
5. Confirm explicit search, reverse lookup, exact-ID lookup and parent-relation
   resolution on that hostname. Then merge the front end.

One Durable Object named `shared` serialises requests across all users, with at
least 1.1 seconds between upstream request starts and a bounded queue. Positive
boundary responses are cached for 24 hours; address searches/reverse responses
are cached only briefly in memory. The upstream base can be configured with
`NOMINATIM_BASE` when switching to a hosted Nominatim provider.

Public Nominatim policy: https://operations.osmfoundation.org/policies/nominatim/
It forbids client autocomplete, limits aggregate application traffic to 1 request
per second, requires identification/attribution and discourages bulk requests.
This service is for explicit moderate-volume user searches, not autocomplete or
bulk boundary extraction. Public Overpass availability remains an external
constraint. Provider errors are surfaced and not interpreted as missing data.

## Tests

At repository root: `npm ci && npm --prefix service ci && npm test`.
Tests cover resolver identity, ambiguous/missing boundaries, geographic rejection,
pin-only destinations, request deduplication, server queue/caching, and complete
page interactions in JSDOM with real Leaflet/Turf and deterministic API fixtures.

These fixtures are synthetic. They do not prove real-world provider uptime or the
correctness of every city's mapped boundary. A native browser run and live
provider acceptance tests on the preview hostname are required before merging.
No production boundary dataset has been approved as settlement boundaries.

## Rollback

The live `main` branch is unchanged. If deployed later, revert the merge commit to
restore the previous front end. Retain the Worker until no clients need its route.
