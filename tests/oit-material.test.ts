import {
  Color,
  MeshStandardMaterial,
  RawShaderMaterial,
  ShaderMaterial,
  Vector2,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from 'three';
import { readFileSync } from 'fs';
import {
  attachOitVariants,
  COMMON_OIT_SYNC_PROPS,
  isOitCapable,
  makeOitCompatible,
  OitPass,
} from '../src/rendering/oit-material';

const ALL_PASSES: OitPass[] = ['depthMin', 'accum', 'front', 'occlusion'];

/**
 * The OIT uniform keys, read from the `OitUniforms` type declaration.
 *
 * ⚠️ Deliberately NOT taken from `getOitUniforms()`: that object is built by one of
 * the very binders these guards exist to check, so a key missing there would drop out
 * of the key set too and every check below would pass vacuously. The type is the one
 * declaration all five hand-written copies have to agree with.
 */
const OIT_UNIFORM_KEYS = (() => {
  const source = readFileSync('src/rendering/oit-material.ts', 'utf-8');
  const block = /export type OitUniforms = \{([\s\S]*?)\n\};/.exec(source);
  if (!block)
    throw new Error('could not locate the OitUniforms type declaration');
  return [...block[1].matchAll(/^\s*(\w+)\s*:/gm)].map(m => m[1]);
})();

/** Every key present, and every one the SAME object the material hands out. */
function unboundKeys(
  bound: Record<string, unknown>,
  own: Record<string, unknown>,
): string[] {
  return OIT_UNIFORM_KEYS.filter(
    key => own[key] === undefined || bound[key] !== own[key],
  );
}

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

/** `void main(void)` is legal GLSL, and the signature scan has to accept it. */
const FRAG_MAIN_VOID = `precision highp float;
void main(void) {
  gl_FragColor = vec4(1.0);
}
`;

/**
 * Both traps a naive text scan falls into: a decoy `main()` inside a line comment,
 * and a stray closing brace inside a block comment.
 */
const FRAG_COMMENT_TRAPS = `precision highp float;
// decoy: void main() { }
void main() {
  /* stray brace } */
  gl_FragColor = vec4(1.0);
}
`;

const VERT = `void main() {
  gl_Position = vec4(position, 1.0);
}
`;

/**
 * A stock-shaped vertex shader whose position is REBUILT in `<begin_vertex>` from
 * attributes other than `position`, exactly as a chunk cap does (it ships `xz` + `y`
 * and no `position` at all).
 */
const VERT_PROJECT = `attribute vec2 xz;
attribute float y;
void main() {
  vec3 transformed = position + vec3(xz.x, y, xz.y);
  #include <project_vertex>
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

    test('takes vViewPosition from mvPosition when <project_vertex> is present', () => {
      // Regression: the injection used to read the raw `position` attribute, which is
      // not the rasterised vertex once <begin_vertex> rebuilds it. A chunk cap ships
      // `xz` + `y` and no `position`, so every fragment reported the model origin's
      // depth — a constant that hijacked the min-depth buffer and the front layer.
      const material = makeOitCompatible(new MeshStandardMaterial());
      const shader = runOnBeforeCompile(
        material,
        makeShader(FRAG_NO_VIEWPOS, VERT_PROJECT),
      );

      expect(shader.vertexShader).toContain('vViewPosition = -mvPosition.xyz;');
      expect(shader.vertexShader).not.toContain('vec4(position, 1.0)).xyz;');
      // mvPosition only exists after the include, so the write has to follow it.
      expect(
        shader.vertexShader.indexOf('vViewPosition = -mvPosition.xyz;'),
      ).toBeGreaterThan(
        shader.vertexShader.indexOf('#include <project_vertex>'),
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
      const matches = shader.fragmentShader.match(
        /varying vec3 vViewPosition;/g,
      );
      expect(matches?.length).toBe(1);
    });

    test('does not double-declare vViewPosition when the fragment gets it from an #include', () => {
      // Regression: lit built-ins (Lambert/Phong/Toon) declare vViewPosition in the
      // fragment via `#include <lights_*_pars_fragment>`, not literally. A raw text
      // scan misses it; the include must be resolved before deciding to inject, or
      // the varying is redefined (GLSL "vViewPosition : redefinition").
      const material = makeOitCompatible(new MeshStandardMaterial());
      const fragWithInclude = `precision highp float;
#include <lights_lambert_pars_fragment>
void main() {
  gl_FragColor = vec4(vViewPosition.z);
}
`;
      const vertWithViewPos = `varying vec3 vViewPosition;
void main() {
  vViewPosition = vec3(0.0);
  gl_Position = vec4(position, 1.0);
}
`;
      const shader = runOnBeforeCompile(
        material,
        makeShader(fragWithInclude, vertWithViewPos),
      );

      // No injected declaration in either stage (the include / literal provide it).
      expect(shader.fragmentShader).not.toContain(
        'varying vec3 vViewPosition;',
      );
      expect(shader.vertexShader).toBe(vertWithViewPos);
      // Still wired for OIT.
      expect(shader.fragmentShader).toContain(
        'gl_FragColor = oitProcess(gl_FragColor);',
      );
    });

    test('binds every OIT uniform into the program', () => {
      const material = makeOitCompatible(new MeshStandardMaterial());
      const shader = runOnBeforeCompile(
        material,
        makeShader(FRAG_NO_VIEWPOS, VERT),
      );

      // Identity, not just presence: binding a fresh uniform object instead of the
      // material's own would compile fine and then never see a value from the pass.
      const own = material.getOitUniforms() as unknown as Record<
        string,
        unknown
      >;
      expect(unboundKeys(shader.uniforms, own)).toEqual([]);
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

  describe('injection failures (no silent no-op)', () => {
    test('accepts a `void main(void)` signature', () => {
      const material = makeOitCompatible(new MeshStandardMaterial());
      const shader = runOnBeforeCompile(
        material,
        makeShader(FRAG_MAIN_VOID, VERT),
      );

      expect(shader.fragmentShader).toContain(
        'gl_FragColor = oitProcess(gl_FragColor);',
      );
    });

    test('ignores a decoy main() and a stray brace inside comments', () => {
      const material = makeOitCompatible(new MeshStandardMaterial());
      const shader = runOnBeforeCompile(
        material,
        makeShader(FRAG_COMMENT_TRAPS, VERT),
      );

      // The call belongs at the END of the real main, so it has to follow the body.
      // A brace counted inside the block comment would close main early and put it
      // before the assignment instead.
      expect(
        shader.fragmentShader.indexOf(
          'gl_FragColor = oitProcess(gl_FragColor);',
        ),
      ).toBeGreaterThan(
        shader.fragmentShader.indexOf('gl_FragColor = vec4(1.0);'),
      );
    });

    test('throws, naming the stage, when a shader has no main()', () => {
      // Registration happens regardless, so a silent no-op would leave the material
      // in the OIT lists with no oitProcess call in it.
      const material = makeOitCompatible(new MeshStandardMaterial());
      expect(() =>
        runOnBeforeCompile(
          material,
          makeShader('precision highp float;\n', VERT),
        ),
      ).toThrow(/fragment shader of MeshStandardMaterial/);
    });

    test('throws at the call site when a ShaderMaterial has no main()', () => {
      expect(() =>
        makeOitCompatible(
          new ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: 'precision highp float;\n',
          }),
        ),
      ).toThrow(/fragment shader of ShaderMaterial/);
    });

    test('rejects RawShaderMaterial rather than patching dead code', () => {
      expect(() => makeOitCompatible(new RawShaderMaterial())).toThrow(
        /RawShaderMaterial is not supported/,
      );
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

    /**
     * ⚠️ The uniform list is written out by hand in five places — the type, the
     * factory, both wiring paths, and the pass that pushes values in — and every one
     * of them fails SILENTLY when it drifts: the shader compiles, the uniform keeps
     * its initial value, and the feature it controls just never responds. So each of
     * these drives itself off the live key set rather than restating it.
     */
    test.each([
      [
        'attachOitVariants',
        () =>
          attachOitVariants(
            new ShaderMaterial({ uniforms: {} }),
          ) as unknown as {
            uniforms: Record<string, unknown>;
            getOitUniforms(): Record<string, unknown>;
          },
      ],
      [
        'makeOitCompatible (ShaderMaterial)',
        () =>
          makeOitCompatible(
            new ShaderMaterial({
              vertexShader: VERT,
              fragmentShader: FRAG_NO_VIEWPOS,
            }),
          ) as unknown as {
            uniforms: Record<string, unknown>;
            getOitUniforms(): Record<string, unknown>;
          },
      ],
    ])('%s puts every OIT uniform on material.uniforms', (_name, build) => {
      const material = build();
      expect(unboundKeys(material.uniforms, material.getOitUniforms())).toEqual(
        [],
      );
    });

    test('the shared GLSL chunk declares every OIT uniform', () => {
      const glsl = readFileSync(
        'src/sdk/materials/shaderLib/oit.glsl',
        'utf-8',
      );
      const declared = new Set(
        [...glsl.matchAll(/uniform\s+\w+\s+(oit\w+)\s*;/g)].map(m => m[1]),
      );
      // Both directions: a uniform the CPU sets but the shader never declares is dead,
      // and one the shader declares but no key covers is never written.
      expect([...declared].sort()).toEqual([...OIT_UNIFORM_KEYS].sort());
    });

    test('OITRenderPass writes a value for every OIT uniform', () => {
      const source = readFileSync(
        'src/rendering/passes/OITRenderPass.ts',
        'utf-8',
      );
      const missing = OIT_UNIFORM_KEYS.filter(
        key => !source.includes(`u.${key}.value`),
      );
      expect(missing).toEqual([]);
    });
  });

  describe('getOitVariants', () => {
    test('builds one variant per pass with the right defines', () => {
      const material = makeOitCompatible(new MeshStandardMaterial());
      const variants = material.getOitVariants();

      for (const pass of ALL_PASSES) {
        const defines = (
          variants[pass] as { defines?: Record<string, unknown> }
        ).defines;
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
