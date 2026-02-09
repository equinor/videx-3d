import { ShaderMaterial } from 'three';
import vertexShader from './shaders/uv/vertex.glsl';
import fragmentShader from './shaders/uv/fragment.glsl';

export const uvMaterial = new ShaderMaterial({
  vertexShader,
  fragmentShader,
});
