# Orbit data sources

This document summarizes third-party feeds used by the app, **which credentials are required**, and **usage constraints**. It is accurate to the best of our knowledge; always read each provider’s current terms before shipping a product.

## CelesTrak TLE (`/NORAD/elements/...`)

- **Role:** Two-line element sets for satellites (not aircraft).
- **Fetch path (current):** the Node API owns the satellite downloads: `GET /api/tle/active` shares one in-flight request between all browsers/tabs, caches in memory and in `.cache/tle/`, and is **stale-while-revalidate** — it answers immediately from the last good catalog (remembered for **30 days**) and refreshes in the background, so no request waits on a slow or blocked provider. CelesTrak asks clients not to fetch more often than its ~2 h update cycle and blocks those that do, so the catalog is refreshed at most every 2 h, and after any failure a provider is left alone for 30 min (2 h if CelesTrak reports "data has not updated").
- **Tiers, in order:** (1) **CelesTrak** `active` group (~12k; already contains Starlink, OneWeb, Iridium, GNSS, GEO, weather, science, stations). (2) **KeepTrack** `brief` catalog — payloads only, deduplicated, element sets under 30 days old, capped at 16,000 with non-Starlink objects kept first — used automatically when you have a KeepTrack key (`KEEPTRACK_API_KEY`, saved from the Keys menu); the key stays on the server. (3) **SatNOGS DB** (`db.satnogs.org/api/tle/`, keyless, Space-Track-derived; only ~1,700 amateur/science/cubesat/ISS objects) — merged **over the last known full catalog** (newer element sets win, nothing is dropped), so a CelesTrak + KeepTrack outage degrades freshness, not scope. Only if no full catalog was ever cached does the layer fall back to SatNOGS alone, and the status line says so.
- **Browser memory:** the browser also keeps its own copy in IndexedDB, so satellites still draw if the local server is down. A partial catalog is trusted for only 10 min before the full one is retried.
- **Alpha-5 IDs:** catalog numbers above 99,999 use a letter prefix (e.g. `A0057`, a Soyuz); these are decoded, not dropped (577 objects were previously invisible).
- **Keys:** None required (KeepTrack optional, for tier 2).
- **Why you may have seen Vite errors for `/norad/elements`:** The real CelesTrak URLs look like `https://celestrak.org/NORAD/elements/gp.php?...`. If `VITE_CELESTRAK_API_BASE` was wrong (e.g. empty or `/`), the app requested `/NORAD/elements/...` on the **dev server origin**, where **no proxy rule exists**, which shows up as an HTTP/proxy error. The base URL logic now forces `/celestrak-proxy` in dev unless you set an explicit `https://celestrak.org` URL.
- **Should `/norad/elements` exist in “the new architecture”?** It is still the **correct upstream path on CelesTrak’s site**. It does not need to be a first-class route on **your** server unless you choose to **centralize** satellite fetching in the same Node layer as planes. Today, satellites remain on the Vite/CelesTrak proxy; **aircraft** use the Node aggregation API under `/api/...`.

## Live aircraft aggregation (`server/index.ts`)

All live aircraft positions are merged **on the server**. The browser calls `GET /api/aircraft?lat=&lon=&distNm=` (proxied to `PLANE_API_TARGET` in dev). Secrets (**OpenSky**, **ADS-B Exchange**) never ship to the client.

### OpenSky Network (primary position layer)

