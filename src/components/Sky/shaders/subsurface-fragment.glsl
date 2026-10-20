// The subsurface a Sky lights the scene with below its seabed (see SkySubsurface): a dark
// backdrop and soft light panels, fixed in the sky's up/north frame. Filmed into the
// environment and the light probe only, never drawn.

uniform vec3 uSkyUp;
uniform vec3 uSkyNorth;
uniform vec3 uSkyEast;
uniform vec3 uSubsurfaceTop;
uniform vec3 uSubsurfaceBottom;
uniform vec3 uSubsurfaceAbove; // the panels above the horizon, colour times intensity
uniform vec3 uSubsurfaceBelow; // and below it

varying vec3 vSkyDirection;

// Each panel: compass bearing and elevation, angular radius (degrees), share of the light.
const int SUBSURFACE_PANELS = 5;
const vec4 SUBSURFACE_PANEL[SUBSURFACE_PANELS] = vec4[SUBSURFACE_PANELS](vec4(45.0, 45.0, 14.0, 1.0), // key
vec4(225.0, 30.0, 20.0, 0.4), // fill
vec4(0.0, 90.0, 24.0, 0.6), // top
vec4(135.0, -35.0, 20.0, 0.5), // bounce
vec4(315.0, -35.0, 20.0, 0.5) // bounce
);

void main() {
  vec3 dir = normalize(vSkyDirection);
  float y = dot(dir, uSkyUp);
  vec3 color = mix(uSubsurfaceBottom, uSubsurfaceTop, smoothstep(-1.0, 1.0, y));

  for(int i = 0; i < SUBSURFACE_PANELS; i++) {
    vec4 panel = SUBSURFACE_PANEL[i];
    float azimuth = radians(panel.x);
    float elevation = radians(panel.y);
    vec3 toward = (uSkyNorth * cos(azimuth) + uSkyEast * sin(azimuth)) * cos(elevation) + uSkyUp * sin(elevation);
    float radius = radians(panel.z);
    // Soft from 60% of the radius out.
    float lit = smoothstep(cos(radius), cos(0.6 * radius), dot(dir, toward));
    color += (panel.y < 0.0 ? uSubsurfaceBelow : uSubsurfaceAbove) * panel.w * lit;
  }

  gl_FragColor = vec4(color, 1.0);
}
