import { Vec2 } from '../../types/common';

/**
 * The store data type a fence's seismic is requested from:
 * `store.get<FieldColumnSeismicSection>(FIELD_COLUMN_SEISMIC_SECTION, wellboreId, query)`,
 * with a {@link FieldColumnSeismicSectionQuery} as the args.
 */
export const FIELD_COLUMN_SEISMIC_SECTION = 'field-column-seismic-section';

/** The args of a {@link FIELD_COLUMN_SEISMIC_SECTION} request. */
export type FieldColumnSeismicSectionQuery = {
  /** UTM positions to sample, interleaved `[easting0, northing0, easting1, northing1, ...]` */
  path: number[];
  /** `[top, bottom]` TVD MSL to sample between, positive down */
  depthRange: Vec2;
};

/** Seismic values along a {@link FieldColumnSeismicSectionQuery.path}. */
export type FieldColumnSeismicSection = {
  /** row-major, rows from `depthRange[0]` down to `depthRange[1]`, one column per path position */
  values: Float32Array;
  /** `[columns, rows]` */
  samples: Vec2;
  /** `[top, bottom]` TVD MSL the rows span, which may differ from the one requested */
  depthRange: Vec2;
  /** `[min, max]` of the values */
  valueRange: Vec2;
};
