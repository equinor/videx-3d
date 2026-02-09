import { GlyphsProvider } from '../../main';

export const GlyphsDecorator = (Story: any) => (
  <GlyphsProvider
    fontAtlasUrl="glyphs/OpenSans-Regular.png"
    fontConfigUrl="glyphs/OpenSans-Regular.json"
  >
    <Story />
  </GlyphsProvider>
);
