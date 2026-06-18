import {
  Color,
  MeshStandardMaterial,
  ShaderMaterial,
  Vector2,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from 'three';
import {
  attachOitVariants,
  COMMON_OIT_SYNC_PROPS,
  isOitCapable,
  makeOitCompatible,
  OitPass,
} from '../src/rendering/oit-material';

const ALL_PASSES: OitPass[] = ['depthMin', 'accum', 'front', 'occlusion'];

/**
 * Minimal stand-in for the shader object Three passes to `onBeforeCompile`. The OIT
 * injection only reads/writes `uniforms`, `vertexShader` and `fragmentShader`, so the
 * rest of `WebGLProgramParametersWithUniforms` is irrelevant here.
 */
type FakeShader = {
  uniforms: Record<string, unknown>;
  vertexShader: string;
  fragmentShader: string;
};

function makeShader(fragmentShader: string, vertexShader: string): FakeShader {
  return { uniforms: {}, vertexShader, fragmentShader };
}

/** Invoke a material's (patched) `onBeforeCompile` with a fake shader and return it. */
function runOnBeforeCompile(
  material: {
    onBeforeCompile: (
      s: WebGLProgramParametersWithUniforms,
      r: WebGLRenderer,
    ) => void;
  },
  shader: FakeShader,
): FakeShader {
  material.onBeforeCompile(
    shader as unknown as WebGLProgramParametersWithUniforms,
    {} as unknown as WebGLRenderer,
  );
  return shader;
}

const FRAG_NO_VIEWPOS = `precision highp float;
void main() {
  gl_FragColor = vec4(1.0);
}
`;

const FRAG_WITH_VIEWPOS = `precision highp float;
varying vec3 vViewPosition;
void main() {
  float d = vViewPosition.z;
  gl_FragColor = vec4(d);
}
`;

const VERT = `void main() {
  gl_Position = vec4(position, 1.0);
}
`;

describe('oit-material', () => {
  describe('isOitCapable', () => {
    test('returns false for null/undefined/plain materials', () => {
      expect(isOitCapable(null)).toBe(false);
      expect(isOitCapable(undefined)).toBe(false);
      expect(isOitCapable(new MeshStandardMaterial())).toBe(false);
      expect(isOitCapable(new ShaderMaterial())).toBe(false);
    });

    test('returns true after makeOitCompatible / attachOitVariants', () => {
      const a = makeOitCompatible(new MeshStandardMaterial());
      const b = attachOitVariants(new ShaderMaterial());
      expect(isOitCapable(a)).toBe(true);
      expect(isOitCapable(b)).toBe(true);
    });
  });

  describe('shader injection (makeOitCompatible.onBeforeCompile)', () => {
    test('injects the OIT chunk and an oitProcess call guarded by USE_OIT', () => {
      const material = makeOitCompatible(new MeshStandardMaterial());
      const shader = runOnBeforeCompile(
        material,
        makeShader(FRAG_NO_VIEWPOS, VERT),
      );

      // The shared chunk (which declares oitProcess) is included...
      expect(shader.fragmentShader).toContain('vec4 oitProcess(vec4 color)');
      // ...and the final color is routed through it before main ends.
      expect(shader.fragmentShader).toContain(
        'gl_FragColor = oitProcess(gl_FragColor);',
      );
      // All injected code is behind USE_OIT so the base program is unchanged.
      expect(shader.fragmentShader).toContain('#ifdef USE_OIT');
      // The original body is preserved.
      expect(shader.fragmentShader).toContain('gl_FragColor = vec4(1.0);');
    });

    test('auto-injects vViewPosition into both stages when the fragment lacks it', () => {
      const material = makeOitCompatible(new MeshStandardMaterial());
      const shader = runOnBeforeCompile(
        material,
        makeShader(FRAG_NO_VIEWPOS, VERT),
      );

      expect(shader.fragmentShader).toContain('varying vec3 vViewPosition;');
      expect(shader.vertexShader).toContain('varying vec3 vViewPosition;');
      expect(shader.vertexShader).toContain(
        'vViewPosition = -(modelViewMatrix * vec4(position, 1.0)).xyz;',
      );
    });

    test('does not patch the vertex shader when the fragment already has vViewPosition', () => {
      const material = makeOitCompatible(new MeshStandardMaterial());
      const shader = runOnBeforeCompile(
        material,
        makeShader(FRAG_WITH_VIEWPOS, VERT),
      );

      // Vertex shader untouched (no auto-injection needed).
      expect(shader.vertexShader).toBe(VERT);
      // Fragment is still wired for OIT.
      expect(shader.fragmentShader).toContain(
        'gl_FragColor = oitProcess(gl_FragColor);',
      );
      // The single existing declaration is not duplicated.
      const matches = shader.fragmentShader.match(/varying vec3 vViewPosition;/g);
      expect(matches?.length).toBe(1);
    });

    test('binds the OIT uniforms into the program', () => {
      const material = makeOitCompatible(new MeshStandardMaterial());
      const shader = runOnBeforeCompile(
        material,
        makeShader(FRAG_NO_VIEWPOS, VERT),
      );

      expect(shader.uniforms.oitDepthFar).toBeDefined();
      expect(shader.uniforms.oitScreenSize).toBeDefined();
      expect(shader.uniforms.oitMinDepthTexture).toBeDefined();
      expect(shader.uniforms.oitSkipFront).toBeDefined();
      expect(shader.uniforms.oitOcclusionThreshold).toBeDefined();
    });

    test('preserves a pre-existing onBeforeCompile (chaining)', () => {
      const material = new MeshStandardMaterial();
      let called = false;
      material.onBeforeCompile = () => {
        called = true;
      };
      makeOitCompatible(material);
      runOnBeforeCompile(material, makeShader(FRAG_NO_VIEWPOS, VERT));
      expect(called).toBe(true);
    });
  });

  describe('getOitUniforms', () => {
    test('attachOitVariants adds the OIT uniforms to the ShaderMaterial', () => {
      const material = attachOitVariants(
        new ShaderMaterial({ uniforms: { opacity: { value: 1 } } }),
      );
      const u = material.getOitUniforms();
      expect(material.uniforms.oitDepthFar).toBe(u.oitDepthFar);
      expect(u.oitScreenSize.value).toBeInstanceOf(Vector2);
      expect(u.oitSkipFront.value).toBe(0);
    });
  });

  describe('getOitVariants', () => {
    test('builds one variant per pass with the right defines', () => {
      const material = makeOitCompatible(new MeshStandardMaterial());
      const variants = material.getOitVariants();

      for (const pass of ALL_PASSES) {
        const defines = (variants[pass] as { defines?: Record<string, unknown> })
          .defines;
        expect(defines?.USE_OIT).toBe('');
      }
      expect(
        (variants.depthMin as { defines?: Record<string, unknown> }).defines
          ?.OIT_DEPTH_PASS,
      ).toBe('');
      expect(
        (variants.front as { defines?: Record<string, unknown> }).defines
          ?.OIT_FRONT_PASS,
      ).toBe('');
      expect(
        (variants.occlusion as { defines?: Record<string, unknown> }).defines
          ?.OIT_OCCLUSION_PASS,
      ).toBe('');
      // accum carries no extra pass define beyond USE_OIT.
      const accumDefines = (
        variants.accum as { defines?: Record<string, unknown> }
      ).defines;
      expect(accumDefines?.OIT_DEPTH_PASS).toBeUndefined();
      expect(accumDefines?.OIT_FRONT_PASS).toBeUndefined();
    });

    test('configures blend/depth state per pass', () => {
      const material = makeOitCompatible(new MeshStandardMaterial());
      const v = material.getOitVariants();

      // Transparent passes never write depth.
      for (const pass of ['depthMin', 'accum', 'front'] as OitPass[]) {
        expect(v[pass].transparent).toBe(true);
        expect(v[pass].depthWrite).toBe(false);
        expect(v[pass].depthTest).toBe(true);
      }
      // Occlusion stamp writes depth only, no colour.
      expect(v.occlusion.transparent).toBe(false);
      expect(v.occlusion.depthWrite).toBe(true);
      expect(v.occlusion.colorWrite).toBe(false);
    });

    test('ShaderMaterial variants share the base uniforms object', () => {
      const base = attachOitVariants(
        new ShaderMaterial({ uniforms: { opacity: { value: 1 } } }),
      );
      const v = base.getOitVariants();
      for (const pass of ALL_PASSES) {
        expect((v[pass] as ShaderMaterial).uniforms).toBe(base.uniforms);
      }
    });

    test('re-syncs variant programs when the base program signature changes', () => {
      const base = attachOitVariants(new ShaderMaterial());
      const v = base.getOitVariants();
      expect((v.front as ShaderMaterial).wireframe).toBe(false);

      // Toggling a program-affecting field changes the signature; the next call
      // re-syncs the cached variants in place (same object references).
      base.wireframe = true;
      const v2 = base.getOitVariants();
      expect(v2.front).toBe(v.front);
      expect((v2.front as ShaderMaterial).wireframe).toBe(true);
    });
  });

  describe('syncProperties (cloned built-in variants)', () => {
    test('keeps opacity and value properties live on cloned variants', () => {
      const material = makeOitCompatible(
        new MeshStandardMaterial({
          color: 0xff0000,
          transparent: true,
          opacity: 1,
        }),
        { syncProperties: [...COMMON_OIT_SYNC_PROPS] },
      );

      const variants = material.getOitVariants();
      const front = variants.front as MeshStandardMaterial;

      // Mutate the base material's live appearance...
      material.color.set(0x00ff00);
      material.opacity = 0.5;
      material.metalness = 0.3;

      // ...and re-sync (the pass calls getOitVariants every frame).
      material.getOitVariants();

      // opacity is always synced; numeric props are assigned.
      expect(front.opacity).toBe(0.5);
      expect(front.metalness).toBeCloseTo(0.3);

      // color (a Color object) is copied IN PLACE: equal value, distinct instance.
      expect(front.color.getHex()).toBe(0x00ff00);
      expect(front.color).not.toBe(material.color);
      expect(front.color).toBeInstanceOf(Color);
    });

    test('does not sync value props for ShaderMaterial variants (already live)', () => {
      // ShaderMaterials share uniforms, so syncProperties is a no-op for them; this
      // just verifies it does not throw and variants still build.
      const base = attachOitVariants(new ShaderMaterial(), {
        syncProperties: [...COMMON_OIT_SYNC_PROPS],
      });
      expect(() => base.getOitVariants()).not.toThrow();
    });
  });
});
