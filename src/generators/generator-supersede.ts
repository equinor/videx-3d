/**
 * Identifies one invocation of a generator: which caller asked, and where the
 * request sits in that caller's sequence.
 * @expand
 */
export type GeneratorRun = {
  /** stable identity of the caller (a component instance, not the inputs) */
  key: string;
  /** ordinal of this request from that caller — higher is newer */
  token: number;
};

const claimed = new Map<string, number>();

/**
 * Latest-wins guard for a generator a component re-invokes as its inputs change.
 *
 * The main thread already discards a superseded result, but nothing stops the
 * WORK: a slider drag can leave several full builds running in the worker at once,
 * each holding its inputs, and on a field-sized column that is tens of seconds of
 * CPU per abandoned build. This lets a generator notice at its own await points
 * that a newer request has arrived and give up.
 *
 * @returns a predicate that is true once a newer run has claimed the same key —
 *   already true when this run was superseded before it started
 *
 * @group Generators
 */
export function claimGeneratorRun(
  run: GeneratorRun | undefined,
): () => boolean {
  if (!run) return () => false;
  const { key, token } = run;
  const current = claimed.get(key);
  if (current !== undefined && current >= token) return () => true;
  claimed.set(key, token);
  return () => (claimed.get(key) ?? token) > token;
}

/** Forget every claim (teardown / tests). */
export function clearGeneratorClaims(): void {
  claimed.clear();
}
