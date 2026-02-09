import { OutputPanel } from '../../components/Html/OutputPanel/OutputPanel';

export const OutputPanelDecorator = (Story: any) => {
  //const outputPanel = useOutputPanel()
  // useEffect(() => {
  //   if (outputPanel) {
  //     outputPanel.removeAll()
  //   }
  // }, [outputPanel])
  return (
    <>
      <OutputPanel
        origin="bottom-right"
        offset={[10, 10]}
        width={300}
        height={400}
      />
      <Story />
    </>
  );
};
