import { useEffect, useMemo, useState } from 'react'
import { SurfaceMeta } from '../../sdk/data/types/SurfaceMeta'
import { loadSurfaceMeta } from '../dependencies/loaders'

export const useSurfaceMetaDict = () => {
  const [surfaceMetaData, setSurfaceMetaData] = useState<Record<string, SurfaceMeta>>({})

  useEffect(() => {
    loadSurfaceMeta().then(response => {
      if (response) {
        setSurfaceMetaData(response)
      }
    })
  }, [])

  return surfaceMetaData
}

export const useSurfaceMeta = () => {
  const dict = useSurfaceMetaDict()
  const surfaceMetaData = useMemo(() => Object.values(dict), [dict])

  return surfaceMetaData
}