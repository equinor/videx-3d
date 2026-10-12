import { expose, proxyMarker, releaseProxy, wrap } from 'comlink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeneratorRegistry } from '../src/sdk/data/GeneratorRegistry';
import {
  emitPartial,
  PartialSink,
  releasePartialSink,
  wireGeneratorArgs,
} from '../src/sdk/data/partial-results';
import { ReadonlyStore } from '../src/sdk/data/Store';

const store: ReadonlyStore = {
  get: async () => null,
  all: async () => [],
  query: async () => [],
} as unknown as ReadonlyStore;

type Packet = { i: number; data: Float32Array };

/** Emits `n` packets, each moving its own buffer, then returns. */
const streaming = (sent: Float32Array[]) =>
  async function (this: ReadonlyStore, n: number, sink?: PartialSink<Packet>) {
    try {
      for (let i = 0; i < n; i++) {
        const data = new Float32Array([i]);
        sent.push(data);
        emitPartial(sink, { i, data }, [data.buffer]);
      }
      return 'done';
    } finally {
      releasePartialSink(sink);
    }
  };

const ports: MessagePort[] = [];
const channel = () => {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  return { port1, port2 };
};

afterEach(() => {
  ports.splice(0).forEach(port => port.close());
  vi.restoreAllMocks();
});

describe('partial results', () => {
  it('reach a local caller in order, before the generator returns', async () => {
    const registry = new GeneratorRegistry({}, store);
    const sent: Float32Array[] = [];
    registry.add('gen', streaming(sent));
    const received: number[] = [];
    let returned = false;
    const result = await registry.invoke<string>(
      'gen',
      ...wireGeneratorArgs(
        [3, (p: Packet) => received.push(returned ? -1 : p.i)],
        false,
      ),
    );
    returned = true;
    expect(result).toBe('done');
    expect(received).toEqual([0, 1, 2]);
    // Nothing crossed a thread, so nothing was detached.
    expect(sent.every(a => a.length === 1)).toBe(true);
  });

  it('cross a worker boundary with their buffers transferred', async () => {
    const registry = new GeneratorRegistry({}, store);
    const sent: Float32Array[] = [];
    registry.add('gen', streaming(sent));
    const { port1, port2 } = channel();
    expose(registry, port1);
    const remote = wrap<GeneratorRegistry>(port2);

    const received: number[] = [];
    const result = await remote.invoke(
      'gen',
      ...wireGeneratorArgs([3, (p: Packet) => received.push(p.data[0])], true),
    );
    expect(result).toBe('done');
    await vi.waitFor(() => expect(received).toEqual([0, 1, 2]));
    expect(sent.every(a => a.length === 0)).toBe(true);
    remote[releaseProxy]();
  });

  it('proxies only function arguments, and only for a remote registry', () => {
    const sink = () => undefined;
    const args = [1, 'a', sink];
    expect(wireGeneratorArgs(args, false)).toBe(args);
    const wired = wireGeneratorArgs(args, true);
    expect(wired.slice(0, 2)).toEqual([1, 'a']);
    expect((wired[2] as { [proxyMarker]?: boolean })[proxyMarker]).toBe(true);
  });

  it('releases a proxied sink and leaves a local one alone', () => {
    const { port1, port2 } = channel();
    expose((x: number) => x, port1);
    const remote = wrap<(x: number) => number>(port2);
    releasePartialSink(remote as unknown as PartialSink<number>);
    expect(() => remote(1)).toThrow(/released/);

    const local = vi.fn<(packet: number) => void>();
    releasePartialSink(local);
    emitPartial(local, 1);
    expect(local).toHaveBeenCalledWith(1);
  });

  it('logs a failing handler instead of failing the generator', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitPartial(() => {
      throw new Error('handler');
    }, 1);
    emitPartial(undefined, 1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
