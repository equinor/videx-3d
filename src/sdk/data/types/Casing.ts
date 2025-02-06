export type CasingItem = {
  mdTopMsl: number,
  mdBottomMsl: number,
  outerDiameter: number,
  innerDiameter: number,
  type: string,
  properties: Record<string, string>,
  
}

export type CasingSection = CasingItem & {
  shoe: CasingItem | null,
}

