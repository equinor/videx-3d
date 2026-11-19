// The 3D clouds' shadows on what the sky lights (SceneryMaterial.setCloudShadow): a map of how
// much of the light reaches the ground through them, over a square about the camera's foot
// (scenery-clouds.ts, cloud-march.glsl's CLOUD_SHADOW), the sea and the relief
// reading it at the place they shade. The scene's light is already dimmed by the share the
// clouds let through on the whole (uSkyCloudShadowLight.x): this gives what to scale it by
// here instead.

uniform sampler2D uSkyCloudShadow;
// The square's middle (world) and how far it reaches to its sides along east and north (w,
// world units; 0: no shadows); east and north there.
uniform vec4 uSkyCloudShadowPlace;
uniform vec3 uSkyCloudShadowEast;
uniform vec3 uSkyCloudShadowNorth;
// The share of the light the scene's light was already dimmed to (x), which past the square
// stands; and how much the shadows apply (y: 0 where the scene's light is not the sky's, below
// the seabed).
uniform vec2 uSkyCloudShadowLight;

// The share of the light that reaches the ground at `world` through the clouds: the map's,
// easing toward its sides into the share the scene's light was dimmed to; all of it without
// shadows, or where they do not apply. Read on the map's mipmaps over `pixel` (world units a
// pixel spans there): far off, a pixel spans many of its texels, and read at its finest the
// clouds' lumps in it shimmered as the view moved (2026-11-19).
float skyCloudLightAt(vec3 world, float pixel) {
  float reach = uSkyCloudShadowPlace.w;
  if(reach <= 0.0 || uSkyCloudShadowLight.y <= 0.0)
    return 1.0;
  vec3 v = world - uSkyCloudShadowPlace.xyz;
  vec2 at = vec2(dot(v, uSkyCloudShadowEast), dot(v, uSkyCloudShadowNorth)) / reach;
  float edge = max(abs(at.x), abs(at.y));
  float through = uSkyCloudShadowLight.x;
  if(edge < 1.0) {
    float lod = log2(max(pixel * float(textureSize(uSkyCloudShadow, 0).x) / (2.0 * reach), 1.0));
    through = mix(textureLod(uSkyCloudShadow, at * 0.5 + 0.5, lod).r, through, smoothstep(0.75, 1.0, edge));
  }
  return mix(1.0, through, uSkyCloudShadowLight.y);
}

// What to scale the scene's (already dimmed) light by where `through` of the light reaches the
// ground (skyCloudLightAt): that share over the share the light was dimmed to. 1 without
// shadows, and past the square.
float skyCloudShadowFrom(float through) {
  if(uSkyCloudShadowPlace.w <= 0.0 || uSkyCloudShadowLight.y <= 0.0)
    return 1.0;
  float dimmed = mix(1.0, max(uSkyCloudShadowLight.x, 1e-3), uSkyCloudShadowLight.y);
  return through / dimmed;
}

// What to scale the scene's (already dimmed) light by at `world`, `pixel` world units a pixel
// there, for the clouds' shadow there (skyCloudShadowFrom).
float skyCloudShadow(vec3 world, float pixel) {
  return skyCloudShadowFrom(skyCloudLightAt(world, pixel));
}

// How much of the daylight on the level is the sun's own, the rest the sky's, for its
// elevation's sine `sine`: some 85% with the sun high, 60% at 10°, none once it has set
// (clear air). What a cloud's shadow takes from the light on the sea's water.
#define SKY_SUN_SHARE 0.85
float skySunShare(float sine) {
  return SKY_SUN_SHARE * (1.0 - exp(-max(sine, 0.0) / 0.14));
}
