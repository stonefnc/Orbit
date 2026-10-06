import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  DistanceDisplayCondition,
  Entity,
  HorizontalOrigin,
  JulianDate,
  NearFarScalar,
  VerticalOrigin
} from "cesium";
import type { LayerHost } from "./layerHost";
import { hideLayerCard, showLayerCard } from "./layerCard";
import { horizonDepthTest, horizonDistance } from "../horizon";
import { groundHeightReference } from "../groundAnchor";

/** Infrastructure layers: submarine telecom cables (TeleGeography) and notable dams (Wikidata). */

function idOf(entity: { id?: unknown }): string {
  return typeof entity.id === "string" ? entity.id : "";
}

// ---------- Submarine cables ----------

type CableFeature = {
  properties: { id: string; name: string; color?: string };
  geometry: { type: "LineString" | "MultiLineString"; coordinates: number[][] | number[][][] };
};
type LandingFeature = { properties: { id: string; name: string }; geometry: { coordinates: [number, number] } };
type CableDetail = {
  name: string;
  length?: string | null;
  owners?: string | null;
  suppliers?: string | null;
  rfs?: string | null;
  is_planned?: boolean;
  url?: string | null;
  landing_points?: Array<{ name: string; country?: string }>;
};

function registerCables(host: LayerHost): void {
  const ds = new CustomDataSource("cables");
  ds.show = false;
  void host.viewer.dataSources.add(ds);
  const names = new Map<string, string>();
  let loaded = false;
  let selected: string | null = null;

  const lineEntities = new Map<string, Entity[]>();
  const entityCable = new Map<string, string>();

  function highlight(cableId: string | null): void {
    if (selected) {
      for (const e of lineEntities.get(selected) ?? []) {
        if (e.polyline) (e.polyline as unknown as { width: number }).width = 1.8;
      }
    }
    selected = cableId;
    if (cableId) {
      for (const e of lineEntities.get(cableId) ?? []) {
        if (e.polyline) (e.polyline as unknown as { width: number }).width = 4.5;
      }
    }
    host.viewer.scene.requestRender();
  }

  async function load(): Promise<void> {
    const res = await fetch("/api/layers/cables");
    if (!res.ok) throw new Error("Cable data unavailable");
    const j = (await res.json()) as {
      cables: { features: CableFeature[] };
      landings: { features: LandingFeature[] };
    };
    ds.entities.suspendEvents();
    let lines = 0;
    for (const f of j.cables.features) {
      const color = Color.fromCssColorString(f.properties.color || "#5ac8fa").withAlpha(0.85);
      names.set(f.properties.id, f.properties.name);
      const parts: number[][][] =
        f.geometry.type === "LineString" ? [f.geometry.coordinates as number[][]] : (f.geometry.coordinates as number[][][]);
      const made: Entity[] = [];
      parts.forEach((pts) => {
        if (pts.length < 2) return;
        lines++;
        // A cable can span several features, so each line gets its own number; entityCable maps it back to the cable.
        const entityId = `cable-line-${lines}`;
        entityCable.set(entityId, f.properties.id);
        made.push(
          ds.entities.add({
            id: entityId,
            polyline: {
              positions: Cartesian3.fromDegreesArray(pts.flatMap(([lo, la]) => [lo!, la!])),
              width: 1.8,
              material: color,
              arcType: 0 // ArcType.NONE: the points are already dense
            }
          })
        );
      });
      lineEntities.set(f.properties.id, [...(lineEntities.get(f.properties.id) ?? []), ...made]);
    }
    const landingGround = groundHeightReference(j.landings.features.length);
    for (const l of j.landings.features) {
      const [lon, lat] = l.geometry.coordinates;
      ds.entities.add({
        id: `landing-${l.properties.id}`,
        position: Cartesian3.fromDegrees(lon, lat, 0),
        point: {
          pixelSize: 4,
          color: Color.WHITE,
          outlineColor: Color.fromCssColorString("#0a84ff"),
          outlineWidth: 1.5,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 6e6),
          heightReference: landingGround,
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        },
        label: {
          heightReference: landingGround,
          text: l.properties.name,
          font: '500 11px -apple-system, "SF Pro Text", Inter, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: 2,
          pixelOffset: new Cartesian2(0, -10),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 6e5),
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        }
      });
    }
    ds.entities.resumeEvents();
    loaded = true;
    host.setStatus("cables", `${j.cables.features.length} cables · ${j.landings.features.length} landings`);
  }

  host.register({
    id: "cables",
    label: "Cables",
    group: "Infrastructure",
    hint: "Undersea internet cables and their landing stations (TeleGeography Submarine Cable Map, CC BY-SA 4.0). Click a cable for details.",
    async enable() {
      ds.show = true;
      if (!loaded) await load();
      else host.setStatus("cables", `${names.size} cables`);
    },
    disable() {
      ds.show = false;
      highlight(null);
      hideLayerCard();
    },
    onPick(entity) {
      const id = idOf(entity);
      const cableId: string | null = entityCable.get(id) ?? null;
      if (!cableId) {
        if (id.startsWith("landing-")) {
          const label = (entity as Entity).label?.text?.getValue(JulianDate.now()) as string | undefined;
          showLayerCard({ kicker: "Cable landing station", title: label ?? "Landing point" });
          return true;
        }
        return false;
      }
      highlight(cableId);
      const fallbackName = names.get(cableId) ?? cableId;
      showLayerCard({ kicker: "Submarine cable", title: fallbackName, subtitle: "Loading details…", onClose: () => highlight(null) });
      void (async () => {
        try {
          const r = await fetch(`/api/layers/cables/${encodeURIComponent(cableId!)}`);
          if (!r.ok) return;
          const d = (await r.json()) as CableDetail;
          if (selected !== cableId) return;
          const rows: Array<[string, string]> = [];
          if (d.length) rows.push(["Length", d.length]);
          if (d.rfs) rows.push([d.is_planned ? "Planned ready" : "In service since", d.rfs]);
          if (d.owners) rows.push(["Owners", d.owners]);
          if (d.suppliers) rows.push(["Built by", d.suppliers]);
          if (d.landing_points?.length) {
            rows.push([
              "Lands at",
              d.landing_points
                .slice(0, 8)
                .map((l) => l.name)
                .join(" · ") + (d.landing_points.length > 8 ? ` · +${d.landing_points.length - 8} more` : "")
            ]);
          }
          showLayerCard({
            kicker: d.is_planned ? "Planned submarine cable" : "Submarine cable",
            title: d.name,
            rows,
            links: [
              ...(d.url ? [{ label: "Owner site", href: d.url }] : []),
              { label: "Cable map", href: `https://www.submarinecablemap.com/submarine-cable/${cableId}` }
            ],
            onClose: () => highlight(null)
          });
        } catch {
          /* keep the basic card */
        }
      })();
      return true;
    }
  });
}

