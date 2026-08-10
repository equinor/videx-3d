import { OutputPanel } from '../../components/Html/OutputPanel/OutputPanel';
import { PanelProps } from '../../components/Html/Panel/Panel';

/**
 * Build an output-panel decorator with a given placement/size. Must be the LAST
 * decorator in the array (= the outermost), so the panel is rendered as plain DOM
 * OUTSIDE the R3F canvas.
 */
export const createOutputPanelDecorator =
  (panelProps: PanelProps) => (Story: any) => (
    <>
      <OutputPanel {...panelProps} />
      <Story />
    </>
  );

export const OutputPanelDecorator = createOutputPanelDecorator({
  origin: 'bottom-right',
  offset: [10, 10],
  width: 300,
  height: 400,
});
