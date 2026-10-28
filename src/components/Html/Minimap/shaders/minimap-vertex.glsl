// The minimap's grid: NDC positions, and each vertex's longitude and latitude (degrees) from
// the middle of the view, as the CPU placed it (minimap-renderer.ts). Relative, so a pixel's
// step, which the shader takes from its derivatives, keeps its precision in 32 bits.

attribute vec2 aGeo;
varying vec2 vGeo;

void main() {
  vGeo = aGeo;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
