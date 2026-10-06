# ALPR globe layer — adapter contract & DeFlock alignment

Orbit draws **ALPR / license-plate reader** locations on the **same Cesium 3D globe** as aircraft and satellites (`CustomDataSource`, no iframe, no separate 2D map). The aircraft aggregation pipeline is **not** modified; ALPR is a parallel overlay.

Use only **public**, **rights-cleared**, or **your own** coordinates. **Do not** use Flock Safety proprietary APIs or maps.

## DeFlock ([FoggedLens/deflock](https://github.com/FoggedLens/deflock))

[DeFlock](https://github.com/FoggedLens/deflock) is a **crowdsourced** project for locating and reporting ALPRs, built around **OpenStreetMap** workflows and transparency goals (see their README for reporting via OSM / their app). Their stack includes a **MapLibre** web map and backend services (see repo `api/`, `webapp/`).

**This app does not embed DeFlock’s map or call their private APIs.** To stay compatible:

1. Export or mirror **permissible** location data as **GeoJSON** (or the JSON bundle below) that matches the property mapping in this file.
2. Point `VITE_ALPR_DATA_URL` at that file or HTTPS endpoint.
3. When DeFlock or a partner publishes a **documented, authorized** GeoJSON/vector feed, add a small `AlprDataAdapter` implementation (see “Swapping adapters”) without changing `AlprLayerController`.
4. **Live OSM (default):** with **ALPR ON**, the app queries Overpass for **`surveillance:type=ALPR`** nodes in the **visible map area** once you zoom in (not a fixed city bbox). Set `VITE_ALPR_VIEWPORT=0` to use a static `.ql` query instead. Set `VITE_ALPR_ADAPTER=geojson` for the offline sample only.

## DeFlock Maps / FlockHopper stack ([FoggedLens/deflockhopper_maps](https://github.com/FoggedLens/deflockhopper_maps))

[deflockhopper_maps](https://github.com/FoggedLens/deflockhopper_maps) is the **MapLibre** web map (MIT-licensed fork lineage from FlockHopper) that pairs with workers and tile endpoints. Its [`.env.example`](https://github.com/FoggedLens/deflockhopper_maps/blob/master/.env.example) documents defaults such as `VITE_DATA_API_URL=https://data.dontgetflocked.com` and `VITE_TILES_URL=https://tiles.dontgetflocked.com`.

**Public GeoJSON index:** a `GET` to `https://data.dontgetflocked.com/` returns JSON listing datasets (for example `cameras` → `/cameras.geojson.gz`). Despite the `.gz` suffix, the cameras URL is served as **uncompressed** `application/geo+json` (not gzip on the wire). The file is a large **FeatureCollection** of **Points** with OSM-oriented properties (`osmId`, `osmType`, `brand`, `operator`, `ref`, …). Orbit’s GeoJSON adapter maps `osmId` to site `id`, `operator` to `vendor`, and `ref` to display `name` when `name` / `label` / `road` are absent.

To try it in Orbit (same globe, not their MapLibre UI):

```bash
VITE_ALPR_ADAPTER=geojson
VITE_ALPR_DATA_URL=https://data.dontgetflocked.com/cameras.geojson.gz
```

**Dev without CORS:** with `npm run dev`, you can use the Vite proxy and a same-origin URL (large download, long wait):

```bash
VITE_ALPR_ADAPTER=geojson
VITE_ALPR_DATA_URL=/flockhopper-data/cameras.geojson.gz
```

**Caveats:** the bundle is on the order of **tens of MB** — first load will be slow and memory-heavy. **CORS:** if the browser blocks cross-origin `fetch`, add a **same-origin proxy** (for example a Vite dev proxy route) and point `VITE_ALPR_DATA_URL` at that path instead. Confirm **attribution and redistribution** expectations for that feed before publishing a build that uses it; OSM-derived data remains **[ODbL](https://wiki.openstreetmap.org/wiki/Open_Database_License)**-relevant where applicable.

## Place search (Nominatim)

The **Fly globe to** control in the ALPR card calls the public **[Nominatim Search API](https://nominatim.org/release-docs/develop/api/Search/)** (OpenStreetMap geocoder). Results are shown as a short list when ambiguous; choosing one flies the Cesium camera to the result bounding box (or center) and, when viewport Overpass is active and ALPR is **ON**, triggers an ALPR reload for the new view.

**Usage policy:** follow [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) (the client throttles to about one request per second). In `npm run dev`, requests go through **`/nominatim-proxy`** so a valid **`User-Agent`** is set on the proxied request. For production static hosting, set **`VITE_NOMINATIM_API_BASE`** to a same-origin HTTPS path that proxies Nominatim if direct browser calls fail (CORS or UA).

## Environment

| Variable | Purpose |
|----------|---------|
| `VITE_ALPR_DATA_URL` | Optional. GeoJSON or JSON bundle URL. If **unset** and `VITE_ALPR_ADAPTER` is also unset, the app uses **viewport Overpass** (not this URL). |
| `VITE_ALPR_ADAPTER` | Optional. **`overpass`** / **`osm`** · `geojson` · `json` / `sites`. **Unset + no `VITE_ALPR_DATA_URL`** → **viewport Overpass** (zoom in, ALPR ON). **Unset + `VITE_ALPR_DATA_URL` set** → infer from file extension. |
| `VITE_ALPR_OVERPASS_INTERPRETER` | Overpass `POST` URL. Dev: defaults to `/overpass-proxy/api/interpreter` (Vite). Prod: set `https://overpass-api.de/api/interpreter` or your relay if CORS blocks. |
| `VITE_ALPR_OVERPASS_QUERY` | Optional single-line Overpass QL (optional; used when `VITE_ALPR_VIEWPORT=0`). |
| `VITE_ALPR_OVERPASS_QUERY_URL` | Optional URL to a `.ql` file (used when `VITE_ALPR_VIEWPORT=0`). |
| `VITE_ALPR_VIEWPORT` | Set `0` for a **one-shot** static Overpass query from `VITE_ALPR_OVERPASS_QUERY*` / bundled `.ql` instead of view-based loads. |
| `VITE_NOMINATIM_API_BASE` | Optional. Base URL for Nominatim `search` (no trailing slash). Dev: `/nominatim-proxy`. Prod: your relay or `https://nominatim.openstreetmap.org` if allowed. |

## OpenStreetMap via Overpass (recommended alternative to scraping any map)

You **can** load ALPR points from **OpenStreetMap** using the public **[Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API)**. DeFlock and similar projects encourage tagging with **[`surveillance:type=ALPR`](https://wiki.openstreetmap.org/wiki/Tag:surveillance:type%3DALPR)** on OSM nodes.

**You must comply with the [Open Database License (ODbL)](https://wiki.openstreetmap.org/wiki/Open_Database_License):**

- Attribute **© OpenStreetMap contributors** and link to [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright).
- If you publish a **derivative database** built from OSM, ODbL share-alike rules may apply — read the [legal FAQ](https://wiki.osmfoundation.org/wiki/Licence/Community_Guidelines).

**Orbit default:** if you do **not** set `VITE_ALPR_ADAPTER` or `VITE_ALPR_DATA_URL`, the app uses **server-side Overpass tiles**: turn **ALPR ON**, zoom until the visible area is roughly **≤ ~10°** in latitude and longitude, then the Orbit server (`GET /api/alpr`) loads **`surveillance:type=ALPR`** nodes one 1° tile at a time, caches each tile on disk for a week, and the globe shows them as **billboard icons** (clustered into bubbles when far out). Set `VITE_ALPR_VIEWPORT=0` to use a static query from `VITE_ALPR_OVERPASS_QUERY_URL` / `public/data/alpr-overpass-example.ql` instead. Use `VITE_ALPR_ADAPTER=geojson` and `VITE_ALPR_DATA_URL=/data/alpr-sample.geojson` for the **offline** synthetic fixture only.

Example query pattern:

```text
[out:json][timeout:90];
(
  node["surveillance:type"="ALPR"](south,west,north,east);
);
out body;
```

Replace `(south,west,north,east)` with a **bounded** area you are allowed to query (respect [Overpass usage policy](https://operations.osmfoundation.org/policies/overpass/) — avoid planet-wide dumps from the public instance).

## `AlprDataAdapter`

Implement in TypeScript (`src/alpr/alprTypes.ts`):

- `readonly kind: string`
- `load(): Promise<AlprDataset>`

`AlprDataset`: `sites[]`, required `attribution`, optional `licenseNote`.

## GeoJSON

- Root `type`: `"FeatureCollection"`.
- Optional: `attribution`, `dataset_attribution`, `license`, `license_note`.
- Features: `Point` → `coordinates: [lon, lat]`; or `Polygon` (centroid of outer ring used).

### Properties → `AlprSite`

| Property | Field | Notes |
|----------|-------|-------|
| `site_id`, `siteId`, `id`, `camera_id` | `id` | Stable id. |
| `name`, `label`, `road` | `name` | |
| `source`, `data_source` | `source` | Filterable; default `unspecified`. |
| `vendor`, `operator` | `vendor` | |
| `region`, `state`, `area` | `region` | |
| `confidence`, `conf` | `confidence` | `low` \| `medium` \| `high` \| `unknown`. |
| `bearing_deg`, `bearingDeg`, `heading_deg` | `bearingDeg` | Degrees **clockwise from true north**. |
| `fov_deg`, `fovDeg`, `beam_width_deg` | `fovDeg` | With `range_m` + bearing → **coverage wedge** on the globe. |
| `range_m`, `rangeMeters`, `range_meters` | `rangeMeters` | Meters; wedge if with bearing + FOV in valid ranges. |
| `notes`, `description` | `notes` | |

If **bearing** is set but wedge parameters are incomplete, a short **bearing ray** (glow polyline) is drawn instead.

## JSON bundle

```json
{
  "attribution": "Your org",
  "license": "Optional",
  "sites": [{ "id": "1", "latitude": 37.77, "longitude": -122.42, "source": "OSM export" }]
}
```

Latitude/longitude may use `lat` / `lon` / `lng`.

## Swapping adapters

1. Add `src/alpr/yourAdapter.ts` implementing `AlprDataAdapter`.
2. Branch in `createAlprAdapter.ts` (or use env to select).
3. Return `AlprDataset` — no changes needed to Cesium styling if fields map correctly.

## Globe behavior

- Entity ids: `alpr-site-` + slugged id.
- Only **point** entities pick; wedge and ray have `allowPicking: false`.
- Data source is ordered **under** aircraft so plane picks win when overlapping.
