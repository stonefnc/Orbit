declare module "satellite.js" {
  /** The subset of the SGP4 record this app reads (radians; `a` in Earth radii; `no` in radians per minute). */
  export type SatRec = {
    a: number;
    ecco: number;
    inclo: number;
    no: number;
  };
  export type EciVector = { x: number; y: number; z: number };
  export type GeodeticCoordinates = {
    longitude: number;
    latitude: number;
    height: number;
  };

  export function twoline2satrec(line1: string, line2: string): SatRec;
  export function propagate(
    satrec: SatRec,
    date: Date
  ): { position?: EciVector; velocity?: EciVector };
  export function gstime(date: Date): number;
  export function eciToGeodetic(position: EciVector, gmst: number): GeodeticCoordinates;
  export function degreesLong(radians: number): number;
  export function degreesLat(radians: number): number;
}
