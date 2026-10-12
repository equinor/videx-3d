import { proxy, releaseProxy, transfer } from 'comlink';

/**
 * A callback a generator calls with intermediate results before it returns. Pass
 * it as an argument to the generator; across a worker boundary it is proxied (see
 * {@link wireGeneratorArgs}), so each call is asynchronous and fire-and-forget.
 *
 * The generator owns its lifetime: send with {@link emitPartial}, and call
 * {@link releasePartialSink} when done — in a `finally`, so a failed or superseded
 * run releases it too.
 *
 * @group Generators
 */
export type PartialSink<T> = (packet: T) => unknown;

/**
 * Prepare generator arguments for a call across a worker boundary: a function
 * argument is wrapped with comlink's `proxy`, so the generator can call back into
 * the caller's thread. A local registry takes the arguments as they are.
 *
 * @group Generators
 */
export function wireGeneratorArgs(args: unknown[], remote: boolean): unknown[] {
  return remote
    ? args.map(arg => (typeof arg === 'function' ? proxy(arg) : arg))
    : args;
}

/**
 * Send a partial result through `sink`, moving `transferables` rather than
 * copying them when it crosses a worker boundary (locally they are untouched). A
 * missing sink is a no-op. An error in the caller's handler is logged, never
 * thrown into the generator.
 *
 * ⚠️ Transferred buffers are DETACHED on the generator's side, so nothing the
 * generator still uses may be among them.
 *
 * @group Generators
 */
export function emitPartial<T>(
  sink: PartialSink<T> | undefined,
  packet: T,
  transferables: Transferable[] = [],
): void {
  if (!sink) return;
  const report = (error: unknown) =>
    console.error('[emitPartial] partial result handler failed:', error);
  try {
    const result = sink(
      transferables.length > 0 ? transfer(packet, transferables) : packet,
    );
    if (result instanceof Promise) result.catch(report);
  } catch (error) {
    report(error);
  }
}

/**
 * Release a sink the generator is done with. ⚠️ Required across a worker
 * boundary: a proxied callback keeps a `MessagePort` open until it is released. A
 * local function is left alone, so this is safe to call either way.
 *
 * @group Generators
 */
export function releasePartialSink(sink: PartialSink<never> | undefined): void {
  const release = (sink as { [releaseProxy]?: () => void } | undefined)?.[
    releaseProxy
  ];
  if (typeof release === 'function') release();
}
