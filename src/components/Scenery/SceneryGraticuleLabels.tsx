import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { Vector3 } from 'three';
import type { GraticuleUniforms } from '../../sdk/materials/graticule';
import { LabelLayer } from '../Labels/LabelLayer';
import type { Label, LabelsProvider, LabelStyle } from '../Labels/types';
import {
  GRATICULE_LABEL_DENSITY,
  GRATICULE_LABEL_REACH,
  GRATICULE_LABEL_SIZE,
  GRATICULE_LABEL_SMOOTH_MAX,
  graticuleLabelCentre,
  graticuleLabels,
  graticuleLabelSize,
  graticuleLabelSpacing,
  graticuleLabelStep,
} from './scenery-graticule-labels';
import type { SceneryMaterial } from './scenery-material';
import type { SceneryGraticuleLabels } from './scenery-model';

/**
 * Latitude and longitude's labels' look, by default: small and light, a thin soft halo,
 * so they read without covering the scene; and never faded for being seen at a slant,
 * only when too small on screen (`minPixels`); never drawn larger than `maxPixels`, either:
 * one near the camera while the lines' step is judged far away is shrunk to it. Turned to
 * read left to right from wherever they are seen (`flip`).
 */
export const GRATICULE_LABEL_STYLE: Partial<LabelStyle> = {
  fontWeight: 500,
  haloWidth: 0.07,
  haloColor: 'rgba(0, 0, 0, 0.55)',
  minFacing: 0,
  maxPixels: 48,
  flip: true,
};

// Centred on their places, whatever the options: the cells' middles.
const CENTRED: Partial<LabelStyle> = {
  align: 'center',
  baseline: 'middle',
  offset: [0, 0],
};

const NO_LABELS: Label[] = [];
const dir = new Vector3();
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
    density = GRATICULE_LABEL_DENSITY,
    sizing = 'stepped',
    lift,
    ...style
  } = options;

  // The step the lines are seen at, from what the Scenery sets each frame: it changes
  // seldom, and only then renders. Drawn `'smooth'`, the labels' size follows the lines'
  // spacing between their steps each frame, on the GPU alone (`scaleRef`).
  const [step, setStep] = useState(0);
  const scale = useRef(1);
  useFrame(() => {
    if (!material.globe.location) {
      if (step) setStep(0);
      return;
    }
    const lines = (material.uniforms as unknown as GraticuleUniforms)
      .uGraticuleLatLon.value;
    const now = graticuleLabelStep(lines.x, lines.y, lines.z, step);
    if (now !== step) setStep(now);
    scale.current =
      sizing === 'smooth' && now > 0
        ? Math.min(
            graticuleLabelSpacing(lines.x, lines.y, lines.z) / now,
            GRATICULE_LABEL_SMOOTH_MAX,
          )
        : 1;
  });

  // The same labels while the nearest lines to the view's centre stay the same, so the
  // layer writes nothing again as the view moves. Thinned toward the poles from the
  // latitude their size is judged at, the field's.
  const provider = useMemo<LabelsProvider>(() => {
    let key = '';
    let labels = NO_LABELS;
    return ({ camera }) => {
      const globe = material.globe;
      const location = globe.location;
      if (!step || !location) return NO_LABELS;
      camera.getWorldDirection(dir);
      graticuleLabelCentre(globe, camera.position, dir, there);
      const now = `${Math.round(there.latitude / step)}|${Math.round(there.longitude / step)}|${location.latitude}`;
      if (now !== key) {
        key = now;
        labels = graticuleLabels(globe, step, there, {
          reach,
          density,
          reference: location.latitude,
        });
      }
      return labels;
    };
  }, [material, step, reach, density]);

  const location = material.globe.location;
  if (!step || !location) return null;
  // At the field's latitude: across the few degrees a view spans, near enough.
  const size = graticuleLabelSize(step, location.latitude, fraction);
  return (
    <LabelLayer
      provider={provider}
      size={size}
      scaleRef={scale}
      // Over the waves near the field, which would cut through text at the sea's level.
      lift={lift ?? Math.max(5, 0.05 * size)}
      {...GRATICULE_LABEL_STYLE}
      {...style}
      {...CENTRED}
    />
  );
};
