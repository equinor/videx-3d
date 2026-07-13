import { useTexture } from '@react-three/drei';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Suspense, useCallback, useEffect } from 'react';
import { Color, RepeatWrapping, Vector2 } from 'three';
import { WellboreSelectedEvent } from '../../../events/wellbore-events';
import { Canvas3dDecorator } from '../../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../../storybook/decorators/data-provider-decorator';
import { DepthSelectorDecorator } from '../../../storybook/decorators/depth-selector-decorator';
import { GeneratorsProviderDecorator } from '../../../storybook/decorators/generators-provider-decorator';
import { PerformanceDecorator } from '../../../storybook/decorators/performance-decorator';
import storyArgs from '../../../storybook/story-args.json';
import {
  EventEmitter,
  EventEmitterCallbackEvent,
  RenderableObject,
} from '../../EventEmitter';
import { BasicTrajectory } from '../BasicTrajectory';
import { CompletionTools } from '../CompletionTools';
import { Wellbore, WellboreProps } from '../Wellbore';
import { CasingEffects } from './CasingMaterial';
import { Casings } from './Casings';
import { CasingSectionType, defaultMaterialOptions } from './casings-defs';

type StoryArgs = React.ComponentProps<typeof Casings> &
  WellboreProps & {
    showCompletion: boolean;
    mapUvUnits: 'normalized' | 'world';
    normalMapUvUnits: 'normalized' | 'world';
    applyNormalMap: boolean;
    showUvGrid: boolean;
    mapRepeatU: number;
    mapRepeatV: number;
    normalRepeatU: number;
    normalRepeatV: number;
    normalScale: number;
    detailQuality: number;
    sectionVariation: number;
    silhouette: number;
    silhouettePower: number;
    edgeShading: number;
    edgeShadingWidth: number;
    weathering: number;
    weatheringScale: number;
    granularStrength: number;
    granularFrequency: number;
    granularOctaves: number;
    granularAnisotropy: number;
    brushedStrength: number;
    brushedFrequency: number;
    brushedOctaves: number;
    brushedAngle: number;
    brushedSharpness: number;
    scratchStrength: number;
    scratchFrequency: number;
    scratchAngle: number;
    scratchDensity: number;
    brushedUniformity: number;
    scratchLength: number;
    scratchWander: number;
    scratchWidth: number;
  };

type Story = StoryObj<StoryArgs>;

const wellboreId = storyArgs.defaultWellbore;

