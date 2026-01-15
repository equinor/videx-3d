uniform int side;

varying vec3 vWorldPosition;
flat varying float vEmitterId;

void main() {
  if(side == 1 && gl_FrontFacing || side == 0 && !gl_FrontFacing) {
    discard;
  }
  gl_FragColor = vec4(vEmitterId, vWorldPosition);
}