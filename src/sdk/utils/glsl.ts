export function arrayToMacro(type: string, array: number[]) {
  return `${type}[${array.length}](${array.join(',')})`
}