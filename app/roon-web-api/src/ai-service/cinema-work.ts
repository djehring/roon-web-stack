/** Run independent Cinema work with a fixed concurrency limit and stable order. */
export async function mapCinemaWork<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RangeError("Cinema concurrency must be a positive integer.");
  const results = new Array<R>(items.length);
  let next = 0;
  const failures: unknown[] = [];
  const worker = async () => {
    while (!failures.length && next < items.length) {
      const index = next++;
      try {
        results[index] = await work(items[index], index);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  // Drain work already started before reporting failure, so it cannot publish
  // stale progress or checkpoints after a retry has begun.
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, worker));
  if (failures.length) throw failures[0];
  return results;
}
