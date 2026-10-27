import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { RenderStats } from '../../components/Html/RenderStats/RenderStats';
import { Pass } from '../../rendering/Pass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import { OITRenderPass } from '../../rendering/passes/OITRenderPass';
import { OutputPass } from '../../rendering/passes/OutputPass';
import type { SceneryArgs } from './scenery-controls';
import { RendererToneMapping } from './tone-mapping-controls';

// Order-independent transparency with SMAA, then the output pass.
const OitPipeline = () => {
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const passes = useMemo<Pass[]>(() => {
    const base = new OITRenderPass(scene, camera);
    base.antialias = 'smaa';
    return [base, new OutputPass()];
  }, [scene, camera]);
  useFrame(() => {}, 2);
  return <RenderingPipeline passes={passes} />;
};

/** The renderer side of {@link SceneryArgs}: tone mapping, the pipeline and the stats overlay. */
export const SceneryStoryRendering = ({ args }: { args: SceneryArgs }) => (
  <>
    <RendererToneMapping
      toneMapping={args.toneMapping}
      exposure={args.exposure}
    />
    {args.pipeline === 'oit' && <OitPipeline />}
    {args.stats && <RenderStats origin="bottom-left" />}
  </>
);
