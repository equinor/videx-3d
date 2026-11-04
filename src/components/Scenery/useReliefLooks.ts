import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SceneryReliefLooks,
  type ReliefLookProps,
} from './scenery-relief-look';

/**
 * A relief's looks (`SceneryReliefLooks`) for `look` and its layers by id, kept up to date by
 * value — an object written inline is a new one each render — and disposed with the
 * component: what a `GeoRelief` and a `GeoMap` both draw from.
 *
 * @returns the looks; the key they were last written for (their content, by value); and how
 *   many times they have been written, which changes with the texture's content
 */
export function useReliefLooks(
  look: ReliefLookProps,
  layerIds: readonly string[],
) {
  const looks = useMemo(() => new SceneryReliefLooks(), []);
  useEffect(() => () => looks.dispose(), [looks]);
  const key = JSON.stringify([
    look.color,
    look.contours,
    look.layerLooks,
    layerIds,
  ]);
  // The objects themselves, for the update: a colour may be a three `Color`.
  const latest = useRef({ look, layerIds });
  useEffect(() => {
    latest.current = { look, layerIds };
  });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const { look: l, layerIds: ids } = latest.current;
    looks.update(
      { color: l.color, contours: l.contours },
      ids.map(id => l.layerLooks?.[id]),
    );
    setVersion(v => v + 1);
  }, [looks, key]);
  return { looks, key, version };
}
