import { transfer } from 'comlink';
import { WellboreSeismicSectionGeneratorResponse } from '../components/Wellbores/WellboreSeismicSection/wellbore-seismic-section-defs';
import { packBufferGeometry, ReadonlyStore, simplifyCurve2D } from '../sdk';
import { VerticalSlice } from '../sdk/data/types/VerticalSlice';
import { createFenceGeometry } from '../sdk/geometries/fence';

export async function generateWellboreSeismicSection(
  this: ReadonlyStore,
  id: string,
  stepSize: number = 3,
  minSize: number = 1000,
  extension: number = 1000,
  defaultExtensionAngle: number = 0,
): Promise<WellboreSeismicSectionGeneratorResponse | null> {
  const args = {
    stepSize,
    minSize,
    extension,
    defaultExtensionAngle,
  };

  const slice = await this.get<VerticalSlice>(
    'wellbore-seismic-section',
    id,
    args,
  );

  if (slice === null || slice.trajectory === null) return null;

  const { positions } = slice.trajectory;

  const y0 = -slice.depthRange[0];
  const y1 = -slice.depthRange[1];

  const simplifiedPositions = simplifyCurve2D(positions);

  const geometry = createFenceGeometry(simplifiedPositions, y0, y1);

  const [packedBufferGeometry, geometryBuffers] = packBufferGeometry(geometry);

  const response: WellboreSeismicSectionGeneratorResponse = {
    data: {
      array: slice.values,
      width: slice.samples[0],
      height: slice.samples[1],
      min: slice.valueRange[0],
      max: slice.valueRange[1],
    },
    geometry: packedBufferGeometry,
  };

  const transferrable = [response.data.array.buffer, ...geometryBuffers];

  return transfer(response, transferrable);
}
