import { useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { RenderingPipeline } from '../../rendering';
import { OutputPass, RenderPass } from '../../rendering/passes';
import { AnnotationsPass } from '../../rendering/passes/AnnotationsPass';

const samples = 8;
const supersample = 1;

export const AutoUpdate = ({ maxVisible }: { maxVisible: number }) => {
  const { scene, camera, pointer, clock } = useThree();

  const passes = useMemo(
    () => [
      new RenderPass(scene, camera),
      new AnnotationsPass(camera, clock, pointer, maxVisible),
      new OutputPass(),
    ],
    [scene, camera, clock, pointer, maxVisible],
  );

  return (
    <RenderingPipeline
      passes={passes}
      samples={samples}
      supersample={supersample}
    />
  );
};
