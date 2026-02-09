import { useEffect, useMemo, useState } from 'react';
import { WellboreHeader } from '../../sdk/data/types/WellboreHeader';
import { loadWellboreHeaders } from '../dependencies/loaders';

export const useWellboreHeadersDict = () => {
  const [wellbores, setWellbores] = useState<Record<string, WellboreHeader>>(
    {},
  );

  useEffect(() => {
    loadWellboreHeaders().then(response => {
      if (response) {
        setWellbores(response);
      }
    });
  }, []);

  return wellbores;
};

export const useWellboreHeaders = () => {
  const dict = useWellboreHeadersDict();
  const wellbores = useMemo(() => Object.values(dict), [dict]);

  return wellbores;
};
