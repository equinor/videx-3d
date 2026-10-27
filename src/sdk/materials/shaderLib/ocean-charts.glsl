// The charts a sea's waves are drawn in (OceanCharts, ocean-charts.ts): the field's own,
// its wave plane over the disc and stereographic about the disc's centre out to
// uOceanCharts.y from it; past it fixed ones, each stereographic about the nearest of
// points fixed on the Earth. Where two meet the waves calm over a strip uOceanCharts.z
// wide, and the charts switch on its middle. A point's chart and its coordinates in it
// depend on the point alone, so the sea is the same however the camera reaches it. They
// are the camera's, worked out in 64-bit floats on the CPU, plus the offset from the camera
// (`delta`, precise), so they hold as well far round the Earth as over the field. With
// them off (the globe off), the field's plane. Needs globe.glsl.

uniform vec4 uOceanCharts; // the sphere's radius, the field's chart's reach, the calm strip's width; w: 1 while on
uniform vec3 uOceanChartOrigin; // the camera, from the sphere's centre
// Per chart, 0 the field's and 1–3 the fixed ones nearest the camera: its centre (unit, from
// the sphere's centre), the wave plane's X and Z there, and the camera's coordinates in it.
uniform vec3 uOceanChartCentre[4];
uniform vec3 uOceanChartX[4];
uniform vec3 uOceanChartZ[4];
uniform vec2 uOceanChartCamera[4];
// The slot of the chart every pixel takes, while the waves meet no other near the camera;
// −1 for each its own.
uniform float uOceanChartOnly;

// The chart a point takes, and how much of the waves it keeps there.
struct OceanChart {
  int index;
  float keep;
};

bool oceanChartsOn() {
  return uOceanCharts.w > 0.5;
}

// The chart at the point `delta` from the camera, on the sea (OceanCharts.chartAt): the
// field's within its reach, past it the nearest fixed one; calm by how far the point lies
// from the line where two meet.
OceanChart oceanChartAt(vec3 delta) {
  OceanChart chart;
  chart.index = 0;
  chart.keep = 1.0;
  if(!oceanChartsOn())
    return chart;
  // Away from every line where two meet, the camera's: the same for every pixel.
  if(uOceanChartOnly >= 0.0) {
    chart.index = int(uOceanChartOnly + 0.5);
    return chart;
  }
  float R = uOceanCharts.x;
  float fade = 0.5 * uOceanCharts.z;
  vec3 u = normalize(uOceanChartOrigin + delta);
  float fieldFrom = R * acos(clamp(dot(u, uOceanChartCentre[0]), -1.0, 1.0));
  if(fieldFrom < uOceanCharts.y) {
    chart.keep = smoothstep(0.0, fade, uOceanCharts.y - fieldFrom);
    return chart;
  }
  float a1 = 1e3;
  float a2 = 1e3;
  int i1 = 1;
  for(int i = 1; i < 4; i++) {
    float a = acos(clamp(dot(u, uOceanChartCentre[i]), -1.0, 1.0));
    if(a < a1) {
      a2 = a1;
      a1 = a;
      i1 = i;
    } else if(a < a2)
      a2 = a;
  }
  chart.index = i1;
  chart.keep = smoothstep(0.0, fade, min(fieldFrom - uOceanCharts.y, 0.5 * R * (a2 - a1)));
  return chart;
}

// The coordinates in chart `i` of the point `delta` from the camera (OceanCharts.coords):
// the camera's, plus how far the stereographic projection moves from it, in terms that are
// all small or all large, so nothing near-equal is subtracted.
vec2 oceanChartCoords(int i, vec3 delta) {
  vec3 X = uOceanChartX[i];
  vec3 Z = uOceanChartZ[i];
  if(!oceanChartsOn()) {
    vec3 p = cameraPosition + delta;
    return vec2(dot(p, X), dot(p, Z));
  }
  vec3 c = uOceanChartCentre[i];
  vec3 o = uOceanChartOrigin;
  float R = uOceanCharts.x;
  float B = R + dot(o, c);
  float Dc = dot(delta, c);
  vec2 along = B * vec2(dot(delta, X), dot(delta, Z)) - vec2(dot(o, X), dot(o, Z)) * Dc;
  return uOceanChartCamera[i] + (2.0 * R / (B * (B + Dc))) * along;
}

// A normal `n` in chart `i`'s wave plane (X, up, Z), where the sea's up is `up`: its axes
// there are the chart's turned from its centre onto `up`, as the projection is conformal.
vec3 oceanChartNormal(int i, vec3 n, vec3 up) {
  vec3 c = uOceanChartCentre[i];
  return globeTurnFrom(uOceanChartX[i] * n.x + c * n.y + uOceanChartZ[i] * n.z, c, up);
}
