import { useFrame } from '@react-three/fiber';
import { ReactNode, useEffect, useMemo, useRef } from 'react';
import { Group, Matrix4, Object3D } from 'three';
import {
  layerVisibilityAt,
  type LayerVisibility,
} from '../../sdk/layers/layer-visibility';
import {
  advanceTrack,
  courseToHeading,
  type Track,
} from '../../sdk/layers/tracks';
import { geoFrameXZ, type GeoFrame } from '../../sdk/projection/geo-frame';
import {
  releaseObjectMatrix,
  setObjectMatrix,
} from '../../sdk/projection/place-frame';
import type { Vec2 } from '../../sdk/types/common';
import type { AnnotationProps } from '../Annotations/types';
import { useAnnotations } from '../Annotations/annotations-state';
import { useSceneryOcean } from '../Scenery/scenery-context';
import { useWorld } from '../World/world-context';
import { layerShownAt, useLayerGlobe } from './layer-globe';
import { placeTrackOnGlobe, type TrackPlacement } from './track-placement';

/**
 * TrackLayer props
 * @expand
 */
export type TrackLayerProps<T extends Track> = LayerVisibility & {
  /**
   * where each thing was last reported. Give a new array with a new fix (a new `time`, or a
   * new position, speed or course) to move it on; the same object keeps its course
   */
  tracks: T[];
  /**
   * what to draw for a track, attached to `ref`: an object the layer moves each frame —
   * its `position.x`, `position.z` and `rotation.y` (0 along +X) — so it sets its own
   * height, pitch and roll (a `Tanker`'s buoyancy, say). Its `position.y` is set once, to
   * `height` over the sea's level, when it is attached. On a globe it is drawn inside a
   * group of the layer's, which stands it upright on the curved sea where the track is;
   * its X/Z stay the scene's there, where the waves are sampled
   */
  children: (track: T, ref: (object: Object3D | null) => void) => ReactNode;
  /** carry each track on along its speed and course between fixes (dead reckoning). Default true */
  extrapolate?: boolean;
  /** seconds to ease into a new fix instead of jumping to it. Default 2 */
  smoothing?: number;
  /** metres over the sea's level, along up. Default 0 */
  height?: number;
  /**
   * a label per track, on an `Annotations` layer — the layer's `id` — that follows it: `text`
   * gives the label, `height` (metres, default 60) how far above the object it is anchored
   */
  annotations?: {
    layer: string;
    text: (track: T) => string;
    height?: number;
  };
  /** where the scene lies on the Earth, without a `World` or `Scenery` to say */
  frame?: GeoFrame;
};

type Moving = {
  /** the fix it is carried on from, and when it was received if it has no time */
  fix: Track;
  received: number;
  /**
   * where it was drawn last (longitude, latitude), and what is left to ease out of a new
   * fix, in degrees: the same on a globe and flat
   */
  drawn: Vec2 | null;
  offset: Vec2;
  turn: number;
  heading: number;
};

type Attached = { object: Object3D; placed: boolean };

// The frame a track's object is drawn in, and its place in it.
const framing = new Matrix4();
const placement: TrackPlacement = { x: 0, z: 0, heading: 0 };

// A difference of longitudes, the short way round: (−180, 180].
const wrapDegrees = (degrees: number) =>
  degrees - 360 * Math.round(degrees / 360);

/**
 * Things that move over the Earth — ships, vessels, vehicles, from a tracking feed (AIS, say)
 * or a simulation — each drawn by `children` and moved by the layer every frame, without a
 * React render: placed at its latitude and longitude, carried on along its speed and course
 * between fixes (`advanceTrack`), turned to its course (the map's convergence counted), and
 * eased into each new fix over `smoothing` seconds.
 *
 * On the `World`'s globe (or a `Scenery`'s) anywhere on the Earth: over the globe's flat
 * disc as drawn flat, and beyond it stood upright on the curved sea where the track is
 * (`placeTrackOnGlobe`), however far — a ship 400 km off floats on the sea there. Without a
 * globe, flat on `frame`. A floating object's waves are sampled where it is in the scene;
 * far from the disc they follow the flat wave field, not the waves drawn there exactly.
 *
 * ⚠️ Not for thousands of tracks: each is an object of its own (instance them yourself for
 * a fleet).
 *
 * See `documents/layers.md`.
 *
 * @example
 * <TrackLayer tracks={ships}>
 *   {(ship, ref) => <Tanker ref={ref} length={ship.length} />}
 * </TrackLayer>
 *
 * @group Components
 */
