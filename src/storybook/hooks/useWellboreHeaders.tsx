import { useEffect, useMemo, useState } from 'react';
import { WellboreHeader } from '../../sdk/data/types/WellboreHeader';
import {
  EXTRA_WELLBORE_IDS,
  withExtraWellbores,
} from '../data/extra-wellbores';
import { get } from '../dependencies/api';

export const useWellboreHeadersDict = () => {
  const [wellbores, setWellbores] = useState<Record<string, WellboreHeader>>(
    {},
  );

  useEffect(() => {
    get('/data/wellbore-headers.json')
      .then(async host =>
        host && EXTRA_WELLBORE_IDS.length
          ? withExtraWellbores(host, await get('/data/position-logs.json'))
              .headers
          : host,
      )
      .then(response => {
        if (response) {
          Object.values(response).forEach((record: any) => {
            const drilled = record.drilled ? new Date(record.drilled) : null;
            record.drilled = drilled;
          });
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
