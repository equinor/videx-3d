import { useContext, useEffect } from 'react';
import { UtmAreaContext } from '../../components/UtmArea';
import { useData } from '../../hooks/useData';
import { PositionLog } from '../../sdk/data/types/PositionLog';
import { WellboreHeader } from '../../sdk/data/types/WellboreHeader';
import { Vec3 } from '../../sdk';
import { registerVidex3d } from './videx3d';

/**
 * Register `window.videx3d.locate('wellbore', id)` for the story it is used in.
 *
 * ⭐⭐ Registered HERE, inside `UtmArea`, rather than in the canvas decorator: it
 * resolves through the very same `utmToArea` the components do, so the answer is
 * the frame the scene is actually in. A separately derived coordinate is a
 * plausible-looking lie, and the whole point is to stop guessing at positions.
 *
 * ⚠️ Storybook only. Must be called inside both a data provider and a `UtmArea`.
 */
export function useVidex3dLocate() {
  const store = useData();
  const utm = useContext(UtmAreaContext);
  const utmToArea = utm?.utmToArea;

  useEffect(() => {
    if (!store || !utmToArea) return;

    const locate = async (kind: string, id: string) => {
      if (kind !== 'wellbore') return null;
      const header = await store.get<WellboreHeader>('wellbore-headers', id);
      const log = await store.get<PositionLog>('position-logs', id);
      if (!header) return null;
      const at = (index: number): Vec3 =>
        utmToArea(
          header.easting + log![index],
          header.northing + log![index + 2],
          -log![index + 1],
        );
      if (!log || log.length < 8) {
        const head = utmToArea(header.easting, header.northing, 0);
        return { head, td: head };
      }
      let deepest = 0;
      for (let i = 0; i + 3 < log.length; i += 4) {
        if (log[i + 1] > log[deepest + 1]) deepest = i;
      }
      return {
        head: at(0),
        td: at(log.length - 4),
        deepest: at(deepest),
      };
    };

    return registerVidex3d({ locate: locate as never });
  }, [store, utmToArea]);
}
