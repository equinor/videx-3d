// The void's walls' mesh (sky-abyss-wall-vertex.glsl): their rock lit, its finer relief from
// the cliffs' normal map, in their mist and haze. In front of the plane they are cut away up
// to, or behind their fill, it leaves the background to draw the fill and what lies beyond.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <dithering_pars_fragment>
#include ./sky.glsl

uniform vec2 uSkyAbyssWallDebug; // above 0.5: x drawn in one colour (for a wireframe), y without their relief

varying vec3 vSkyAbyssWall;
varying vec3 vSkyAbyssWallNormal;
varying vec2 vSkyAbyssWallOutward;
varying vec3 vSkyAbyssWallAt;

// The rock lit, facing `normal`, with its relief laid three ways and blended by how the face
// turns: round the outline and down where it faces into the hollow, out across it and down
// on a protrusion's sides, round and out where it faces up or down; one way alone smears on
// the others. `uvw` and its derivatives are the three coordinates, in tiles of the relief.
vec3 skyAbyssWallFace(vec3 normal, float h, vec3 uvw, vec3 dx, vec3 dy) {
  if(uSkyAbyssWallDebug.y > 0.5)
    return skyAbyssWallShade(normal, 1.0, h);
  vec2 o = normalize(vSkyAbyssWallOutward);
  vec3 out3 = uSkyEast * o.x - uSkyNorth * o.y;
  vec3 round3 = -uSkyEast * o.y - uSkyNorth * o.x;
  vec3 w = pow(abs(vec3(dot(normal, out3), dot(normal, round3), dot(normal, uSkyUp))), vec3(4.0));
  // Only the ways that show are read.
  w *= step(0.02, w / (w.x + w.y + w.z));
  w /= w.x + w.y + w.z;
  vec3 bump = vec3(0.0);
  float open = 0.0;
  if(w.x > 0.0) {
    vec4 a = textureGrad(uSkyAbyssWallRock, uvw.xy, dx.xy, dy.xy);
    bump += w.x * (round3 * (a.y * 2.0 - 1.0) - uSkyUp * (a.z * 2.0 - 1.0));
    open += w.x * a.w;
  }
  if(w.y > 0.0) {
    vec4 b = textureGrad(uSkyAbyssWallRock, uvw.zy, dx.zy, dy.zy);
    bump += w.y * (out3 * (b.y * 2.0 - 1.0) - uSkyUp * (b.z * 2.0 - 1.0));
    open += w.y * b.w;
  }
  if(w.z > 0.0) {
    vec4 c = textureGrad(uSkyAbyssWallRock, uvw.xz, dx.xz, dy.xz);
    bump += w.z * (round3 * (c.y * 2.0 - 1.0) + out3 * (c.z * 2.0 - 1.0));
    open += w.z * c.w;
  }
  return skyAbyssWallShade(normalize(normal + bump), open, h);
}

void main() {
  #include <logdepthbuf_fragment>

  // Taken before the discard, past which they are undefined.
  vec3 uvw = vSkyAbyssWallAt / (uSkyAbyssWalls.w * SKY_ABYSS_CLIFF_TILE / SKY_ABYSS_RELIEF_REPEAT);
  vec3 dx = dFdx(uvw);
  vec3 dy = dFdy(uvw);

  vec3 toward = vSkyAbyssWall - cameraPosition;
  float t = length(toward);
  vec3 dir = toward / t;
  if(skyAbyssWallHidden(cameraPosition, dir, t))
    discard;

  vec3 color = vec3(0.95, 0.85, 0.1);
  if(uSkyAbyssWallDebug.x < 0.5) {
    vec3 normal = normalize(vSkyAbyssWallNormal);
    color = skyAbyssWallFace(normal, dot(vSkyAbyssWall, uSkyUp), uvw, dx, dy);
    // Veiled by the mist clinging to the rock, thicker the more the view runs along it.
    float mist = uSkyAbyssWallMist.x;
    if(mist > 0.0) {
      float veil = 1.0 - exp(-mist * skyAbyssWallMistAt(vSkyAbyssWall) * SKY_ABYSS_MIST_VEIL / max(abs(dot(normal, dir)), 0.08));
      color = mix(color, skyAbyssWallMistLight(dot(vSkyAbyssWall, uSkyUp)), veil);
    }
    color = skyAbyssWallHaze(color, vSkyAbyssWall, t);
    // Dimmed with the camera's depth, as the background dims the void (skyAbyss).
    if(uSkyAbyssDarkening > 0.0)
      color *= exp((dot(cameraPosition, uSkyUp) - uSkyAbyssLevel) / uSkyAbyssDarkening);
  }
  gl_FragColor = vec4(skyDebugTint(color, vec3(0.95, 0.85, 0.1)), 1.0);
  gl_FragColor.rgb *= uSkyIntensity;

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
