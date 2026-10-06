import { describe, expect, it } from "vitest";
import { parseHongKongCameras } from "../../server/cctv/sources/hongkong";
import { parseNewZealandCameras } from "../../server/cctv/sources/newzealand";

const HK = `<?xml version="1.0" encoding="UTF-8"?>
<image-list>
  <image>
    <key>H429F</key><region>Hong Kong Island</region><district>Southern</district>
    <description>Example Road near Fish Market [H429F]</description>
    <latitude>22.24845</latitude><longitude>114.1505</longitude>
    <url>https://tdcctv.data.one.gov.hk/H429F.JPG</url>
  </image>
  <image>
    <key>BAD1</key><region>x</region><district>y</district><description>Wrong host</description>
    <latitude>22.3</latitude><longitude>114.2</longitude><url>https://example.com/BAD1.JPG</url>
  </image>
  <image>
    <key>K1</key><region>x</region><district>y</district><description>Plain http</description>
    <latitude>22.3</latitude><longitude>114.2</longitude><url>http://tdcctv.data.one.gov.hk/K1.JPG</url>
  </image>
  <image>
    <key>../etc</key><region>x</region><district>y</district><description>Bad key</description>
    <latitude>22.3</latitude><longitude>114.2</longitude><url>https://tdcctv.data.one.gov.hk/a.JPG</url>
  </image>
  <image>
    <key>NOPOS</key><region>x</region><district>y</district><description>No position</description>
    <latitude></latitude><longitude></longitude><url>https://tdcctv.data.one.gov.hk/NOPOS.JPG</url>
  </image>
</image-list>`;

describe("Hong Kong camera list", () => {
  const cams = parseHongKongCameras(HK);

  it("keeps only well-formed cameras on the department's own image host", () => {
    expect(cams.map((c) => c.id)).toEqual(["hk:H429F"]);
  });

  it("reads position, names and the refresh rate, and strips the code from the name", () => {
    expect(cams[0]).toMatchObject({
      name: "Example Road near Fish Market",
      lat: 22.24845,
      lon: 114.1505,
      city: "Southern",
      region: "Hong Kong Island",
      frameUrl: "https://tdcctv.data.one.gov.hk/H429F.JPG",
      refreshSec: 120,
      headingKind: "unknown",
      headingDeg: null
    });
  });

  it("returns nothing for an empty or non-XML answer", () => {
    expect(parseHongKongCameras("")).toEqual([]);
    expect(parseHongKongCameras("<html>error</html>")).toEqual([]);
  });
});

const nz = (over: Record<string, unknown> = {}) => ({
  properties: {
    ExternalId: 706,
    Name: "SH1 Example Bypass South",
    Description: "South along the bypass",
    Offline: 0,
    UnderMaintenance: 0,
    ImageUrl: "https://www.trafficnz.info/camera/706.jpg",
    Direction: "Southbound",
    ...over
  },
  geometry: { coordinates: [172.61162, -43.449229] as [number, number] }
});

describe("New Zealand camera list", () => {
  it("maps a camera and treats its direction as the traffic direction, not a lens bearing", () => {
    const [c] = parseNewZealandCameras({ features: [nz()] });
    expect(c).toMatchObject({
      id: "nz:706",
      lat: -43.449229,
      lon: 172.61162,
      frameUrl: "https://www.trafficnz.info/camera/706.jpg",
      headingDeg: 180,
      headingKind: "traffic-direction",
      refreshSec: 60
    });
  });

  it("skips offline and under-maintenance cameras, other hosts, http, and odd ids", () => {
    const cams = parseNewZealandCameras({
      features: [
        nz({ ExternalId: 1, Offline: 1 }),
        nz({ ExternalId: 2, UnderMaintenance: 1 }),
        nz({ ExternalId: 3, ImageUrl: "https://example.com/3.jpg" }),
        nz({ ExternalId: 4, ImageUrl: "http://www.trafficnz.info/camera/4.jpg" }),
        nz({ ExternalId: "../5" }),
        nz({ ExternalId: 6 })
      ]
    });
    expect(cams.map((c) => c.id)).toEqual(["nz:6"]);
  });

  it("marks the direction unknown when it is not a single compass direction", () => {
    const [c] = parseNewZealandCameras({ features: [nz({ Direction: "Both" })] });
    expect(c?.headingDeg).toBeNull();
    expect(c?.headingKind).toBe("unknown");
  });

  it("copes with a missing or empty answer", () => {
    expect(parseNewZealandCameras(null)).toEqual([]);
    expect(parseNewZealandCameras({})).toEqual([]);
  });
});
