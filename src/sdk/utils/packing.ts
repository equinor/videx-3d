const unpackScale = 255 / 256;
const unpackFactors = new Float32Array([
  unpackScale,
  unpackScale / 256,
  unpackScale / 256 ** 2,
  unpackScale / 256 ** 3,
]);

export function unpackRGBAToDepth(r: number, g: number, b: number, a: number) {
  return (
    (r / 255) * unpackFactors[0] +
    (g / 255) * unpackFactors[1] +
    (b / 255) * unpackFactors[2] +
    (a / 255) * unpackFactors[3]
  );
}
