vec3 hue2rgb(in float H) {
  float R = abs(H * 6. - 3.) - 1.;
  float G = 2. - abs(H * 6. - 2.);
  float B = 2. - abs(H * 6. - 4.);
  return saturate(vec3(R, G, B));
}

vec3 hsl2rgb(in vec3 HSL) {
  vec3 RGB = hue2rgb(HSL.x);
  float C = (1. - abs(2. * HSL.z - 1.)) * HSL.y;
  return (RGB - 0.5) * C + HSL.z;
}

vec3 rgb2hsv(in vec3 RGB) {
  // Based on work by Sam Hocevar and Emil Persson
  vec4 P = (RGB.g < RGB.b) ? vec4(RGB.bg, -1.0, 2.0 / 3.0) : vec4(RGB.gb, 0.0, -1.0 / 3.0);
  vec4 Q = (RGB.r < P.x) ? vec4(P.xyw, RGB.r) : vec4(RGB.r, P.yzx);
  float C = Q.x - min(Q.w, Q.y);
  float H = abs((Q.w - Q.y) / (6. * C + EPSILON) + Q.z);
  return vec3(H, C, Q.x);
}

vec3 rgb2hsl(in vec3 RGB) {
  vec3 HCV = rgb2hsv(RGB);
  float L = HCV.z - HCV.y * 0.5;
  float S = HCV.y / (1. - abs(L * 2. - 1.) + EPSILON);
  return vec3(HCV.x, S, L);
}

vec3 hsv2rgb(in vec3 HSV) {
  vec3 RGB = hue2rgb(HSV.x);
  return ((RGB - 1.) * HSV.y + 1.) * HSV.z;
}
