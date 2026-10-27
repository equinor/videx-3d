// A cube map unfolded as a cross in a screen corner, for debugging: +Y over -X -Z +X +Z,
// -Y under, each face as seen from inside the cube with up toward +Y (the top and bottom
// faces continue the -Z face).

attribute vec2 cell; // column, row of the face in the cross
attribute vec3 axis; // the face's direction, its right and its up
attribute vec3 right;
attribute vec3 up;

uniform vec2 uCubeViewCell; // a face's size in clip space
uniform vec2 uCubeViewOrigin; // the cross's lower left corner in clip space

varying vec3 vCubeDirection;

void main() {
  // `position.xy` runs -1..1 across the face.
  vec2 at = uCubeViewOrigin + (cell + position.xy * 0.5 + 0.5) * uCubeViewCell;
  vCubeDirection = axis + position.x * right + position.y * up;
  gl_Position = vec4(at, 0.0, 1.0);
}