const meta = {
  title: 'Components/Wellbores/Casings',
  component: Casings,
  args: {
    id: wellboreId,
    schematic: false,
    sliceAngle: 0,
    sliceOffset: 0,
    autoSlicePosition: false,
    segmentsPerMeter: 0.1,
    radialSegments: 32,
    sizeMultiplier: 1,
    shoeFactor: 1.5,
    showCompletion: false,
    opacity: 1,
    detailQuality: 0.6,
    sectionVariation: 0.35,
    silhouette: 0.35,
    silhouettePower: 3,
    edgeShading: 0.5,
    edgeShadingWidth: 0.2,
    weathering: 0.3,
    weatheringScale: 1.5,
    granularStrength: 0,
    granularFrequency: 2,
    granularOctaves: 3,
    granularAnisotropy: 0,
    brushedStrength: 0,
    brushedFrequency: 2,
    brushedOctaves: 3,
    brushedAngle: 0,
    brushedSharpness: 0.5,
    scratchStrength: 0,
    scratchFrequency: 10,
    scratchAngle: 0,
    scratchDensity: 0.4,
    brushedUniformity: 0,
    scratchLength: 0.6,
    scratchWander: 1,
    scratchWidth: 0.15,
    mapUvUnits: 'normalized',
    normalMapUvUnits: 'normalized',
    applyNormalMap: false,
    showUvGrid: false,
    mapRepeatU: 1,
    mapRepeatV: 1,
    normalRepeatU: 2,
    normalRepeatV: 200,
    normalScale: 1,
  },
  argTypes: {
    schematic: {
      control: { type: 'boolean' },
      table: { category: 'Mode' },
    },
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: { type: 'select', labels: storyArgs.wellboreOptions },
      table: { category: 'Geometry & Slicing' },
    },
    segmentsPerMeter: {
      control: { type: 'range', min: 0.02, max: 1, step: 0.02 },
      table: { category: 'Geometry & Slicing' },
    },
    radialSegments: {
      control: { type: 'range', min: 4, max: 64, step: 1 },
      table: { category: 'Geometry & Slicing' },
    },
    sizeMultiplier: {
      control: { type: 'range', min: 0.5, max: 10, step: 0.5 },
      table: { category: 'Geometry & Slicing' },
    },
    shoeFactor: {
      control: { type: 'range', min: 1, max: 3, step: 0.1 },
      table: { category: 'Geometry & Slicing' },
    },
    sliceAngle: {
      control: { type: 'range', min: 0, max: Math.ceil(Math.PI), step: 0.05 },
      table: { category: 'Geometry & Slicing' },
    },
    sliceOffset: {
      control: {
        type: 'range',
        min: 0,
        max: Math.ceil(Math.PI * 2),
        step: 0.05,
      },
      table: { category: 'Geometry & Slicing' },
    },
    autoSlicePosition: {
      control: { type: 'boolean' },
      table: { category: 'Geometry & Slicing' },
    },
    showCompletion: {
      control: { type: 'boolean' },
      table: { category: 'Scene' },
    },
    opacity: {
      control: { type: 'range', min: 0.1, max: 1, step: 0.1 },
      table: { category: 'Scene' },
    },
    silhouette: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Silhouette Effect' },
    },
    silhouettePower: {
      control: { type: 'range', min: 0.5, max: 8, step: 0.1 },
      table: { category: 'Silhouette Effect' },
    },
    edgeShading: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Edge Shading Effect' },
    },
    edgeShadingWidth: {
      control: { type: 'range', min: 0, max: 3, step: 0.05 },
      table: { category: 'Edge Shading Effect' },
    },
    detailQuality: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Detail Quality' },
    },
    weathering: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Weathering Effect' },
    },
    weatheringScale: {
      control: { type: 'range', min: 0.2, max: 6, step: 0.1 },
      table: { category: 'Weathering Effect' },
    },
    sectionVariation: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Weathering Effect' },
    },
    granularStrength: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Granular Effect' },
    },
    granularFrequency: {
      control: { type: 'range', min: 0.1, max: 400, step: 0.1 },
      table: { category: 'Granular Effect' },
    },
    granularOctaves: {
      control: { type: 'range', min: 1, max: 5, step: 1 },
      table: { category: 'Granular Effect' },
    },
    granularAnisotropy: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Granular Effect' },
    },
    brushedStrength: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Brushed Effect' },
    },
    brushedFrequency: {
      control: { type: 'range', min: 0.1, max: 100, step: 0.1 },
      table: { category: 'Brushed Effect' },
    },
    brushedOctaves: {
      control: { type: 'range', min: 1, max: 5, step: 1 },
      table: { category: 'Brushed Effect' },
    },
    brushedAngle: {
      control: { type: 'range', min: -1.57, max: 1.57, step: 0.02 },
      table: { category: 'Brushed Effect' },
    },
    brushedSharpness: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Brushed Effect' },
    },
    brushedUniformity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Brushed Effect' },
    },
    scratchStrength: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Scratches Effect' },
    },
    scratchFrequency: {
      control: { type: 'range', min: 0.1, max: 100, step: 0.1 },
      table: { category: 'Scratches Effect' },
    },
    scratchAngle: {
      control: { type: 'range', min: -1.57, max: 1.57, step: 0.02 },
      table: { category: 'Scratches Effect' },
    },
    scratchDensity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Scratches Effect' },
    },
    scratchLength: {
      control: { type: 'range', min: 0.1, max: 5, step: 0.1 },
      table: { category: 'Scratches Effect' },
    },
    scratchWander: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Scratches Effect' },
    },
    scratchWidth: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Scratches Effect' },
    },
    mapUvUnits: {
      options: ['normalized', 'world'],
      control: { type: 'inline-radio' },
      table: { category: 'Texture' },
    },
    normalMapUvUnits: {
      options: ['normalized', 'world'],
      control: { type: 'inline-radio' },
      table: { category: 'Texture' },
    },
    applyNormalMap: {
      control: { type: 'boolean' },
      table: { category: 'Texture' },
    },
    showUvGrid: {
      control: { type: 'boolean' },
      table: { category: 'Texture' },
    },
    mapRepeatU: {
      control: { type: 'range', min: 0.1, max: 50, step: 0.1 },
      table: { category: 'Texture' },
    },
    mapRepeatV: {
      control: { type: 'range', min: 0.1, max: 400, step: 0.1 },
      table: { category: 'Texture' },
    },
    normalRepeatU: {
      control: { type: 'range', min: 0.1, max: 20, step: 0.1 },
      table: { category: 'Texture' },
    },
    normalRepeatV: {
      control: { type: 'range', min: 1, max: 6000, step: 1 },
      table: { category: 'Texture' },
    },
    normalScale: {
      control: { type: 'range', min: 0, max: 3, step: 0.05 },
      table: { category: 'Texture' },
    },
  },
  decorators: [
    PerformanceDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DepthSelectorDecorator,
    DataProviderDecorator,
  ],
  parameters: {
    autoClear: true,
    scale: 1000,
    cameraPosition: [0, 10, 10],
    // Hide the props Storybook auto-infers from the component's TS types (PointerEvents,
    // CommonComponentProps, etc.) that we don't expose as interactive controls - otherwise
    // they show up as noisy generic "Set object" rows.
    controls: {
      exclude:
        /^(on[A-Z]|name|visible|userData|position|castShadow|receiveShadow|renderOrder|layers|fallback|materialOptions|overrideSegmentsPerMeter|overrideSimplificationThreshold|priority|effects)/,
    },
  },
} satisfies Meta<StoryArgs>;

