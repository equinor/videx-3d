import { Texture } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createReliefTilePlainMaterial,
  createSceneryReliefTileSeeThroughMaterial,
  SceneryReliefTileTextures,
} from '../src/components/Scenery/scenery-relief-tiles';
import { Globe } from '../src/sdk/projection/globe';

// The relief without a sky (a GeoRelief with no Scenery, world.md 7d-2): its own shaders on
// the World's globe, lit by the scene's lights.
describe('createReliefTilePlainMaterial', () => {
  const globe = new Globe();
  const textures = new SceneryReliefTileTextures(4, 2);
  const looks = new Texture();

  it('binds the globe’s uniform objects, so it follows the globe as it changes', () => {
    const material = createReliefTilePlainMaterial(globe, textures, looks);
    for (const [name, uniform] of Object.entries(globe.uniforms))
      expect(material.uniforms[name], name).toBe(uniform);
  });

  it('reads nothing of a sky, and is lit by the scene’s lights', () => {
    const material = createReliefTilePlainMaterial(globe, textures, looks);
    expect(material.fragmentShader).not.toMatch(/uSky/);
    expect(material.vertexShader).not.toMatch(/uSky/);
    expect(material.lights).toBe(true);
    expect(material.uniforms.ambientLightColor).toBeDefined();
    expect(material.uniforms.directionalLights).toBeDefined();
  });

  it('leaves the see-through area to a copy drawn at its own opacity', () => {
    const opaque = createReliefTilePlainMaterial(globe, textures, looks, {
      stage: 'around',
    });
    expect(opaque.defines.RELIEF_STAGE_AROUND).toBe('');
    const seeThrough = createSceneryReliefTileSeeThroughMaterial(opaque);
    expect(seeThrough.fragmentShader).toBe(opaque.fragmentShader);
    expect(seeThrough.uniforms).toBe(opaque.uniforms);
    expect(seeThrough.defines.RELIEF_SEE_THROUGH).toBe('');
    expect(seeThrough.defines.RELIEF_STAGE_AROUND).toBeUndefined();
    expect(seeThrough.defines.RELIEF_SEE_THROUGH_ALL).toBeUndefined();
    expect(seeThrough.transparent).toBe(true);
    expect(seeThrough.fragmentShader).toMatch(/uReliefOpacity/);
  });

  it('draws every tile see-through as one copy, below an opacity of 1', () => {
    const opaque = createReliefTilePlainMaterial(globe, textures, looks);
    const all = createSceneryReliefTileSeeThroughMaterial(opaque, 'all');
    expect(all.defines.RELIEF_SEE_THROUGH).toBe('');
    expect(all.defines.RELIEF_SEE_THROUGH_ALL).toBe('');
    expect(all.uniforms).toBe(opaque.uniforms);
    expect(all.transparent).toBe(true);
  });

  it('leaves out the land or the seabed by a define', () => {
    const plain = createReliefTilePlainMaterial(globe, textures, looks);
    expect(plain.defines.RELIEF_NO_LAND).toBeUndefined();
    expect(plain.defines.RELIEF_NO_SEABED).toBeUndefined();
    const bedOnly = createReliefTilePlainMaterial(globe, textures, looks, {
      land: false,
    });
    expect(bedOnly.defines.RELIEF_NO_LAND).toBe('');
    const landOnly = createReliefTilePlainMaterial(globe, textures, looks, {
      seabed: false,
    });
    expect(landOnly.defines.RELIEF_NO_SEABED).toBe('');
  });
});
