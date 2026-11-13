// The deep water under an Ocean's surface (OceanDeepMaterial): the surface's geometry again, on
// the far plane, so it hides nothing and everything in the water draws over it.

varying vec3 vWorldPosition;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
  // On the far plane, whichever way the depth runs.
  #ifdef USE_REVERSED_DEPTH_BUFFER
  gl_Position.z = 0.0;
  #else
  gl_Position.z = gl_Position.w;
  #endif
}