export const TrackLayer = <T extends Track>({
  tracks,
  children,
  extrapolate = true,
  smoothing = 2,
  height = 0,
  annotations,
  frame,
  visible = true,
  minHeight,
  maxHeight,
  fade,
}: TrackLayerProps<T>) => {
  const placed = useLayerGlobe(frame);
  const ocean = useSceneryOcean();
  const world = useWorld();
  const flatFrame = frame ?? world?.frame ?? null;
  const flatKey = flatFrame ? JSON.stringify(flatFrame) : '';
  // From longitude and latitude to the scene flat, for a globe with no frame to place by.
  const flatXZ = useMemo(
    () => (flatKey ? geoFrameXZ(JSON.parse(flatKey) as GeoFrame) : null),
    [flatKey],
  );
  const level = placed?.level ?? 0;

  const moving = useRef(new Map<string | number, Moving>());
  // The objects drawn for the tracks, by id: set by their refs, at commit.
  const attached = useRef(new Map<string | number, Attached>());
  // The groups the layer draws each track's object in, by id: placed on the globe.
  const frames = useRef(new Map<string | number, Group>());
  // New fixes: a track whose fix changed starts from it, easing out of where it was drawn.
  useEffect(() => {
    const now = performance.now();
    const seen = new Set<string | number>();
    for (const track of tracks) {
      seen.add(track.id);
      const known = moving.current.get(track.id);
      if (!known) {
        moving.current.set(track.id, {
          fix: track,
          received: now,
          drawn: null,
          offset: [0, 0],
          turn: 0,
          heading: 0,
        });
      } else if (
        known.fix.time !== track.time ||
        known.fix.longitude !== track.longitude ||
        known.fix.latitude !== track.latitude ||
        known.fix.speed !== track.speed ||
        known.fix.course !== track.course
      ) {
        known.fix = track;
        known.received = now;
        // Eased from where it is drawn: the offset is found on the next frame.
        known.offset = [NaN, NaN];
      }
    }
    for (const id of [...moving.current.keys()]) {
      if (!seen.has(id)) moving.current.delete(id);
    }
  }, [tracks]);

  const options = useRef<LayerVisibility>({});
  options.current = { visible, minHeight, maxHeight, fade };
  const there = { longitude: 0, latitude: 0 };

  useFrame(({ camera }, delta) => {
    // On the globe where it has a frame to place by, else flat.
    const globe = placed?.globe.frame ? placed.globe : null;
    if (!globe && !flatXZ) return;
    const shown =
      (placed
        ? layerShownAt(
            camera.position,
            placed.globe,
            ocean,
            options.current,
            height,
          )
        : layerVisibilityAt(camera.position.y, options.current)) > 0;
    const ease = smoothing > 0 ? Math.exp(-delta / (smoothing / 3)) : 0;
    const wall = Date.now();
    const now = performance.now();
    for (const [id, state] of moving.current) {
      const slot = attached.current.get(id);
      if (!slot) continue;
      const object = slot.object;
      object.visible = shown;
      if (!shown) continue;
      const { fix } = state;
      const seconds = !extrapolate
        ? 0
        : fix.time !== undefined
          ? (wall - fix.time) / 1000
          : (now - state.received) / 1000;
      advanceTrack(fix, Math.max(seconds, 0), there);
      const fresh = Number.isNaN(state.offset[0]);
      const wasDrawn = state.drawn !== null;
      if (fresh) {
        // A new fix: ease from where it was drawn.
        state.offset = state.drawn
          ? [
              wrapDegrees(state.drawn[0] - there.longitude),
              state.drawn[1] - there.latitude,
            ]
          : [0, 0];
      } else {
        state.offset[0] *= ease;
        state.offset[1] *= ease;
      }
      const longitude = there.longitude + state.offset[0];
      const latitude = there.latitude + state.offset[1];
      state.drawn = [longitude, latitude];
      const course = fix.course ?? 0;
      const frameGroup = frames.current.get(id);
      if (globe) {
        placeTrackOnGlobe(
          globe,
          longitude,
          latitude,
          course,
          framing,
          placement,
        );
        if (frameGroup) setObjectMatrix(frameGroup, framing);
      } else {
        [placement.x, placement.z] = flatXZ!(longitude, latitude);
        placement.heading = courseToHeading(
          flatXZ!,
          longitude,
          latitude,
          course,
        );
        if (frameGroup && !frameGroup.matrixAutoUpdate)
          releaseObjectMatrix(frameGroup);
      }
      const { heading } = placement;
      if (fresh) {
        // And from its heading the short way round.
        const turn = state.heading - heading;
        state.turn = wasDrawn ? Math.atan2(Math.sin(turn), Math.cos(turn)) : 0;
      } else {
        state.turn *= ease;
      }
      state.heading = heading + state.turn;
      object.position.x = placement.x;
      object.position.z = placement.z;
      object.rotation.y = state.heading;
      if (!slot.placed) {
        object.position.y = level + height;
        slot.placed = true;
      }
    }
  });

  // The refs, one per track, kept so an object is not detached and attached each render.
  const refs = useMemo(
    () => new Map<string | number, (object: Object3D | null) => void>(),
    [],
  );
  const frameRefs = useMemo(
    () => new Map<string | number, (group: Group | null) => void>(),
    [],
  );
  const frameFor = (id: string | number) => {
    let ref = frameRefs.get(id);
    if (!ref) {
      ref = (group: Group | null) => {
        if (group) frames.current.set(id, group);
        else frames.current.delete(id);
      };
      frameRefs.set(id, ref);
    }
    return ref;
  };
  const refFor = (id: string | number) => {
    let ref = refs.get(id);
    if (!ref) {
      ref = (object: Object3D | null) => {
        if (object) attached.current.set(id, { object, placed: false });
        else attached.current.delete(id);
      };
      refs.set(id, ref);
    }
    return ref;
  };

  return (
    <>
      {tracks.map(track => (
        <group key={track.id} ref={frameFor(track.id)}>
          {children(track, refFor(track.id))}
        </group>
      ))}
      {annotations && (
        <TrackAnnotations
          tracks={tracks}
          layer={annotations.layer}
          text={annotations.text}
          height={annotations.height ?? 60}
          objects={attached}
        />
      )}
    </>
  );
};

let scopes = 0;

// One annotation per track, anchored to its object's world matrix, which follows it.
const TrackAnnotations = <T extends Track>({
  tracks,
  layer,
  text,
  height,
  objects,
}: {
  tracks: T[];
  layer: string;
  text: (track: T) => string;
  height: number;
  objects: { current: Map<string | number, Attached> };
}) => {
  const scope = useMemo(() => `tracks-${scopes++}`, []);
  const { addAnnotations } = useAnnotations(layer, scope);
  const key = tracks.map(t => `${t.id}:${text(t)}`).join('|');
  useEffect(() => {
    // After the objects are attached: their refs are set in the commit before this effect.
    const list: AnnotationProps[] = [];
    for (const track of tracks) {
      const object = objects.current.get(track.id)?.object;
      if (!object) continue;
      list.push({
        id: String(track.id),
        name: text(track),
        position: [0, height, 0],
        matrixWorld: object.matrixWorld,
      });
    }
    return addAnnotations(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the tracks' ids and texts
  }, [addAnnotations, key, height]);
  return null;
};