// ---------- Dams ----------

type DamRow = [id: string, name: string, lat: number, lon: number, heightM: number, river: string, country: string, year: number, wiki: string];

let damIcon: string | null = null;
function damUri(): string {
  if (damIcon) return damIcon;
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d");
  if (!g) return "";
  g.fillStyle = "#4fb3ff";
  g.fillRect(4, 22, 20, 18);
  g.beginPath();
  g.moveTo(22, 8);
  g.lineTo(30, 8);
  g.lineTo(38, 40);
  g.lineTo(18, 40);
  g.closePath();
  g.fillStyle = "#c7ccd4";
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = "#2a2f38";
  g.stroke();
  g.fillStyle = "#4fb3ff";
  g.beginPath();
  g.moveTo(34, 30);
  g.lineTo(44, 40);
  g.lineTo(36, 40);
  g.closePath();
  g.fill();
  damIcon = c.toDataURL("image/png");
  return damIcon;
}

const damClusterIcons = new Map<string, string>();
function damClusterUri(n: number): string {
  const label = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const hit = damClusterIcons.get(label);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 80;
  const g = c.getContext("2d");
  if (!g) return damUri();
  g.beginPath();
  g.arc(40, 40, 36, 0, Math.PI * 2);
  g.fillStyle = "rgba(79,179,255,0.28)";
  g.fill();
  g.beginPath();
  g.arc(40, 40, 28, 0, Math.PI * 2);
  g.fillStyle = "rgba(79,179,255,0.95)";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "rgba(10,40,70,0.9)";
  g.stroke();
  g.fillStyle = "#06121f";
  g.font = '700 26px -apple-system, "SF Pro Text", Inter, sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, 40, 42);
  const uri = c.toDataURL("image/png");
  damClusterIcons.set(label, uri);
  return uri;
}