export default meta;

// Maps the flat Storybook controls into the grouped CasingEffects object the component
// now takes. Storybook keeps flat sliders; this is the flat -> nested adapter.
const buildEffects = (args: StoryArgs): CasingEffects => ({
  silhouette: { strength: args.silhouette, power: args.silhouettePower },
  edgeShading: { strength: args.edgeShading, width: args.edgeShadingWidth },
  weathering: { strength: args.weathering, scale: args.weatheringScale },
  sectionVariation: args.sectionVariation,
  detailQuality: args.detailQuality,
  granular: {
    strength: args.granularStrength,
    frequency: args.granularFrequency,
    octaves: args.granularOctaves,
    anisotropy: args.granularAnisotropy,
  },
  brushed: {
    strength: args.brushedStrength,
    frequency: args.brushedFrequency,
    octaves: args.brushedOctaves,
    angle: args.brushedAngle,
    sharpness: args.brushedSharpness,
    uniformity: args.brushedUniformity,
  },
  scratches: {
    strength: args.scratchStrength,
    frequency: args.scratchFrequency,
    angle: args.scratchAngle,
    density: args.scratchDensity,
    length: args.scratchLength,
    wander: args.scratchWander,
    width: args.scratchWidth,
  },
});

// Loads the demo texture and renders the casings. useTexture SUSPENDS, so it lives in
// this dedicated child (its only hook) behind the <Suspense> boundary in the story -
// that way a suspend/resume can never change another component's hook count
// ("Rendered more hooks than during the previous render"). materialOptions is a plain
// function (not a hook) for the same reason.
const DemoCasings = ({ args }: { args: StoryArgs }) => {
  const normalMap = useTexture('normal_map.jpg');
  normalMap.wrapS = normalMap.wrapT = RepeatWrapping;
  normalMap.repeat.set(args.normalRepeatU, args.normalRepeatV);
  normalMap.needsUpdate = true;

  // UV test grid: applied as the base color map (matte, metalness 0) so the UV mapping is
  // clearly visible on the otherwise-metallic casing. mapUvUnits toggles normalized/world.
  const uvGrid = useTexture('uv_grid.jpg');
  uvGrid.wrapS = uvGrid.wrapT = RepeatWrapping;
  uvGrid.repeat.set(args.mapRepeatU, args.mapRepeatV);
  uvGrid.needsUpdate = true;

  const materialOptions = (section: CasingSectionType) => {
    const base = defaultMaterialOptions(section);
    const extra = {
      mapUvUnits: args.mapUvUnits,
      normalMapUvUnits: args.normalMapUvUnits,
      ...(args.showUvGrid ? { map: uvGrid, metalness: 0 } : {}),
      ...(args.applyNormalMap
        ? {
          normalMap,
          normalScale: new Vector2(args.normalScale, args.normalScale),
        }
        : {}),
    };
    return {
      primary: { ...base.primary, ...extra },
      inner: { ...base.inner, ...extra },
      slice: { ...base.slice, ...extra },
    };
  };

  return (
    <Casings
      materialOptions={materialOptions}
      sizeMultiplier={args.sizeMultiplier}
      radialSegments={args.radialSegments}
      shoeFactor={args.shoeFactor}
      sliceAngle={args.sliceAngle}
      sliceOffset={args.sliceOffset}
      autoSlicePosition={args.autoSlicePosition}
      opacity={args.opacity}
      effects={buildEffects(args)}
      schematic={args.schematic}
    />
  );
};

