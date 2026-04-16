export type WellboreHeader = {
  id: string;
  name: string;
  well: string;
  depthReferenceElevation: number;
  kickoffDepthMsl: number | null;
  parent: string | null;
  drilled: Date | null;
  easting: number;
  northing: number;
  depthMdMsl: number;
  waterDepth: number | null;
  status: string;
  properties?: Record<string, any>;
};
