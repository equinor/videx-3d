// The names main had before `Ocean` became `Water`, kept so code written against them still
// builds. Each is the renamed export itself, so `instanceof`, contexts and subclasses keep
// working. To be removed in a later major release; the migration guide lists them.
import { Water, type WaterProps } from './Water';
import { BedMaterial, type BedMaterialParameters } from './bed-material';
import {
  WaterContactContext,
  useWaterContact,
  type WaterContactRegistry,
  type WaterContactSource,
} from './water-contact';
import {
  WaterMaterial,
  type WaterContact,
  type WaterMaterialParameters,
} from './water-material';
import {
  WaterSamplerContext,
  createWaterSampler,
  useWaterSampler,
  type WaterSampler,
} from './water-sampler';
import {
  WaterVolumeMaterial,
  type WaterVolumeMaterialParameters,
} from './water-volume-material';

/** @deprecated renamed {@link Water} */
export const Ocean = Water;
/** @deprecated renamed {@link WaterProps} */
export type OceanProps = WaterProps;
/** @deprecated renamed {@link WaterMaterial} */
export const OceanMaterial = WaterMaterial;
/** @deprecated renamed {@link WaterMaterial} */
export type OceanMaterial = WaterMaterial;
/** @deprecated renamed {@link WaterMaterialParameters} */
export type OceanMaterialParameters = WaterMaterialParameters;
/** @deprecated renamed {@link WaterVolumeMaterial} */
export const OceanVolumeMaterial = WaterVolumeMaterial;
/** @deprecated renamed {@link WaterVolumeMaterial} */
export type OceanVolumeMaterial = WaterVolumeMaterial;
/** @deprecated renamed {@link WaterVolumeMaterialParameters} */
export type OceanVolumeMaterialParameters = WaterVolumeMaterialParameters;
/** @deprecated renamed {@link BedMaterial} */
export const OceanBedMaterial = BedMaterial;
/** @deprecated renamed {@link BedMaterial} */
export type OceanBedMaterial = BedMaterial;
/** @deprecated renamed {@link BedMaterialParameters} */
export type OceanBedMaterialParameters = BedMaterialParameters;
/** @deprecated renamed {@link WaterContact} */
export type OceanContact = WaterContact;
/** @deprecated renamed {@link WaterContactContext} */
export const OceanContactContext = WaterContactContext;
/** @deprecated renamed {@link WaterContactRegistry} */
export type OceanContactRegistry = WaterContactRegistry;
/** @deprecated renamed {@link WaterContactSource} */
export type OceanContactSource = WaterContactSource;
/** @deprecated renamed {@link useWaterContact} */
export const useOceanContact = useWaterContact;
/** @deprecated renamed {@link WaterSampler} */
export type OceanSampler = WaterSampler;
/** @deprecated renamed {@link WaterSamplerContext} */
export const OceanSamplerContext = WaterSamplerContext;
/** @deprecated renamed {@link createWaterSampler} */
export const createOceanSampler = createWaterSampler;
/** @deprecated renamed {@link useWaterSampler} */
export const useOceanSampler = useWaterSampler;
