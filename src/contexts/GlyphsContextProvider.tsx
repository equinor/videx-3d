
import { useTexture } from '@react-three/drei'
import { PropsWithChildren, useEffect, useMemo, useState } from 'react'
import { LinearFilter, Texture } from 'three'
import { createConfig, GlyphConfig } from '../sdk/utils/glyphs'
import { GlyphsContext, GlyphsContextProps } from './GlyphsContext'

/**
 * GlyphsProvider props
 * @expand
 */
export type GlyphsProviderProps = {
  fontAtlasUrl: string
  fontConfigUrl: string
}

async function get(url: string) {
  const response = await fetch(
    url,
    {
      method: 'GET',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    },
  );

  const { status } = response;

  if ([404, 202, 204].includes(status)) {
    return null;
  }

  if (response.ok) {
    const data = await response.json();
    return data;
  }

  throw new Error(response.toString());
}

export const GlyphsProvider = ({ fontAtlasUrl, fontConfigUrl, children }: PropsWithChildren<GlyphsProviderProps>) => {
  const glyphAtlas = useTexture(fontAtlasUrl, (tex: Texture) => {
    tex.generateMipmaps = false
    tex.magFilter = LinearFilter
    tex.minFilter = LinearFilter
    tex.flipY = true
  })
  
  const [config, setConfig] = useState<GlyphConfig | null>(null)

  useEffect(() => {
    get(`${fontConfigUrl}`).then(response => {
      setConfig(createConfig(response))
    }).catch(err => console.error(err))
  }, [fontConfigUrl])

  const context = useMemo<GlyphsContextProps | null>(() => {
    if (!config) return null
    return {
      glyphAtlas,
      encodeText: (text: string ) => config.encodeText(text),
      encodeTextTexture: (textSegments: string[] | string) => config.encodeTextTexture(textSegments),
      glyphData: config.glyphData,
      glyphsCount: config.glyphsCount,
      dispose: config.dispose
    }
  }, [config, glyphAtlas])

  useEffect(() => {
    return () => {
      if (context) {
        context.glyphAtlas.dispose()
        context.dispose()
      }
    }
  }, [context])

  return (
    <GlyphsContext.Provider value={context}>
      { children }
    </GlyphsContext.Provider>
  )
}