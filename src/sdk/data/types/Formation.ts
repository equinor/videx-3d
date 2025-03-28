export type Formation = {
  name: string
  mdMslEntry: number,
  mdMslExit: number,
  tvdMslEntry?: number,
  tvdMslExit?: number,
  level: number,
  color: string,
  properties?: Record<string, any>
}