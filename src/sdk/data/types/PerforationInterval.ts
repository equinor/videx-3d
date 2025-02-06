export type PerforationInterval = {
  type: string,
  status: 'Open' | 'Closed',
  density?: number,
  phase?: number,
  comment: string,
  mdTopMsl: number,
  mdBottomMsl: number,
}