# Google Maps preview

Separate preview branch; main is unchanged. Google Maps displays the map and Places autocomplete finds destinations. Existing OSM home/boundary service and Turf calculations remain. POIs use pins; cities require explicit OSM boundary selection. Google viewport rectangles are never used as outlines.

Deploy this branch to a preview hostname and add that exact hostname with /* to the Google browser key website restrictions. Enable Maps JavaScript API and Places API (New), billing and quotas. The preview hostname also needs /api/geo/* routed to the existing Worker, including GEOCODER and GEO_CONTACT. Static branch deployment alone does not supply this route. Do not point at the production API cross-origin: it expects same-origin requests.

Targeted tests: node --test map/tests/*.test.cjs. These use JSDOM, real Turf and simulated Google responses. They cover pins, colours, city selection, stale-result cancellation and fetch binding. The supplied key, native widget, actual POI coverage and live mobile behaviour are not verified.

Before merging test desktop and Android, venues and chain branches, addresses, postcodes, cities, home search, Locate Me permissions, near-threshold points, radius/units and request failures. Confirm Google attribution is visible on small screens. Provide Google's required public terms/privacy disclosures before launch. Large-venue pins can represent centres rather than entrances. OSM administrative boundaries may differ from settlement boundaries.
