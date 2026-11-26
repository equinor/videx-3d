import { useThree } from '@react-three/fiber';
import { ReactNode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { useAnnotationsState } from './annotations-state';
import { AnnotationsHTML } from './AnnotationsHMTL';
import { AutoUpdate } from './AutoUpdate';

/**
 * Annotations provider component props
 * @expand
 */
export type AnnotationsProviderProps = {
  autoUpdate?: boolean;
  maxVisible?: number;
  children?: ReactNode;
};

const id = `annotations_root`;

/**
 * Labels for points in the scene, drawn as regular React HTML components over the 3D view,
 * each tied to its point by an anchor and a connector line. Add a layer for each kind of
 * annotation as a child (`AnnotationsLayer`), and the annotations themselves with the
 * `useAnnotations` hook.
 *
 * All annotations are ranked together: by priority, by how central and near they are, and by
 * whether they show already. A label that would overlap another tries other places round its
 * anchor, or gives way to those ranked higher; one whose anchor is hidden behind the scene
 * fades out. At most `maxVisible` are considered at a time. Each layer sets its priority and
 * the distances it shows within, and an annotation may add a priority of its own.
 *
 * With `autoUpdate` (the default) it draws the scene itself, through a `RenderPass`, an
 * `AnnotationsPass` and an `OutputPass`; turn it off to add an `AnnotationsPass` to a
 * rendering pipeline of your own.
 *
 * @example
 * <Annotations>
 *  <AnnotationsLayer id="casings_annotations" name="Casing Annotations" />
 * </Annotations>
 *
 * @remarks
 * This component sets up a global state and takes control over the render loop!
 * It's therefore important that only a single instance of this component is mounted
 * at any time in your project. Using this component with an EffectsComposer may cause issues,
 * and we will likely convert it from being a component into being a post-processing pass at some point.
 *
 * @see [Storybook](/videx-3d/?path=/docs/components-misc-annotations--docs)
 * @see {@link AnnotationsLayer}
 *
 * @group Components
 */

export const Annotations = ({
  maxVisible = 100,
  autoUpdate = true,
  children,
}: AnnotationsProviderProps) => {
  const gl = useThree(state => state.gl);

  const dispose = useAnnotationsState(state => state.clear);

  const root = useMemo(() => {
    const parent = gl.domElement.parentElement;

    if (!parent) throw Error('Unable to create root!');

    parent.querySelector(`#${id}`)?.remove(); // remove any existing annotations container

    const container = document.createElement('div');
    container.setAttribute('id', id);
    container.setAttribute(
      'style',
      'position:absolute;top:0;left:0;z-index: 1;pointer-events:none;padding:0;width:100%;height:100%;user-select:none',
    );
    parent.appendChild(container);

    return createRoot(container);
  }, [gl]);

  useEffect(() => {
    root.render(<AnnotationsHTML />);
    return () => {
      root.unmount();
      dispose();
    };
  }, [root, dispose]);

  return (
    <>
      {autoUpdate && <AutoUpdate maxVisible={maxVisible} />}
      {children}
    </>
  );
};
