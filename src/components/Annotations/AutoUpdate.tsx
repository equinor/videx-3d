import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import {
  DepthTexture,
  HalfFloatType,
  RGBAFormat,
  WebGLRenderTarget,
} from 'three';
import { OutputPass, RenderPass } from '../../rendering/render-passes';
import { AnnotationsRenderer } from './annotations-renderer';

const samples = 8;
const supersample = 1;

export const AutoUpdate = ({ maxVisible }: { maxVisible: number }) => {
  const { gl: renderer, scene, camera, pointer, clock } = useThree();
  const size = useThree(state => state.size);

  const renderTarget = useMemo(() => {
    const w = 1;
    const h = 1;
    const depthTexture = new DepthTexture(w, h);

    const pbo = new WebGLRenderTarget(w, h, {
      format: RGBAFormat,
      type: HalfFloatType,
      depthBuffer: true,
      depthTexture,
      generateMipmaps: false,
      samples,
    });
    return pbo;
  }, []);

  const renderPass = useMemo(
    () => new RenderPass(scene, camera),
    [scene, camera],
  );
  const outputPass = useMemo(() => new OutputPass(), []);
  const annotationsRenderer = useMemo(
    () => new AnnotationsRenderer(camera, clock, pointer, maxVisible),
    [camera, clock, pointer, maxVisible],
  );

  useEffect(() => {
    return () => {
      if (annotationsRenderer) {
        annotationsRenderer.dispose();
      }
    };
  }, [annotationsRenderer]);

  useEffect(() => {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    return () => {
      renderer.autoClear = prevAutoClear;
    };
  }, [renderer]);

  useEffect(() => {
    return () => {
      renderTarget.dispose();
    };
  }, [renderTarget]);

  useLayoutEffect(() => {
    const dpr = renderer.getPixelRatio();
    renderTarget.setSize(
      size.width * dpr * supersample,
      size.height * dpr * supersample,
    );
  }, [renderTarget, renderer, size]);

  useFrame(() => {
    renderPass.render(renderer, renderTarget);
    annotationsRenderer.render(renderer, renderTarget);
    outputPass.render(renderer, renderTarget);
  }, 1);

  return null;
};
