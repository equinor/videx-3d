import { Stats } from '@react-three/drei';
import './perf.css';

export const PerformanceDecorator = (Story: any) => (
  <>
    <Stats className="perf-stats" />
    <Story />
  </>
);
