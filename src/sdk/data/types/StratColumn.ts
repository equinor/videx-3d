export type StratColumnUnit = {
  id: string,
  name: string,
  level: number,
  top: string,
  base: string,
  topAge: number,
  baseAge: number,
  color: string,
  parent: string,
}


export type StratColumn = {
  id: string,
  name: string,
  type: string,
  units: StratColumnUnit[]
}