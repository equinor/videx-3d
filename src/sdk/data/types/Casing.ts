export type CasingItem = {
  mdTopMsl: number;
  mdBottomMsl: number;
  outerDiameter: number;
  innerDiameter: number;
  type: string;
  isShoe?: boolean;
  properties: Record<string, string>;
};
