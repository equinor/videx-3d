// The void walls' fill as geometry (sky-abyss-wall-fill-vertex.glsl): where the quad lies in
// their rock as their mesh lays it (skyAbyssWallInto), shaded as the background shades it
// (skyAbyssWallFill), with its depth, so it hides what lies behind the rock.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <dithering_pars_fragment>
#include ./sky.glsl

uniform float uSkyAbyssWallFillLid; // 1 on the lid, seen from above; 0 on the cut plane

varying vec3 vSkyAbyssWallFill;

void main() {
  #include <logdepthbuf_fragment>

  vec3 p = vSkyAbyssWallFill;
  vec3 toward = p - cameraPosition;
  float t = length(toward);
  vec3 dir = toward / t;
  // Taken before the discards, past which it is undefined.
  float pixel = length(fwidth(dir));
  // On the lid, its rock is cut away in front of the plane too.
  if(uSkyAbyssWallFillLid > 0.5 && dot(uSkyAbyssWallClip.xyz, p) < uSkyAbyssWallClip.w)
    discard;
  float h = dot(p, uSkyUp);
  float r = -skyAbyssWallGap(p, h);
  if(r > -skyAbyssWallLap() / uSkyAbyssWallGrid.x)
    r = skyAbyssWallInto(p, h);
  if(r <= 0.0)
    discard;

  vec3 color = skyAbyssWallFill(cameraPosition, dir, vec3(t, r, uSkyAbyssWallFillLid), pixel);
  color = skyAbyssWallHaze(color, p, t);
  if(uSkyAbyssDarkening > 0.0)
    color *= exp(min(dot(cameraPosition, uSkyUp) - uSkyAbyssLevel, 0.0) / uSkyAbyssDarkening);
  gl_FragColor = vec4(skyDebugTint(color, vec3(0.95, 0.85, 0.1)), 1.0);
  gl_FragColor.rgb *= uSkyIntensity;

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
