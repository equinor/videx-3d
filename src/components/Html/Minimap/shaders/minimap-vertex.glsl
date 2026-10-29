// The minimap's grid: NDC positions, and each vertex's longitude and latitude (degrees) from
// the middle of the view, as the CPU placed it (minimap-renderer.ts). Relative, so a pixel's
// step, which the shader takes from its derivatives, keeps its precision in 32 bits. In a
// projection, its point of the projection's plane too (metres east and south), for the
// map's outline; in the scene's map seen wide, its direction from the Earth's centre, which
// interpolates through a pole and across the antimeridian without a jump.

attribute vec2 aGeo;
attribute vec2 aPlane;
attribute vec3 aDir;
varying vec2 vGeo;
varying vec2 vPlane;
varying vec3 vDir;

void main() {
  vGeo = aGeo;
  vPlane = aPlane;
  vDir = aDir;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
