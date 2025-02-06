import pLimit from 'p-limit'
import pQueue from 'p-queue'

const l = pLimit(50)
const q = new pQueue({ concurrency: 20 })


/**
 * limit/throttle the number of async calls
 */
export const limit = <T>(asyncFunc: () => Promise<T>) => l(asyncFunc)

/**
 * queue async calls using a priority queue
 */
export const queue = <T>(asyncFunc: () => Promise<T>, priority = 0) => q.add(asyncFunc, { priority })