export const Default: Story = {
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({ id: args.id }));
    }, [args.id]);

    return (
      <>
        <Wellbore id={args.id} segmentsPerMeter={args.segmentsPerMeter}>
          <BasicTrajectory />
          {args.showCompletion && (
            <CompletionTools sizeMultiplier={args.sizeMultiplier} />
          )}
          <Suspense fallback={null}>
            <DemoCasings args={args} />
          </Suspense>
        </Wellbore>
      </>
    );
  },
};

export const WithPointerEvents: Story = {
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({ id: args.id }));
    }, [args.id]);

    const onEnter = useCallback((event: EventEmitterCallbackEvent) => {
      event.target.children.forEach(obj => {
        const robj = obj as RenderableObject;
        if (robj.material) {
          const materials = Array.isArray(robj.material)
            ? robj.material
            : [robj.material];
          materials.forEach(material => {
            material.emissive = new Color(0xff0000);
          });
        }
      });
    }, []);

    const onLeave = useCallback((event: EventEmitterCallbackEvent) => {
      event.target.children.forEach(obj => {
        const robj = obj as RenderableObject;
        if (robj.material) {
          const materials = Array.isArray(robj.material)
            ? robj.material
            : [robj.material];
          materials.forEach(material => {
            material.emissive = new Color(0x000000);
          });
        }
      });
    }, []);

    return (
      <>
        <EventEmitter>
          <Wellbore id={args.id} segmentsPerMeter={args.segmentsPerMeter}>
            <BasicTrajectory />
            {args.showCompletion && (
              <CompletionTools sizeMultiplier={args.sizeMultiplier} />
            )}
            <Casings
              onPointerEnter={onEnter}
              onPointerLeave={onLeave}
              sizeMultiplier={args.sizeMultiplier}
              radialSegments={args.radialSegments}
              shoeFactor={args.shoeFactor}
              sliceAngle={args.sliceAngle}
              sliceOffset={args.sliceOffset}
              autoSlicePosition={args.autoSlicePosition}
              opacity={args.opacity}
              effects={buildEffects(args)}
            />
          </Wellbore>
        </EventEmitter>
      </>
    );
  },
};
