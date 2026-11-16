// The foam's life (foam-life-fragment.glsl): one triangle over the whole square.
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
