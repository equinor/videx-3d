export function negate(numArray: number[]) {
  return numArray.map(v => -v)
}

export function multiply(numArray: number[], factor: number) {
  return numArray.map(v => v * factor)
}