- **Role:** Bounding-box state vectors (`/api/states/all`). Used as the **first-class** position source when OAuth credentials are present; merged with other feeds by **freshest timestamp**, with OpenSky winning ties.
- **Keys:** `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` (OAuth2 client credentials). Without them, the OpenSky layer is skipped (anonymous browser calls are not used here).
- **Limits / policy:** Credit-based usage; see [OpenSky API documentation](https://openskynetwork.github.io/opensky-api/). Academic / non-commercial framing is common; verify for your use case.

### Keyless ADS-B aggregators (primary position + metadata layer)

- **Role:** a fallback chain of community aggregators that share the readsb v2 JSON schema, tried in order until one answers: **adsb.lol** (`api.adsb.lol/v2/point/{lat}/{lon}/{dist}`) → **adsb.fi** (`opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{dist}`) → **Airplanes.live** (`api.airplanes.live/v2/point/...`). They supply registration, type and description that OpenSky does not.
- **Keys:** None. In testing from this machine Airplanes.live answered HTTP 403, which is why it is last in the chain.
- **Behavior:** per-provider request spacing, automatic cooldown after errors or HTTP 429/403 (Retry-After honored), requests quantized to a ~0.1° grid and cached 4 s so panning and multiple tabs share one upstream call, concurrent identical requests coalesced, and the last good snapshot re-served (flagged stale) if every provider fails. Provider health is visible at `GET /health`.
- **Limits / policy:** No SLA; community services, be polite. Airplanes.live additionally has a **non-commercial** emphasis; see [API guide](https://airplanes.live/api-guide/) and [terms](https://airplanes.live/terms-of-use/).

### ADS-B Exchange (optional third layer)

- **Role:** `GET https://gateway.adsbexchange.com/api/aircraft/v2/lat/{lat}/{lon}/dist/{dist}` with `api-auth` header when `ADSBX_API_KEY` is set.
- **Keys:** `ADSBX_API_KEY` (optional).
- **Limits / policy:** Personal vs commercial licensing differs; see [ADSBExchange data products](https://www.adsbexchange.com/data/).

### OpenSky flight history (route hints)

- **Role:** `GET /api/opensky/flights/aircraft` on **this** server proxies OpenSky `flights/aircraft` with the same OAuth token — used for estimated dep/arr airports in the UI.
- **Keys:** Same OpenSky OAuth as above.

### Aircraft photos (optional)

- **Role:** `GET /api/aircraft-photo` searches **Wikimedia Commons** via the [MediaWiki API](https://commons.wikimedia.org/wiki/Commons:API) using `WIKIMEDIA_USER_AGENT`. Results are thumbnails with attribution text for the popup.
- **Keys:** None; comply with [User-Agent policy](https://meta.wikimedia.org/wiki/User-Agent_policy) and license terms shown on each file page.

## Aviationstack (airline airport enrichment)

- **Role:** Flight-status dep/arr when the user selects an airline-like track (client still calls `/aviationstack-proxy` in dev).
- **Keys:** `AVIATIONSTACK_ACCESS_KEY` in `.env.local` (loaded by Vite for the dev proxy only). Production should use `VITE_AVIATIONSTACK_API_BASE` pointing to **your** HTTPS relay that adds `access_key` server-side.
- **Limits:** Quota-priced; keep `VITE_AVIATIONSTACK_MODE=fallback` (default) to avoid burning credits when OpenSky already has airports.

## Live cameras (CCTV) — `server/cctv/`

Real still images published by transportation agencies and cities, fetched live by your local server. Nothing is simulated; where an agency does not publish a camera's facing direction the UI says so instead of guessing.

| Source | Cameras (tested) | Key | Orientation | Terms |
| --- | --- | --- | --- | --- |
| **511-platform family** — one adapter (`server/cctv/sources/iteris511.ts`) for sites that share the same camera list endpoint (`/List/GetData/Cameras`, frames `/map/Cctv/{id}`): Georgia (stills only), Florida, Pennsylvania, North Carolina, Utah, Arizona, Nevada, Idaho, Wisconsin, Louisiana, New England (NH/VT/ME), Connecticut, Alaska, Ontario | ~21,000 | none | traffic direction where published | Each agency's own terms on its 511 site apply. These are the websites' own map data endpoints, **not documented APIs**, so they can change or be rate-limited without notice. |
| Caltrans CWWP2 (`cwwp2.dot.ca.gov/data/d{1-12}/cctv/…`) | ~3,400 | none | traffic direction only | Public Caltrans data |
| TfL JamCams (`api.tfl.gov.uk/Place/Type/JamCam`, frames on TfL's S3 bucket) | ~800 | none | reported view direction | TfL Open Data — **attribution required** |
| DriveBC (`drivebc.ca/api/webcams/`) | ~1,000 | none | reported facing | Open Government Licence – BC — **attribution required** |
| City of Austin (`data.austintexas.gov` dataset `b4k4-adkb`) | ~800 | none | not published | City of Austin Open Data Terms |
| Fintraffic road-weather cameras (`tie.digitraffic.fi/api/weathercam/v1/stations`, frames `weathercam.digitraffic.fi`) | ~2,300 | none (sends `Digitraffic-User`) | not published | CC BY 4.0 — **attribution required** |
| City of Calgary (`data.calgary.ca` dataset `k7p9-kppz`, frames `trafficcam.calgary.ca`) | ~220 | none | not published | Open Government Licence – City of Calgary — **attribution required** |
| Hong Kong Transport Department "Traffic Snapshot Images" (`static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml`, frames `tdcctv.data.one.gov.hk/<key>.JPG`) | ~1,000 (973 after validation) | none | not published | Published on data.gov.hk; the dataset page states no licence (checked 2026-10-06). Refreshed about every 2 minutes. Attribution given |
| NZ Transport Agency Waka Kotahi (the agency's own journey-planner map data `www.journeys.nzta.govt.nz/assets/map-data-cache/cameras.json`, frames `www.trafficnz.info/camera/<id>.jpg`) | ~250 online | none (the registered developer API is not used) | traffic direction where published | NZTA publishes its traffic data openly, reported as CC BY 4.0 (not re-read on the agency's page; verify before any launch) — **attribution required**. Undocumented map endpoint: may change without notice |

- **Loading:** a source is only downloaded when the viewport touches its coverage area (first load of a region ≈ 5–20 s), then cached on disk in `.cache/cctv/` for 6–12 h. The client asks `GET /api/cctv/cameras?w&s&e&n` for the current view only and refuses views wider than ~60° (HTTP 413).
- **Frames:** `GET /api/cctv/frame/:id`. The browser never supplies a URL: frames are fetched only from URLs the server registered, hosts/paths are allow-listed per source, redirects are re-validated, responses are capped at 3 MB and must start with real JPEG/PNG/GIF/WebP bytes, results are cached 5–30 s, and concurrent viewers share one upstream request (max 6 simultaneous per host).
- **Where there are no cameras yet (2026-10-06):** South America, Africa, and most of Asia, Europe and Australia. Checked and left out: Singapore's `api.data.gov.sg` traffic images (the image address changes with every update, so a cached list would show stale pictures), Queensland's QLDTraffic (needs a key; HTTP 403 without one), Windy Webcams (needs a user's own free key), South Africa's i-TRAFFIC (needs a developer key), Spain's DGT, Slovenia, Taiwan and Norway (the addresses tried did not answer). A keyed webcam directory is the realistic route to the empty continents.
- **Not included:** Live NSW cameras serve an HTML "not found" placeholder to non-browser clients, and spoofing a browser identity to get past that was deliberately not done. Ontario's official `/api/v2/get/cameras` now returns HTTP 400, but Ontario is reachable through the shared 511 endpoint above. Texas (TxDOT), Estonia, Delaware and other states that need a key, an access code, or special frame handling are not wired up yet; sites that answered with a different page format (Virginia, Indiana, New York, Colorado, Ohio, Minnesota and others) are not covered.
- **Privacy:** frames can contain people, vehicles and license plates. The layer only displays them; it does no recognition or tracking.
- The previous EarthCam layer only mapped location pins with outbound links (no imagery) from EarthCam's undocumented internal endpoints. It is still available with `VITE_EARTHCAM_ADAPTER=network|osm|static`.

## AISStream (vessels)

- **Role:** live AIS over a WebSocket held by the Node API (`server/aisStreamSession.ts`); the browser only talks to `/api/ais/stream`.
- **Behavior:** the upstream socket is opened only when a browser is connected *and* a subscription exists, and the subscription is sent the instant it opens (AISStream closes sockets that don't subscribe within a few seconds). It reconnects with exponential backoff, treats a rejected key as terminal for 5 min, idles out 60 s after the last browser leaves, and handles views that cross the antimeridian. Positionless vessels (static data only) and AIS "not available" values are never plotted. Updates are sent as deltas rather than the full list. `GET /api/ais/status` and the status line explain an empty layer.
- **Coverage:** a provider limitation, not a bug — AISStream relies on land-based receivers, so it sees ships within roughly 50 nautical miles of a coast and **nothing in the open ocean** (tested: open Gulf of Mexico and mid-Atlantic returned 0 vessels).
- **Keyless Baltic feed:** `server/lib/regionalAis.ts` also polls **Digitraffic Marine** (Fintraffic, Finland; `meri.digitraffic.fi/api/ais/v1/…`, CC BY 4.0, no key) once a minute while your view overlaps the Baltic (lat 53.5–66.8, lon 9–33.8). It carries ships out in open water there (~700 live vessels, with names, destinations and ETAs) and works even without an AISStream key. A fresher AISStream fix for the same ship always wins. Honest limit: **there is no free global open-ocean AIS feed**; that is satellite AIS (Spire, MarineTraffic, etc.), which is commercial. Norway's open Kystverket stream did not respond from this network, so it is not used.
- **Destination, distance and ETA:** the ship card shows the crew-reported ETA, and — when the typed destination is a place name — resolves it with Nominatim (OpenStreetMap; 1 request/s, cached, only when you select a ship), draws a dashed direct line to it and estimates the ETA from current speed. Five-letter UN/LOCODE destinations (e.g. `DETRV`) and notes like `FOR ORDERS` can't be resolved without a bundled LOCODE table, so they are shown as text only.

## Aircraft photos and routes

- **Route (origin/destination):** `GET /api/flight/:callsign` looks the callsign up in **adsbdb** (`api.adsbdb.com/v0/callsign/…`, keyless) and returns both airports with coordinates. Cached in memory only (6 h, 30 min for "unknown") and never written to disk, because adsbdb asks that its route data not be copied into other databases. Callsigns are reused across legs, so the card checks that the aircraft is actually heading toward the listed destination and otherwise shows "Route check" instead of an invented progress/ETA. OpenSky/Aviationstack are only consulted if this lookup comes back incomplete.
- **Progress / ETA:** straight-line (great-circle) distance to the destination at the current ground speed — an estimate that ignores real routing, wind and delays. The map draws the full route plus a dashed "still to fly" leg.
- **Photos:** `GET /api/aircraft-photo?hex=…` first asks **Planespotters' public photo API** (keyless) for a photo of that exact airframe and credits the photographer with a link; if there is none it falls back to a generic Wikimedia Commons photo of the type. (The old Commons-only lookup returned nothing for common airliners, and sent a blank User-Agent when `WIKIMEDIA_USER_AGENT` was unset; both fixed.)

## Satellite orbit details

The satellite card derives period, altitude, perigee/apogee, inclination and orbit class from the TLE itself (no extra service), and the map track shows the next full orbit (capped at 24 h) plus the last half orbit.

## Cesium Ion / N2YO / KeepTrack

- **Cesium World Imagery/Terrain:** `VITE_CESIUM_ION_TOKEN` (browser).
- **N2YO:** optional satellite detail. The key is pasted in the Keys menu and stays in this browser; it is not an env key, so it is never part of the app bundle.
- **KeepTrack:** optional fuller satellite catalog. `KEEPTRACK_API_KEY` (Keys menu or `.env.local`) is held by the server only; the browser's KeepTrack source asks the server (`/api/keeptrack`), which adds the key.

---

**Production checklist:** Run the plane API (`server/index.ts` or a process manager) behind HTTPS, set `VITE_PLANE_API_BASE` if the API is on another origin, and terminate TLS at your edge. Never expose `OPENSKY_*`, `ADSBX_API_KEY`, or `AVIATIONSTACK_ACCESS_KEY` as `VITE_*` variables.

## Map markers, live camera window and 3D layers

- **Aircraft markers**: one canvas-drawn silhouette per aircraft (jet / prop / helicopter / fighter), drawn once per shape+colour and shared. Colour = traffic class: blue airline, purple private/business, green general aviation/other, red military. Classification is a heuristic on callsign, ICAO type and emitter category (`src/planeTrafficClass.ts`).
- **Aircraft card**: summary first (route, progress/ETA, altitude/speed/heading); origin/destination codes zoom the globe to the airport; "Cameras near ..." searches `/api/cctv/cameras` within 25 km and opens the result in the in-page live window. Technical fields sit under "More details".
- **Live camera window** (`src/liveViewer.ts`): plays HLS (via `hls.js`, loaded on demand) or MP4 where the agency publishes video, otherwise a self-refreshing still. Falls back to the still after 15 s if a stream never starts.
- **3D PHOTO**: Google Photorealistic 3D Tiles through Cesium ion (needs `VITE_CESIUM_ION_TOKEN`; default asset 2275207, override with `VITE_PHOTOREALISTIC_3D_ASSET_ID`). Loads lazily on first use. There is no keyless source for 3D city geometry. The Fly mode icon in the top bar appears only while 3D PHOTO is on.
## Notable aircraft (glow highlight)

- `GET /api/notable-aircraft` returns a registry of well-known privately owned aircraft (ICAO24 hex, owner label, tail, type). The client adds a gold/rose glow with twinkling sparkles around any matching aircraft and a "Notable" chip on its card. The **Notable** filter button turns the highlight (and the always-show behaviour) on or off.
- Sources, later ones win: the community plane-alert-db list (category "Don't you know who I am?" by default; downloaded weekly into `.cache`, not committed; set `NOTABLE_CATEGORIES` to `Cat A|Cat B` to widen it or `NOTABLE_IMPORT=off` to disable), then your own entries in `data/notable-aircraft.json`.
- Only public registry facts are stored; positions are never saved. An aircraft is highlighted only when it appears in the normal live feed for the area you are viewing.
## Georgia (511GA): stills only

- Georgia's cameras come from the shared 511 endpoint above (about 4,300 cameras, still images that refresh), fetched with Orbit's own user agent and no extra headers. There is no Georgia live video: 511GA's stream needs a token request that claims 511ga.org as the origin (a Referer/Origin header), which Orbit does not do (we never pretend to be another site), so the HLS proxy was removed on 2026-10-04.
- 511GA also has an official developer API (`https://511ga.org/developers/doc`): it needs a registered account and a key, allows 10 calls per 60 seconds, and its camera records point at the same `/map/Cctv/{id}` images. We don't use it because the keyless route gives the same pictures. 511GA publishes no terms-of-use page we could find (only a privacy policy that forbids using the GDOT / 511 Georgia logos without written permission, which Orbit doesn't use); the cameras don't record, per its FAQ. Checked 2026-10-04.
## ALPR map (OpenStreetMap, regional)

- `GET /api/alpr?w&s&e&n` returns ALPR points (`surveillance:type=ALPR`) for a bounding box. The server fetches them from Overpass one **1° tile** at a time (fair-use spacing, fallback mirrors), keeps each tile on disk in `.cache/alpr` for a week and shares it between viewers, so a view up to about 10° wide loads instead of only the few blocks the old per-view query allowed. Tiles not yet cached load in the background and the map fills in as they arrive.
- The globe clusters nearby cameras into numbered bubbles (click one to zoom into it). Coverage wedges and bearing rays only draw when 2,500 or fewer cameras are on screen. Direction tags like `N` or `SW` are converted to degrees.
- Data © OpenStreetMap contributors, ODbL. Coverage is whatever the community has mapped (dense in some US metros, thin elsewhere).
## Weather, events, infrastructure and utilities ("Weather, events & more" panel)

All of these are keyless unless noted. The server endpoints live in `server/routes/layers.ts` (`/api/layers/...`); each layer's client code is in `src/layers/`.

| Layer | Source | Notes |
|---|---|---|
| Wind | Open-Meteo forecast API (model data) | One request for a 7° x 10° global grid, cached 30 min. The browser interpolates between grid points and animates 4,200 particles. A model forecast, not measured wind. |
| Rain radar | RainViewer public radar mosaic | Past 2 hours, playable timeline. Direct from the browser. |
| Clouds | NASA GIBS (GOES-East, GOES-West, Himawari clean-IR) and EUMETSAT's EUMETView WMS (Meteosat SEVIRI IR 10.8 µm, `view.eumetsat.int/geoserver/wms`, layers `msg_fes:ir108` and `msg_iodc:ir108`; keyless, the service states no fees or access constraints; credit "© EUMETSAT") | Dark ground is made transparent. Each satellite draws only its own band of longitudes (the joins are at -140, -105, -35, 40 and 100 degrees) so the discs do not overlap or smear at their edges. Covers everything except the poles. GIBS has no Europe/Africa satellite, which is why Meteosat is added. Meteosat is greyscale where GOES and Himawari are colour-banded, so the joins show. |
| Lightning | NOAA nowCOAST WMS `ldn_lightning_strike_density` | Americas and Pacific only. |
| Cyclones | NOAA NHC `CurrentStorms.json` + the NHC tropical MapServer | Current position, forecast track, cone and past track for Atlantic and eastern/central Pacific storms. Western Pacific, Indian Ocean and southern-hemisphere storms are not covered, and the layer says so. Checked 2026-10-06 and not built: JTWC's site answers Orbit's honest user agent with HTTP 403 (it is left out rather than spoofing a browser), and GDACS (`gdacs.org/gdacsapi`, keyless, JTWC-sourced for those basins) gives an event centroid plus an undocumented set of line and polygon pieces, with no current storm to test against. |
| Earthquakes | USGS `all_day` GeoJSON feed | Size = magnitude, colour = depth. The card adds recent headlines (GDELT DOC API, keyless, rate-limited, via the server) and links to the USGS event page. |
| Active fires | NASA EONET open wildfire events (card: recent headlines from GDELT, and the official page the feed names, often InciWeb); US burned areas are outlined from the NIFC / WFIGS current interagency perimeters (public ArcGIS feature service, wildfires of 100 acres and up mapped in the last 30 days, simplified, cached 30 min), nothing outside the US, only those with a report in the last 30 days (EONET leaves incidents 'open' for months; older ones are dropped, 7-30 day old ones drawn faded) | Set `FIRMS_MAP_KEY` (free NASA FIRMS key) in `.env.local` to switch to satellite hot-spots (last 24 h) for the box on screen. |
| Cables | TeleGeography Submarine Cable Map (CC BY-SA 4.0) | 700+ cables and ~1,900 landing points, cached 14 days. Attribute TeleGeography if you publish. |
| Dams | Wikidata (CC0) via the Wikidata Query Service | Dams that have an English Wikipedia article (~5,000). Cached 30 days. |
| Radio | Radio Browser community directory | The 6,000 most-listened stations that publish coordinates; plays in the browser. |
| Launches | The Space Devs, Launch Library 2 | Last 30 days + upcoming; cached 1 h because the free tier allows 15 requests/hour. The ascent replay is a **reconstructed estimate** (typical ascent profile along a guessed azimuth), not telemetry. |
| Directions | OSRM on FOSSGIS servers (OpenStreetMap data) | Drive / walk / cycle; fair-use public servers, results cached 10 min. |
| Click-to-track | adsb.lol public trace history (aircraft) | Camera lock with a fading trail for aircraft, ships and satellites; "24 h path" draws the day's recorded positions (since 00:00 UTC) coloured by altitude. |
## Data centers (merged, de-duplicated) — `GET /api/datacenters`

- Three public maps feed one layer: **OpenStreetMap** (`telecom` / `building` / `industrial` / `man_made` = `data_center` or `data_centre`, via the shared 1° Overpass tile cache), **PeeringDB** (~5,000 colocation facilities with operator, address and website) and **Wikidata** (data-center items with coordinates, CC0).
- **No double references:** candidates are ranked by how much they tell us, then each is merged into an already-kept site when it is within ~250 m, within ~3 km with the same normalised name, or shares a Wikidata / PeeringDB / OSM id. A merged site keeps every source, id and link, and the OSM buildings of one campus are counted ("5 buildings") instead of listed separately. In a test over Northern Virginia, 356 OSM + 81 PeeringDB entries became 189 sites with no two closer than 250 m.
- Views up to about 10° wide load; the map clusters nearby sites into numbered bubbles. `server/lib/osmTiles.ts` is the shared tile cache (the ALPR layer uses it too).

## Time machine (Utilities → History)

- **Earth by day:** NASA GIBS daily true-colour mosaics (MODIS Terra for 24 Feb 2000 – Feb 2012, VIIRS SNPP afterwards), 250 m, with a date slider, date box, play/pause and 1-day to 1-quarter steps.
- **Battles & conflicts:** `GET /api/layers/battles` — ~9,500 battles with a place and date from Wikidata (CC0), antiquity to today, filtered by era or custom years and playable as a moving window through time. Older battles often have only a year recorded.
- **Events:** a curated list jumps to the right place, date and era (Ukraine 2022, Iraq 2003, Mosul 2016, Kabul 2021, Tōhoku 2011, Tonga 2022, Katrina, Black Summer, D-Day, Stalingrad, Gettysburg, Waterloo, Hastings, ...), with a short factual note, a Wikipedia link and, for modern events, a day-by-day replay.
- Not available: satellite imagery before 2000, and recorded replays of Orbit's own live aircraft/ship feeds.

## Directions search

The top bar gets From / To boxes (with Drive / Walk / Cycle) while the Directions layer is on. `GET /api/layers/places?q=&lat=&lon=` uses the shared address and place lookup described under "Address and place lookup" below (type-ahead sources only, nearest to the view first); coordinates like `38.89, -77.05` work too.
## Avoid-ALPR routing (simulation)

Directions has an **Avoid ALPR** toggle in the top bar. OSRM cannot avoid points, so `server/lib/route.ts` simulates it: it asks for alternative routes, tries via-point corridors to either side of the straight line and detours around the first camera still on the route, counting mapped ALPR cameras within ~40 m of each candidate and keeping the one that passes the fewest (within ~60% extra travel time). Results say honestly how many readers were avoided, what it cost, and when a trip can't avoid them. Only cameras mapped in OpenStreetMap are known, and a few seconds to ~30 s are spent the first time a region's camera tiles load.
## Top-bar search (places, aircraft, satellites, ALPR)

One box searches everything on the map. **Places and addresses**: the shared lookup under "Address and place lookup" below. **Aircraft**: callsign, ICAO hex, registration, airline name (via the airline-prefix table) or type among aircraft on the map, plus `GET /api/layers/aircraft-search` for exact worldwide lookups (adsb.lol, falling back to adsb.fi). **Satellites**: name, NORAD number, operator, country or purpose from the loaded catalog; names are also mapped to operators (`starlink` -> SpaceX, `flock` -> Planet Labs, ...) in `src/globalSearch.ts`. **ALPR cameras**: manufacturer or operator among the cameras loaded on the map. Choosing a result turns on its layer if needed, flies there and opens its card.
## Conflict watch (Events → Conflict watch) — `server/lib/conflicts.ts`
- Events: Uppsala Conflict Data Program (UCDP) GED 25.1 (`ucdp.uu.se/downloads/ged/ged251-csv.zip`) plus the monthly Candidate GED CSVs (`/downloads/candidateged/`). CC BY 4.0 — cite Davies, Pettersson & Öberg (GED/candidate) and Sundberg & Melander (2013). The UCDP API needs a token, so the public downloads are used; data lags about a month.
- Death counts are estimates. Events with coarse location (precision ≥5) or long spans (>10 days, e.g. monthly loss totals) are left off the map but counted in the panel.
- Live headlines: GDELT DOC API (keyless, rate-limited; cached 10 min, falls back to the last list). "Reported events" shows UCDP's own source headlines.
- Follows the Time machine date when "Follow the Time machine date" is on.

## Address and place lookup — `server/lib/geocoder.ts`
One server lookup serves the top-bar search, "Set my location" and the Directions boxes (`GET /api/layers/geocode?q&lat&lon[&submit=1]`, `GET /api/layers/places?q&lat&lon`).
- **US street addresses** (the text starts with a house number): US Census Bureau Geocoder, `geocoding.geo.census.gov/geocoder/locations/onelineaddress` (benchmark `Public_AR_Current`) and `.../geographies/coordinates` (state of the view, so "100 Main St" means the one near you). Free, no key; US, Puerto Rico and the Island Areas only. The documentation states no rate limit or terms, so the server stays well under any reasonable one: at most one request per 0.7 s, results cached 30 days, the state lookup 90 days. Public-domain US government data.
- **Places, and a supplement for addresses**: Photon (komoot, OpenStreetMap data, ODbL: "© OpenStreetMap contributors"), `photon.komoot.io/api`, with the view as a location bias. Built for type-ahead. Its policy: reasonable use, no guarantees, heavy use is throttled or banned. At most one request per 0.5 s, cached 7 days.
- **Nominatim** (OSM): only for an explicit Enter / Find and only when the other two return fewer than three results, and one `lookup` per click to fill the place panel. Its policy forbids search-as-you-type, allows 1 request/s, requires an identifying User-Agent and caching; all three are done (1.1 s spacing, 7-day cache, the User-Agent below).
- Every request carries Orbit's own honest User-Agent (`Orbit/1.0 (+https://github.com/runna5k/Orbit; personal project)`); none is spoofed. The page waits 550 ms after the last keystroke, identical in-flight requests share one call, and a queue longer than four is refused instead of piling up.
- Ranking: with a house number, exact-number addresses first, then other addresses, then places, each nearest to the view or "my location" first; otherwise Photon's order with anything within 100 km moved ahead.

## Store / business search and "My location"
- Stores: Photon (komoot, OpenStreetMap data) with a location bias, Nominatim as a bounded fallback — `server/lib/poi.ts`, `GET /api/layers/poi?q&lat&lon`. Only what OpenStreetMap contains.
- My location: the browser Geolocation API, only on a click and after the browser's own permission prompt; the position stays in the page (it is only sent as a search bias, rounded to 4 decimals).

## Launch livestreams (Utilities → Launches → "Watch")
- Source: Launch Library 2 (`ll.thespacedevs.com/2.2.0/launch/...?mode=detailed`, keyless, ~15 requests/hour per IP). Its `vidURLs` field is a community-maintained list of webcast links for each launch across platforms (YouTube, X, NASA+, others), tagged official/unofficial. The server fetches it with the launch schedule (2 requests, cached an hour, stale copy served on errors) so nothing needs a key or per-platform scraping when the project moves elsewhere.
- Streams are sorted official first, then by Launch Library's own priority. YouTube links play inside the page (privacy-friendly `youtube-nocookie.com` embed, loaded only when you press Watch); X, NASA+ and the rest open in a new tab.
- Launches with no listed stream show a "Find a stream (YouTube)" search link instead. Links usually appear a few days before liftoff, and some only go live minutes before.


## Power plants and the power grid (Infrastructure)
- **Power plants**: WRI Global Power Plant Database (CC BY 4.0), downloaded from the project's GitHub (global_power_plant_database.csv, ~35,000 plants), thinned to 100 MW and up (about 7,800) and cached for 30 days in .cache/power/ (server/lib/power.ts, `GET /api/layers/power/plants`). Coloured by primary fuel, sized by capacity.
- **Transmission lines and substations (200 kV and up)**: OpenStreetMap power=line / power=substation via Overpass, one-degree tiles through the shared tile cache (same mechanism as ALPR and data centers), cached 14 days (`GET /api/layers/power/grid?w&s&e&n`). Loads when the view is about 6 degrees across or less; new areas fill in over a few seconds. Coverage is community-mapped and varies by country. ODbL, (c) OpenStreetMap contributors.

## Abandoned places (Infrastructure) — `GET /api/layers/abandoned?w&s&e&n[&limit][&min]`

- Candidate places from OpenStreetMap tags, each with a **rule-based likelihood** worked out on the server from the tags alone (no model, no key, no site visit): **very likely** = `abandoned=yes`, `abandoned:*`, `building=ruins`, `historic=ruins`, `ruins=*`; **likely** = `disused=yes`, `disused:*` or `was:*` on a real place (a school, a hospital, a supermarket, a factory ...); **maybe** = the same on small shop units, offices and everyday amenities (they fall vacant all the time), `landuse=brownfield`, a past `end_date` or `opening_hours=closed` on a place, or a name that says former, closed, defunct, abandoned, derelict or disused; two different "maybe" hints together make "likely". **Unlikely** (only a name starting with "Old" or "Ex-") exists in the scoring but is never fetched for its own sake. `min` (0-3, default 2) picks the lowest level returned; the app shows "likely and up" by default, with a "Show" setting for "very likely only" and "maybe and up".
- The lifecycle prefixes `abandoned:`, `disused:` and `was:` are read for amenity, building, shop, man_made, industrial, tourism, leisure, office, craft and healthcare, and for railway stations, halts and depots only (never lines).
- Fetched from Overpass one 1° tile at a time through the shared tile cache (honest User-Agent, fair-use spacing, mirrors; two queries per tile, "core" and "lifecycle", sent one at a time), cached 14 days, points only (`out center`), at most 8,000 elements per query and tile, 2,500 places per view. A view must be about 3° across or less (HTTP 413 otherwise); a tile seen for the first time can take Overpass a minute or two. Searches by `name` pattern, `end_date` and brownfield land were measured at two minutes or more per tile (or HTTP 504) on a dense tile, so they are not asked of Overpass: those rules only score objects fetched for another reason.
- Left out on purpose: street furniture (benches, bins, phone boxes), pitches, playgrounds and gardens, information boards, runways and taxiways, railway platforms and signal boxes, and disused railway lines and roads (linear). **Mine shafts and adits are included** (`man_made=mineshaft` / `adit` with an abandoned or disused tag), under the same likelihood rules; they get a round pin with a dark centre and one plain hazard line on the card: "Mine shaft or adit: an open hole that can be deep and unstable". In mining regions they can be a large share of the results (about 30 % of the places in one Harz sample box).
- The card gives the level, what it is in plain words ("Disused school", "Abandoned place of worship"), the exact tags behind the level, and links to the OpenStreetMap object and, as a plain outbound link, to TrespassersHQ's explore map at the same position (`https://trespassershq.com/explore/?lat=…&lng=…&z=17`). **Nothing is fetched from trespassershq.com and none of its data is used.** No access or entry details are shown or stored. Labels in the app: "Likelihood from OpenStreetMap tags, not a site visit. Places can be demolished, reopened or guarded; not a guide to entering them." and "From OpenStreetMap: places mappers tagged abandoned, disused or ruined. As complete as local mapping, not a guide to entering them."
- Data © OpenStreetMap contributors, ODbL.
## Imagery sources and load speed
- **Aerial**: Cesium ion World Imagery (Bing aerial with labels), needs `VITE_CESIUM_ION_TOKEN`.
- **Esri**: Esri World Imagery (Maxar / Earthstar Geographics) plus the World Boundaries and Places label layer, from `services.arcgisonline.com`. Keyless; free for display with attribution (shown in the Imagery picker). A separate CDN from Cesium, so it can be the faster choice on some networks.
- **Streets**: OpenStreetMap tiles. Fallback order if a source fails: aerial, then Esri, then streets.
- Start-up: imagery and terrain are requested in parallel and the app no longer waits for them; the browser opens connections to the ion, Google 3D-tile and Esri hosts early (`preconnect`); and the 3D Photo tileset index is fetched in the background a few seconds after start-up (hidden) so switching it on later is quicker. On a phone, tiles are fetched over more parallel connections.

## Keys menu (settings)
- Top-bar key icon -> **Keys & tokens**. Browser-side tokens (Cesium ion, N2YO) live in this browser's localStorage (`orbit-key-cesium` / `orbit-key-n2yo`); the Cesium one takes precedence over `VITE_CESIUM_ION_TOKEN` in `.env.local`, and the N2YO key has no env setting (so it never ships in the bundle). A reload applies them.
- Server keys (`AISSTREAM_API_KEY`, `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`, `ADSBX_API_KEY`, `KEEPTRACK_API_KEY`, `FIRMS_MAP_KEY`) are saved by `POST /api/settings/keys` into `.env.local` and applied by restarting the server (automatic under `npm run dev`). The endpoint only accepts requests from the computer running the server (the dev proxy forwards the caller's address in `X-Forwarded-For`), refuses cross-site origins and requests without the `X-Orbit-Settings` header, accepts only the listed names with a strict character set, and never returns a stored value (only whether it is set and its last four characters). If you put the server behind another reverse proxy, make sure it sets `X-Forwarded-For`.

## Bundled data, libraries and links (credits)

Everything the app uses that is not a live feed above. The in-app **Credits** link (bottom-right of the map) lists these and the live imagery credits.

| Item | Where | Licence / credit |
| --- | --- | --- |
| OurAirports (`davidmegginson/ourairports-data`) | `public/airports-icao.json`, rebuilt with `npm run build-airports` | Public domain |
| OpenFlights `airlines.dat` | `public/airline-flight-prefixes.json`, rebuilt with `npm run build-airline-prefixes` | Open Database License (ODbL) — attribution: OpenFlights.org |
| Overpass API (public mirrors `overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee`) | ALPR, data centers and power-grid tiles | OpenStreetMap data, ODbL, © OpenStreetMap contributors; fair use, cached for days |
| Open-Meteo | Wind layer | CC BY 4.0 — attribution: "Weather data by Open-Meteo.com"; free for non-commercial use |
| Planespotters photo API, adsbdb, Wikimedia Commons | Aircraft photos and routes | Photographer credited on the card; adsbdb route data is not stored on disk; Commons per-file licences |
| Outbound links: Open Infrastructure Map, FlightRadar24; YouTube (nocookie embeds for launch streams) | Outbound links only; nothing is fetched from them until the user clicks | Their own terms |
| Google Fonts (IBM Plex Sans / Mono, Inter) | Loaded from `fonts.googleapis.com` by `index.html` | SIL Open Font License; self-host to avoid the third-party request |
| Cesium ion World Imagery (Microsoft Bing Maps), World Terrain and Google Photorealistic 3D Tiles | "Aerial" imagery, terrain, 3D Photo; need the user's own free Cesium ion token | Credits: © Cesium, Microsoft Bing Maps and the data providers Cesium reports, © Google for 3D Tiles. Shown in the in-app Credits sheet, which reads the credits Cesium itself reports |
| Esri World Imagery and Boundaries/Places | "Esri" imagery option | "Imagery © Esri, Maxar, Earthstar Geographics and the GIS user community" |
| CesiumJS, hls.js, satellite.js, Express, ws, cors, dotenv | npm dependencies | Apache-2.0 (CesiumJS, hls.js), MIT (satellite.js, Express, ws, cors), BSD-2-Clause (dotenv); licence texts ship in `node_modules` and must be kept in any packaged build |
| Orbit logo, icons | `public/orbit-logo.webp`, `public/icons/` | The project's own |

Tools used on the developer's PC and not shipped: OBS Studio, ffmpeg, mkcert, Playwright's Chromium.
