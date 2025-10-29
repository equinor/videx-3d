import { create } from 'zustand'
import { calculateWellSegments, WellboreHeader } from '../../../sdk'
import { DarkTheme, WellMapStyles } from './themes'



export type WellMapPadding = {
  top: number
  bottom: number
  left: number
  right: number
}

export type WellMapMeasures = {
  svgWidth: number
  svgHeight: number
  tracksWidth: number
  trackWidth: number
  padding: WellMapPadding
  ratio: number
  range: [number, number]
  getSlotPosition: (slot: number) => number
}

export type WellMapState = {
  _allWellbores: WellboreHeader[]
  wellbores: WellboreHeader[]
  wellboreIds: string[]
  wellboresByName: Record<string, WellboreHeader>
  wellboresById: Record<string, WellboreHeader>
  segments: Record<string, [number, number]>
  tracksOrder: string[]
  slotsById: Record<string, number>
  activeDepths: Record<string, number>
  depth?: number
  domain: [number, number]
  measures: WellMapMeasures
  styles: WellMapStyles
  setStyles: (theme: WellMapStyles) => void
  setDepth: (depth: number | undefined) => void
  setMeasure: (width: number, height: number) => void
  setWellbores: (wellboreHeaders: WellboreHeader[]) => void
}

const maxWidth = 50
const depthAxisWidth = 30

export const createWellMapState = () => create<WellMapState>((set, get) => ({
  _allWellbores: [],
  wellbores: [],
  wellboreIds: [],
  wellboresByName: {},
  wellboresById: {},
  segments: {},
  slotsById: {},
  activeDepths: {},
  tracksOrder: [],
  depth: 0,
  domain: [0, 0],
  styles: DarkTheme,
  setStyles: (theme) => set({ styles: theme }),
  measures: {
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    ratio: 0,
    svgWidth: 0,
    svgHeight: 0,
    tracksWidth: 0,
    trackWidth: 0,
    range: [0, 0],
    getSlotPosition: () => 0,
  },
  setDepth: depth => {
    set({ depth })
  },
  setMeasure: (width, height) => {
    const nTracks = get().wellbores.length
    const svgWidth = width
    const svgHeight = height
    const tracksWidth = width - depthAxisWidth
    const trackWidth = nTracks > 0 ? tracksWidth / nTracks : 0
    const ratio = Math.min(1, trackWidth / maxWidth)
    const padding = {
      top: 20 * ratio + 5,
      bottom: 20 * ratio + 20,
      left: 0,
      right: 0,
    }
    const range: [number, number] = [
      0 + padding.top,
      height - (padding.top + padding.bottom),
    ]

    const getSlotPosition = (slot: number) => {
      return slot * trackWidth + trackWidth / 2
    }

    const measures = {
      padding,
      ratio,
      svgWidth,
      svgHeight,
      tracksWidth,
      trackWidth,
      range,
      getSlotPosition,
    }

    set({ measures })
  },
  setWellbores: (wellboreHeaders) => {
    const _allWellbores = wellboreHeaders
    const wellbores = _allWellbores.filter((d) => d.drilled)
    const wellboreIds = wellbores.map((d) => d.id)
    const wellboresById: Record<string, WellboreHeader> = _allWellbores.reduce(
      (acc, w) => ({
        ...acc,
        [w.id]: w,
      }),
      {}
    )

    const wellboresByName: Record<string, WellboreHeader> =
      _allWellbores.reduce(
        (acc, w) => ({
          ...acc,
          [w.name]: w,
        }),
        {}
      )

    const segments = calculateWellSegments(wellboresByName, wellbores)

    //(a, b) => wellboresById[a].name.localeCompare(wellboresById[b].name)
    //(a, b) => (wellboresById[a].drilled?.getTime() || 0) - (wellboresById[b].drilled?.getTime() || 0)
    const tracksOrder = Object.keys(segments)
      .map((id) => ({ sq: segments[id][1], id }))
      .sort((a, b) => b.sq - a.sq)
      .map((d) => d.id)

    const activeDepths: Record<string, number> = {}

    for (let i = 0; i < tracksOrder.length; i++) {
      const id = tracksOrder[i]
      if (activeDepths[id] !== undefined) continue
      const wellbore = wellboresById[id]
      if (wellbore) {
        if (wellbore.status === 'operating' || wellbore.status === 'drilling') {
          activeDepths[id] = wellbore.depthMdMsl
        
          let current = wellbore
          while(current && current.kickoffDepthMsl !== null && current.parent) {
            const parent = wellboresByName[current.parent]
            if (!parent) break   
            if (activeDepths[parent.id]) {
              activeDepths[parent.id] = Math.max(activeDepths[parent.id], current.kickoffDepthMsl)
            } else {
              activeDepths[parent.id] = current.kickoffDepthMsl
            }
            current = parent
          }
        } 
      }
    }

    const slotsById: Record<string, number> = tracksOrder.reduce(
      (acc, id, i) => ({ ...acc, [id]: i }),
      {}
    )

    const domain: [number, number] = wellboreIds.reduce(
      (bounds, id) => {
        const wellbore = wellboresById[id]
        if (wellbore) {
          let fromMsl = -wellbore.depthReferenceElevation
          if (wellbore.kickoffDepthMsl && wellbore.parent) {
            fromMsl = wellbore.kickoffDepthMsl
          }
          if (fromMsl < bounds[0]) {
            bounds[0] = fromMsl
          }
          if (wellbore.depthMdMsl > bounds[1]) {
            bounds[1] = wellbore.depthMdMsl
          }
        }
        return bounds
      },
      [Infinity, -Infinity]
    )
    const newState: Partial<WellMapState> = {
      _allWellbores,
      wellbores,
      wellboreIds,
      wellboresById,
      wellboresByName,
      segments,
      tracksOrder,
      slotsById,
      activeDepths,
      domain,
    }

    set(newState)
  },
}))
