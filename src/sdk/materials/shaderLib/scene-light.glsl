// A surface lit by the scene's lights as three's Blinn-Phong materials light it — the light
// loops of `lights_fragment_begin` without shadows — for a shader that shades a surface it has
// no mesh of its own for (a ray-traced plane, say). `ambient` redistributes the ambient light
// by orientation, x facing up and y facing down, as `ChunkMaterial`'s `ambient` does; (1, 1)
// leaves it flat. `position` and `normal` are in view space.
// ⚠️ Needs <common>, <bsdfs> and <lights_pars_begin>, and a material with `lights: true`.

void sceneBlinnPhongDirect(IncidentLight light, vec3 normal, vec3 viewDir, vec3 specularColor, float shininess, inout vec3 direct, inout vec3 specular) {
  vec3 irradiance = saturate(dot(normal, light.direction)) * light.color;
  direct += irradiance;
  specular += irradiance * BRDF_BlinnPhong(light.direction, viewDir, normal, specularColor, shininess);
}

// ⚠️ The loops are unrolled as three unrolls its own (a one-light loop warns on ANGLE), so
// their bodies may only index with `[ i ]` and declare nothing.
vec3 sceneBlinnPhong(vec3 diffuseColor, vec3 specularColor, float shininess, vec2 ambient, vec3 position, vec3 normal) {
  vec3 viewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-position);
  vec3 direct = vec3(0.0);
  vec3 specular = vec3(0.0);
  IncidentLight light;

  #if NUM_DIR_LIGHTS > 0
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
    getDirectionalLightInfo(directionalLights[ i ], light);
    sceneBlinnPhongDirect(light, normal, viewDir, specularColor, shininess, direct, specular);
  }
  #pragma unroll_loop_end
  #endif

  #if NUM_POINT_LIGHTS > 0
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
    getPointLightInfo(pointLights[ i ], position, light);
    sceneBlinnPhongDirect(light, normal, viewDir, specularColor, shininess, direct, specular);
  }
  #pragma unroll_loop_end
  #endif

  #if NUM_SPOT_LIGHTS > 0
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
    getSpotLightInfo(spotLights[ i ], position, light);
    sceneBlinnPhongDirect(light, normal, viewDir, specularColor, shininess, direct, specular);
  }
  #pragma unroll_loop_end
  #endif

  vec3 irradiance = getAmbientLightIrradiance(ambientLightColor);
  #if defined(USE_LIGHT_PROBES)
  irradiance += getLightProbeIrradiance(lightProbe, normal);
  #endif
  #if NUM_HEMI_LIGHTS > 0
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
    irradiance += getHemisphereLightIrradiance(hemisphereLights[ i ], normal);
  }
  #pragma unroll_loop_end
  #endif
  vec3 worldNormal = normalize(normal * mat3(viewMatrix));
  irradiance *= mix(ambient.y, ambient.x, worldNormal.y * 0.5 + 0.5);

  return (direct + irradiance) * BRDF_Lambert(diffuseColor) + specular;
}
