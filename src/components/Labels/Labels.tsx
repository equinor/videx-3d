import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { LabelAtlas } from './label-atlas';

const LabelAtlasContext = createContext<LabelAtlas | null>(null);

// The atlas of layers under no `<Labels>`: one for the page, kept.
let pageAtlas: LabelAtlas | null = null;

/** The atlas the labels here draw their texts from: their `<Labels>`'s, or the page's. */
export function useLabelAtlas() {
  const atlas = useContext(LabelAtlasContext);
  return atlas ?? (pageAtlas ??= new LabelAtlas());
}

/**
 * Labels props.
 * @expand
 */
export type LabelsProps = {
  children?: ReactNode;
};

/**
 * Groups label layers (`LabelLayer`) round one text atlas of their own, freed with it.
 * Optional: layers under none share the page's atlas.
 *
 * Labels are scene objects: they need nothing of the render loop. In an `OITRenderPass`
 * they are drawn last, on the `LAYERS.OVERLAY` layer, after the transparent layers resolve;
 * elsewhere after the transparent objects.
 *
 * @example
 * <Labels>
 *   <LabelLayer provider={gridLabels} size={50} color="#ffffff" />
 *   <LabelLayer labels={contourLabels} size={30} color="#ffd23f" />
 * </Labels>
 *
 * @see {@link LabelLayer}
 *
 * @group Components
 */
export const Labels = ({ children }: LabelsProps) => {
  const [atlas] = useState(() => new LabelAtlas());
  useEffect(() => () => atlas.dispose(), [atlas]);
  return (
    <LabelAtlasContext.Provider value={atlas}>
      {children}
    </LabelAtlasContext.Provider>
  );
};
