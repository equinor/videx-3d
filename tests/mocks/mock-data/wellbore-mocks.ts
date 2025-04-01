import { WellboreHeader } from '../../../src/sdk'

const wellboreHeaderMocks: WellboreHeader[] = [
  {
    id: 'a',
    well: 'NO 80/5 2',
    depthMdMsl: 1000,
    depthReferenceElevation: 0,
    drilled: new Date(1980, 0, 10, 12, 0, 0, 0),
    easting: 1,
    northing: 5,
    kickoffDepthMsl: 100,
    name: 'NO 80/5 2',
    parent: null,
    status: 'plugged and abandoned',
    waterDepth: 100,
  },
  {
    id: 'b',
    well: 'NO 80/5 2',
    depthMdMsl: 3000,
    depthReferenceElevation: 0,
    drilled: new Date(1980, 2, 10, 12, 0, 0, 0),
    easting: 1,
    northing: 5,
    kickoffDepthMsl: 900,
    name: 'NO 80/5 2 T2',
    parent: 'NO 80/5 2',
    status: 'plugged and abandoned',
    waterDepth: 100,
  },
  {
    id: 'c',
    well: 'NO 80/5 2',
    depthMdMsl: 3800,
    depthReferenceElevation: 0,
    drilled: new Date(1980, 4, 10, 12, 0, 0, 0),
    easting: 1,
    northing: 5,
    kickoffDepthMsl: 2800,
    name: 'NO 80/5 2 T3',
    parent: 'NO 80/5 2 T2',
    status: 'operating',
    waterDepth: 100,
  }
]

export default wellboreHeaderMocks.reduce<Record<string, WellboreHeader>>((acc, d) => {
  acc[d.id] = d
  return acc
}, {})