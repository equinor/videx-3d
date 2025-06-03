float inverseLerp(float v, float minValue, float maxValue) {
  return (v - minValue) / (maxValue - minValue);
}

float remap(float v, float inMin, float inMax, float outMin, float outMax) {
  float t = inverseLerp(v, inMin, inMax); 
  return mix(outMin, outMax, t);
}

float inverseSmoothstep(float y)
{
    return 0.5 - sin(asin(1.0- 2.0 * y) / 3.0);
}