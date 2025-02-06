import {
  CasingItem,
  CompletionTool,
  PerforationInterval,
  Pick,
  PositionLog,
  StratColumn,
  SurfaceMeta,
  WellboreHeader,
} from '../../sdk'
import { get } from './api'

export async function loadWellboreHeaders(): Promise<
  Record<string, WellboreHeader>
> {
  const data = await get('/data/wellbore-headers.json')
  Object.keys(data).forEach((key) => {
    const drilled = data[key].drilled ? new Date(data[key].drilled) : null
    data[key].drilled = drilled
  })
  return data
}

export async function loadPositionLogs(): Promise<Record<string, PositionLog>> {
  const positionLogsData = await get('/data/position-logs.json')

  return Object.keys(positionLogsData).reduce<Record<string, PositionLog>>(
    (dict, key) => {
      const log = positionLogsData[key]

      if (log) {
        dict[key] = new Float32Array(log)
      }
      return dict
    },
    {}
  )
}

export async function loadCasings(): Promise<Record<string, CasingItem[]>> {
  return get('/data/casings.json')
}

export async function loadCompletion(): Promise<
  Record<string, CompletionTool[]>
> {
  return get('/data/completion.json')
}

export async function loadPerforations(): Promise<
  Record<string, PerforationInterval[]>
> {
  return get('/data/perforations.json')
}

export async function loadSurfaceMeta(): Promise<Record<string, SurfaceMeta>> {
  return get('/data/surface-meta.json')
}

export async function loadStratColumns(): Promise<Record<string, StratColumn>> {
  return get('/data/strat-columns.json')
}

export async function loadPicks(): Promise<Record<string, Pick[]>> {
  return get('/data/picks.json')
}
