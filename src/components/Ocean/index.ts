export * from './Ocean';
export * from './ocean-bed-material';
export {
  OceanContactContext,
  useOceanContact,
  type OceanContactRegistry,
  type OceanContactSource,
} from './ocean-contact';
export {
  OCEAN_FOAM_LIFE_DEFAULT,
  OCEAN_SPARKLE_DEFAULT,
  OceanMaterial,
  type OceanContact,
  type OceanMaterialParameters,
} from './ocean-material';
export {
  createOceanSampler,
  OceanSamplerContext,
  useBuoyancy,
  useOceanSampler,
  type BuoyancyOptions,
  type BuoyancyPoint,
  type OceanSampler,
} from './ocean-sampler';
export {
  OceanVolumeMaterial,
  type OceanVolumeMaterialParameters,
} from './ocean-volume-material';
export type {
  OceanBathymetry,
  OceanFoamTuning,
  OceanWaveTuning,
} from './ocean-material';
export type {
  OceanBedProps,
  OceanBodyProps,
  OceanWaterProps,
} from './ocean-material-sync';
export type { OceanPlane } from './ocean-sampler';
