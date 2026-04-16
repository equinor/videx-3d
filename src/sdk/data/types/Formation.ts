export type FormationBoundary = {
  mdMsl: number;
  tvdMsl?: number;
  properties?: Record<string, any>;
};

export type Formation = {
  wellboreId: string;
  stratColumnId: string;
  entry: FormationBoundary;
  exit: FormationBoundary;
  name: string;
  type?: string;
  level: number;
  color: string;
  properties?: Record<string, any>;
};

export type MergedFormationInterval = {
  mdMslFrom: number;
  mdMslTo: number;
  name: string;
  level: number;
  color: string;
  properties?: Record<string, any>;
};

export type FormationMarker = {
  name: string;
  color: string;
  mdMsl: number;
  tvdMsl?: number;
  type: 'top' | 'base';
  level: number;
};
