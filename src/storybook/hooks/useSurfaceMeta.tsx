import { useEffect, useMemo, useState } from 'react';
import { SurfaceMeta } from '../../sdk/data/types/SurfaceMeta';
import { get } from '../dependencies/api';

export const useSurfaceMetaDict = () => {
  const [surfaceMetaData, setSurfaceMetaData] = useState<
    Record<string, SurfaceMeta>
  >({});

  useEffect(() => {
    get('/data/surface-meta.json').then(response => {
      if (response) {
        setSurfaceMetaData(response);
      }
    });
  }, []);

  return surfaceMetaData;
};

export const useSurfaceMeta = () => {
  const dict = useSurfaceMetaDict();
  const surfaceMetaData = useMemo(() => Object.values(dict), [dict]);

  return surfaceMetaData;
};

/**
 * Drop surfaces whose name has already been seen, keeping the first occurrence.
 *
 * The demo dataset contains surfaces that share a name (e.g. two different
 * `CROMER KNOLL GP. Top` grids), which makes a stacked chunk ambiguous — the same
 * horizon would appear twice at different depths. The data store keeps them all;
 * this is only for the stories, which build a stack out of whatever is available.
 *
 * Note the caller decides the order, and the FIRST match wins — so sort before
 * filtering if you care which of the duplicates survives.
 */
export const distinctByName = (metas: SurfaceMeta[]): SurfaceMeta[] => {
  const seen = new Set<string>();
  return metas.filter(m => {
    if (seen.has(m.name)) return false;
    seen.add(m.name);
    return true;
  });
};
