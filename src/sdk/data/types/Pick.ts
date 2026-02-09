export type Pick = {
  id: string;
  wellboreId: string;
  pickIdentifier: string;
  mdMsl: number;
  tvdMsl?: number;
  properties?: Record<string, any>;
};
