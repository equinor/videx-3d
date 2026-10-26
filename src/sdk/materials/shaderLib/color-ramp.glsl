// A value through one of the shared colour ramps (`colorRampTexture`, color-ramps.ts).
// `ramp` is its row across the texture (`colorRampRow`), the value at its low end and at
// its high end, and 1 to run it the other way. Linear colour: the texture is sRGB.
vec3 colorRampAt(sampler2D ramps, vec4 ramp, float value) {
  float span = ramp.z - ramp.y;
  float t = clamp((value - ramp.y) / (span == 0.0 ? 1.0 : span), 0.0, 1.0);
  if(ramp.w > 0.5)
    t = 1.0 - t;
  // Between the end texels' centres, so a ramp ends on its stops' colours.
  float width = float(textureSize(ramps, 0).x);
  return textureLod(ramps, vec2((t * (width - 1.0) + 0.5) / width, ramp.x), 0.0).rgb;
}
