import { createContext } from 'react';
import { Texture, UniformsGroup } from 'three';
import { EncodedTextSegment, EncodedTextTexture } from '../sdk/utils/glyphs';

/**
 * GlyphsContext props
 * @expand
 */
export type GlyphsContextProps = {
  glyphAtlas: Texture;
  glyphsCount: number;
  glyphData: UniformsGroup;
  encodeText: (text: string) => EncodedTextSegment;
  encodeTextTexture: (textSegments: string[] | string) => EncodedTextTexture;
  dispose: () => void;
};

/**
 * Glyphs context
 * @group Contexts
 */
export const GlyphsContext = createContext<GlyphsContextProps | null>(null);
