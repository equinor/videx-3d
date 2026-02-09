import {
  CasingItem,
  CompletionTool,
  Formation,
  PerforationInterval,
  Pick,
  PositionLog,
  StratColumn,
  SurfaceMeta,
  WellboreHeader,
} from '../../sdk';
import { get } from './api';

export async function loadWellboreHeaders(): Promise<
  Record<string, WellboreHeader>
> {
  const data = await get('/data/wellbore-headers.json');
  const output: Record<string, WellboreHeader> = {};
  Object.keys(data).forEach(key => {
    const record = data[key];
    const drilled = record.drilled ? new Date(record.drilled) : null;

    output[key] = {
      ...record,
      drilled,
    };
  });
  return output;
}

export async function loadPositionLogs(): Promise<Record<string, PositionLog>> {
  const positionLogsData = await get('/data/position-logs.json');

  return Object.keys(positionLogsData).reduce<Record<string, PositionLog>>(
    (dict, key) => {
      const log = positionLogsData[key];

      if (log) {
        dict[key] = new Float32Array(log);
      }
      return dict;
    },
    {},
  );
}

export async function loadCasings(): Promise<Record<string, CasingItem[]>> {
  return get('/data/casings.json');
}

export async function loadCompletion(): Promise<
  Record<string, CompletionTool[]>
> {
  return get('/data/completion.json');
}

export async function loadPerforations(): Promise<
  Record<string, PerforationInterval[]>
> {
  return get('/data/perforations.json');
}

export async function loadSurfaceMeta(): Promise<Record<string, SurfaceMeta>> {
  return get('/data/surface-meta.json');
}

export async function loadFormations(): Promise<Record<string, Formation[]>> {
  return get('/data/formations.json');
}

export async function loadStratColumns(): Promise<Record<string, StratColumn>> {
  return get('/data/strat-columns.json');
}

export async function loadPicks(): Promise<Record<string, Pick[]>> {
  return get('/data/picks.json');
}
