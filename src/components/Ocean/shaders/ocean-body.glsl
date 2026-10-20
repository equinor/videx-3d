// A water body's light play: two drifting, criss-crossing wave layers form soft caustic
// filaments, concentrated just under the surface (`wallV` 1 at the surface, 0 at the
// bed) and fading with depth, so it reads as sunlight filtering down through the water.
//
// Footprint anti-aliased: each layer fades out as its world wavelength approaches the
// on-screen pixel size, so the body never shimmers when zoomed far out. ⚠️ Derivatives.
vec3 oceanBodyLight(vec3 color, vec3 worldPosition, float wallV, float time, float shimmer, vec3 lightColor) {
  float texel = max(length(fwidth(worldPosition.xz)), 1e-3);

  // Light concentrates near the surface and fades toward the bed (depth-cue).
  float nearSurface = wallV * wallV;

  if(nearSurface > 0.001) {
    // Broad, slow caustic web (~250 m features).
    float webAA = 1.0 - smoothstep(120.0, 400.0, texel);
    float web = 0.0;
    if(webAA > 0.001) {
      vec2 p = worldPosition.xz * 0.0045;
      float t = time * 0.18;
      float c = sin(p.x * 1.3 + sin(p.y * 0.7 + t)) +
        sin(p.y * 1.1 - sin(p.x * 0.9 - t * 0.8));
      web = pow(max(c * 0.25 + 0.5, 0.0), 3.0) * webAA;
    }

    // Finer, faster ripple twinkle (~60 m features).
    float rippleAA = 1.0 - smoothstep(40.0, 140.0, texel);
    float ripple = 0.0;
    if(rippleAA > 0.001) {
      vec2 q = worldPosition.xz * 0.018;
      float t = time * 0.5;
      float r = sin(q.x + sin(q.y * 1.4 + t) + t * 0.6) +
        sin(q.y * 1.2 - sin(q.x - t * 0.7));
      ripple = pow(max(r * 0.25 + 0.5, 0.0), 4.0) * rippleAA;
    }

    // Brighten toward the shallow (sunlit) colour rather than a flat white so
    // it reads as light in the water, not a glare overlay.
    float light = (web * 0.7 + ripple * 0.5) * nearSurface;
    color = mix(color, lightColor, clamp(light * shimmer, 0.0, 0.5));
  }
  return color;
}
