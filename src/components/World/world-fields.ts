import { createContext, useContext } from 'react';
import type { Object3D } from 'three';
import type { Boundary } from '../../sdk/geometries/boundary';

/**
 * A field loaded in a {@link World}: the group its data is drawn in, placed on the Earth (a
 * `UtmArea`'s), and its area, `boundary`, in that group's own X/Z. Whatever tells fields
 * apart reads its place from `object.matrixWorld` each time: a switch of the anchor moves it.
 */
export type WorldField = {
  object: Object3D;
  boundary: Boundary;
};

/**
 * The fields loaded in a {@link World}, as each tells it is there: the anchored one and its
 * neighbours alike, in the order they came.
 */
export type WorldFieldsState = {
  fields: readonly WorldField[];
  /** A field tells it is loaded (a `UtmArea` with a `boundary`); returns the release. */
  addField: (field: WorldField) => () => void;
};

export const WorldFieldsContext = createContext<WorldFieldsState | null>(null);

/** The fields loaded in the enclosing {@link World}, or `null` outside one. */
export function useWorldFields() {
  return useContext(WorldFieldsContext);
}
