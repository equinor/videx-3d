export function toSegments<T>(
  intervals: T[],
  start: (item: T) => number,
  end: (item: T) => number,
) {
  if (intervals.length === 0) return [];

  intervals.sort((a, b) => start(a) - start(b));
  const segments = [];
  let segment = { start: start(intervals[0]), end: end(intervals[0]) };
  for (let i = 1; i < intervals.length; i += 1) {
    if (start(intervals[i]) === segment.end) {
      segment.end = end(intervals[i]);
    } else {
      segments.push(segment);
      segment = { start: start(intervals[i]), end: end(intervals[i]) };
    }
  }
  segments.push(segment);
  return segments;
}
