export type SurfaceMeta = {
  id: string
  name: string
  description?: string
  projection: string
  min: number
  max: number
  displayMin: number
  displayMax: number
  color: string
  visualization: string
  header: {
    ny: number
    xori: number
    xmax: number
    yori: number
    ymax: number
    xinc: number
    yinc: number
    nx: number
    rot: number
  }
}