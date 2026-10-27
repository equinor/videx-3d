import { useFrame } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { Vector3 } from 'three';
import type { GraticuleUniforms } from '../../sdk/materials/graticule';
import { LabelLayer } from '../Labels/LabelLayer';
import type { Label, LabelsProvider, LabelStyle } from '../Labels/types';
import {
  GRATICULE_LABEL_EVERY,
  GRATICULE_LABEL_REACH,
  GRATICULE_LABEL_SIZE,
  graticuleLabels,
  graticuleLabelSize,
} from './scenery-graticule-labels';
import type { SceneryMaterial } from './scenery-material';
import type { SceneryGraticuleLabels } from './scenery-model';

/**
 * Latitude and longitude's labels' look, by default: small and light, a thin soft halo,
 * so they read without covering the scene; and, lying flat on the sea, drawn down to a
 * grazing view.
 */
export const GRATICULE_LABEL_STYLE: Partial<LabelStyle> = {
  fontWeight: 500,
  haloWidth: 0.07,
  haloColor: 'rgba(0, 0, 0, 0.55)',
  minFacing: 0.08,
};

const NO_LABELS: Label[] = [];
const dir = new Vector3();
const centre = new Vector3();
const there = { latitude: 0, longitude: 0 };

/**
 * Latitude and longitude's labels over a `Scenery` (see {@link SceneryGraticuleLabels}):
 * a `LabelLayer` around where the view is centred, at the lines' step. Internal: the
 * `Scenery` mounts it for `<SceneryGraticule latLon={{ labels }} />`.
 */
export const SceneryGraticuleLabelLayer = ({
  material,
  options,
}: {
  material: SceneryMaterial;
  options: SceneryGraticuleLabels;
}) => {
  const {
    size: fraction = GRATICULE_LABEL_SIZE,
    reach = GRATICULE_LABEL_REACH,
    every = GRATICULE_LABEL_EVERY,
    lift,
    ...style
  } = options;

  // The lines' step, as the Scenery sets it from the view each frame: it changes seldom.
  const [step, setStep] = useState(0);
  useFrame(() => {
    const now = material.globe.location
      ? (material.uniforms as unknown as GraticuleUniforms).uGraticuleLatLon
          .value.x
      : 0;
    if (now !== step) setStep(now);
  });

  // The same labels while the nearest lines to the view's centre stay the same, so the
  // layer writes nothing again as the view moves.
  const provider = useMemo<LabelsProvider>(() => {
    let key = '';
    let labels = NO_LABELS;
    return ({ camera }) => {
      const globe = material.globe;
      if (!step || !globe.location) return NO_LABELS;
      // Where the view is centred on the sea, or, past the horizon, under the camera.
      camera.getWorldDirection(dir);
      const reached = globe.reach(camera.position, dir, 0);
      if (reached.hit)
        centre.copy(camera.position).addScaledVector(dir, reached.distance);
      else globe.foot(camera.position, centre);
      globe.geographic(centre, there);
      const now = `${Math.round(there.latitude / step)}|${Math.round(there.longitude / step)}`;
      if (now !== key) {
        key = now;
        labels = graticuleLabels(globe, step, there, reach, every);
      }
      return labels;
    };
  }, [material, step, reach, every]);

  const location = material.globe.location;
  if (!step || !location) return null;
  // At the field's latitude: across the few degrees a view spans, near enough.
  const size = graticuleLabelSize(step, location.latitude, fraction);
  return (
    <LabelLayer
      provider={provider}
      size={size}
      // Over the waves near the field, which would cut through text at the sea's level.
      lift={lift ?? Math.max(5, 0.05 * size)}
      {...GRATICULE_LABEL_STYLE}
      {...style}
    />
  );
};
