import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  DistanceDisplayCondition,
  Entity,
  HeightReference,
  LabelStyle,
  PolygonHierarchy,
  PolylineDashMaterialProperty,
  VerticalOrigin,
  type Viewer
} from "cesium";
import { circleCartesians, wedgeCartesians } from "./alpr/alprWedge";
import { horizonDepthTest } from "./horizon";
import type { ViewBasis, ViewPlan } from "./viewRangePlan";

export type ViewTone = "alpr" | "cctv";

/** `labelDy`: pixels from the coordinate down to the label's top, so it clears the marker (the ALPR pole hangs above the
 *  point; the round camera badge is centred on it and reaches about 20 px below). */
const TONES: Record<ViewTone, { hue: Color; text: Color; labelDy: number }> = {
  alpr: { hue: Color.fromCssColorString("#ffd54a"), text: Color.fromCssColorString("#ffe8a8"), labelDy: 10 },
  cctv: { hue: Color.fromCssColorString("#6ed8ff"), text: Color.fromCssColorString("#bfeaff"), labelDy: 26 }
};

/**
 * Cone fill is three nested slices (full range, 62 %, 30 %), so the colour is densest at the lens and fades toward
 * the far arc, like a lens diagram. A "likely" cone (direction only inferred) is lighter and has dashed edges.
 */
const SLICES = [1, 0.62, 0.3];
const SLICE_ALPHA: Record<ViewBasis, number> = { data: 0.2, estimated: 0.17, likely: 0.09 };
const CIRCLE_ALPHA = 0.14;

/**
 * The selected camera's estimated view range: one cone (a pie slice with two straight edges and an arc) or a faint
 * circle, drawn flat on the ground, plus one short label. Shared by the ALPR and traffic-camera layers; only one shape
 * exists at a time, so it costs nothing at any zoom. Ground shapes are depth-tested, so the globe hides them on the far
 * side; the label uses `horizonDepthTest` like the layers' dots. Everything is clamped to the ground (terrain and 3D
 * tiles), the same as the icons, so the cone's apex sits exactly under the pole foot.
 */
export class ViewRangeOverlay {
  private readonly ds = new CustomDataSource("view_range");

  constructor(private readonly viewer: Viewer) {
    void viewer.dataSources.add(this.ds);
  }

  show(lat: number, lon: number, plan: ViewPlan, tone: ViewTone): void {
    this.ds.entities.removeAll();
    const { hue, text, labelDy } = TONES[tone];
    if (plan.kind === "cone") {
      const alpha = SLICE_ALPHA[plan.basis];
      for (const f of SLICES) {
        this.add({
          polygon: {
            hierarchy: new PolygonHierarchy(wedgeCartesians(lat, lon, plan.bearingDeg, plan.widthDeg, plan.depthM * f, 0)),
            material: hue.withAlpha(alpha),
            outline: false
          }
        });
      }
      // The straight edges and the arc as one line; dashed when the direction itself is only inferred.
      this.add({
        polyline: {
          positions: wedgeCartesians(lat, lon, plan.bearingDeg, plan.widthDeg, plan.depthM, 0),
          width: 2,
          clampToGround: true,
          material:
            plan.basis === "likely"
              ? new PolylineDashMaterialProperty({ color: hue.withAlpha(0.8), dashLength: 14 })
              : hue.withAlpha(0.85)
        }
      });
    } else {
      this.add({
        position: Cartesian3.fromDegrees(lon, lat),
        ellipse: { semiMajorAxis: plan.radiusM, semiMinorAxis: plan.radiusM, material: hue.withAlpha(CIRCLE_ALPHA), outline: false }
      });
      this.add({
        polyline: {
          positions: circleCartesians(lat, lon, plan.radiusM, 0),
          width: 1.5,
          clampToGround: true,
          material: new PolylineDashMaterialProperty({ color: hue.withAlpha(0.55), dashLength: 10 })
        }
      });
    }
    this.add({
      position: Cartesian3.fromDegrees(lon, lat, 0),
      label: {
        text: plan.label,
        font: '600 12px -apple-system, "SF Pro Text", Inter, "Helvetica Neue", Arial, sans-serif',
        fillColor: text,
        outlineColor: Color.BLACK.withAlpha(0.85),
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.TOP,
        pixelOffset: new Cartesian2(0, labelDy),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        // Labels this wide only make sense when the shape itself can be seen.
        distanceDisplayCondition: new DistanceDisplayCondition(0, 25_000),
        disableDepthTestDistance: horizonDepthTest(this.viewer.camera)
      }
    });
    this.viewer.scene.requestRender();
  }

  clear(): void {
    if (!this.ds.entities.values.length) return;
    this.ds.entities.removeAll();
    this.viewer.scene.requestRender();
  }

  setVisible(on: boolean): void {
    this.ds.show = on;
    this.viewer.scene.requestRender();
  }

  private add(options: Entity.ConstructorOptions): void {
    const e = this.ds.entities.add(options);
    (e as { allowPicking?: boolean }).allowPicking = false;
  }
}