function registerDams(host: LayerHost): void {
  const ds = new CustomDataSource("dams");
  ds.show = false;
  void host.viewer.dataSources.add(ds);
  const byId = new Map<string, DamRow>();
  let loaded = false;

  const cl = ds.clustering;
  cl.enabled = true;
  cl.pixelRange = 38;
  cl.minimumClusterSize = 4;
  cl.clusterBillboards = true;
  cl.clusterLabels = false;
  cl.clusterPoints = false;
  cl.clusterEvent.addEventListener((clustered, cluster) => {
    cluster.label.show = false;
    cluster.billboard.show = true;
    cluster.billboard.image = damClusterUri(clustered.length);
    cluster.billboard.width = 40;
    cluster.billboard.height = 40;
    cluster.billboard.verticalOrigin = VerticalOrigin.CENTER;
    cluster.billboard.horizontalOrigin = HorizontalOrigin.CENTER;
    cluster.billboard.disableDepthTestDistance = horizonDistance(host.viewer.camera.positionWC);
    const marker = new Entity({ id: "dam-cluster" });
    (marker as Entity & { cluster?: unknown }).cluster = { clusteredEntities: clustered };
    cluster.billboard.id = marker;
  });

  async function load(): Promise<void> {
    const res = await fetch("/api/layers/dams");
    if (!res.ok) throw new Error("Dam data unavailable");
    const j = (await res.json()) as { dams: DamRow[] };
    ds.entities.suspendEvents();
    const ground = groundHeightReference(j.dams.length);
    for (const d of j.dams) {
      byId.set(`dam-${d[0]}`, d);
      ds.entities.add({
        id: `dam-${d[0]}`,
        position: Cartesian3.fromDegrees(d[3], d[2], 0),
        billboard: {
          image: damUri(),
          width: 22,
          height: 22,
          verticalOrigin: VerticalOrigin.BOTTOM,
          scaleByDistance: new NearFarScalar(1e5, 1.2, 2e7, 0.55),
          heightReference: ground,
          disableDepthTestDistance: horizonDepthTest(host.viewer.camera)
        }
      });
    }
    ds.entities.resumeEvents();
    loaded = true;
    host.setStatus("dams", `${j.dams.length.toLocaleString()} dams · notable ones only`);
  }

  host.register({
    id: "dams",
    label: "Dams",
    group: "Infrastructure",
    hint: "Notable dams worldwide (Wikidata + Wikipedia): height, river, country and year built.",
    async enable() {
      ds.show = true;
      if (!loaded) await load();
      else host.setStatus("dams", `${byId.size.toLocaleString()} dams · notable ones only`);
    },
    disable() {
      ds.show = false;
      hideLayerCard();
    },
    onPick(entity) {
      const id = idOf(entity);
      if (id === "dam-cluster") {
        const clustered = (entity as Entity & { cluster?: { clusteredEntities: Entity[] } }).cluster?.clusteredEntities ?? [];
        const pts: Cartesian3[] = [];
        for (const e of clustered) {
          const p = e.position?.getValue(JulianDate.now());
          if (p) pts.push(p);
        }
        if (pts.length) {
          const bs = BoundingSphere.fromPoints(pts);
          bs.radius = Math.max(bs.radius * 1.6, 4000);
          host.viewer.camera.flyToBoundingSphere(bs, { duration: 1.1 });
        }
        return true;
      }
      const d = byId.get(id);
      if (!d) return false;
      const [, name, lat, lon, h, river, country, year, wiki] = d;
      const rows: Array<[string, string]> = [];
      if (h) rows.push(["Height", `${h.toLocaleString()} m`]);
      if (river) rows.push(["River", river]);
      if (country) rows.push(["Country", country]);
      if (year) rows.push(["Built", String(year)]);
      rows.push(["Location", `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`]);
      showLayerCard({
        kicker: "Dam",
        title: name,
        rows,
        actions: [
          {
            label: "Fly to",
            primary: true,
            run: () =>
              host.viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, 6000), duration: 2 })
          }
        ],
        links: wiki ? [{ label: "Wikipedia", href: `https://en.wikipedia.org/wiki/${wiki}` }] : []
      });
      return true;
    }
  });
}

export function registerInfrastructureLayers(host: LayerHost): void {
  registerCables(host);
  registerDams(host);
}
