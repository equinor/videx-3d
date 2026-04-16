export function calculateHashValue(str?: string) {
  let hash: number = 0,
    i: number,
    chr: number;

  if (!str || str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

export function titleCase(str: string) {
  return str.replace(/(^|\s)\S/g, t => t.toUpperCase());
}
