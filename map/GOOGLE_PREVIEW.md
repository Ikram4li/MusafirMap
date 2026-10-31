# Google Maps preview

Separate preview branch; main is unchanged. Google Maps displays the map and Places autocomplete finds destinations. Existing OSM home/boundary service and Turf calculations remain. POIs use pins; cities require explicit OSM boundary selection. Google viewport rectangles are never used as outlines.

Deploy this branch to a preview hostname and add that exact hostname with /* to the Google browser key website restrictions. Enable Maps JavaScript API and Places API (New), billing and quotas. The Pages Function at functions/api/geo/[[path]].js forwards same-origin requests to the existing Worker through the GEO_SERVICE service binding. Configure that binding in the Pages Preview environment; the existing Worker retains its GEOCODER and GEO_CONTACT configuration. Do not point the browser at the production API cross-origin: it expects same-origin requests.

Targeted tests: node --test map/tests/*.test.cjs. These use JSDOM, real Turf and simulated Google responses. They cover pins, colours, city selection, stale-result cancellation and fetch binding. The supplied key, native widget, actual POI coverage and live mobile behaviour are not verified.

Before merging test desktop and Android, venues and chain branches, addresses, postcodes, cities, home search, Locate Me permissions, near-threshold points, radius/units and request failures. Confirm Google attribution is visible on small screens. Provide Google's required public terms/privacy disclosures before launch. Large-venue pins can represent centres rather than entrances. OSM administrative boundaries may differ from settlement boundaries.

## Cloudflare Pages build

In the Pages project's Preview environment, save GOOGLE_MAPS_API_KEY as a secret.
Set the preview build command to `node scripts/build-pages.mjs` and output directory to `dist`; root directory remains the repository root.
Keep Production build settings unchanged: main does not contain this script yet.
Redeploy the preview branch after saving settings. Do not merge to main yet.

The script builds only website files into dist and generates map/google-config.js there.
The tracked blank placeholder is unchanged. The real key is neither logged nor committed,
but is necessarily visible to browsers in the deployed JavaScript.
The build fails when the key is missing or malformed; it does not verify Google billing or restrictions.
Add the exact deployed preview hostname to the key's allowed website referrers.
In Pages Settings > Preview > Bindings > Add > Service binding, name the binding GEO_SERVICE and select the existing musafirmap Worker (the application serving /api/geo, not the Pages website). Save and redeploy the latest preview commit. The adapter preserves the incoming URL and Origin; all five lookup operations use the existing shared queue and cache. No production Worker changes are required.
