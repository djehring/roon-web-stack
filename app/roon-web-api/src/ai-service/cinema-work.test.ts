import { mapCinemaWork } from "./cinema-work";

afterEach(() => jest.useRealTimers());

test("independent work overlaps within its limit and keeps input order", async () => {
  jest.useFakeTimers();
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  const result = mapCinemaWork([100, 10, 20, 30], 2, async (ms, index) => {
    started.push(index);
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, ms));
    active--;
    return index;
  });
  expect(started).toEqual([0, 1]);
  await jest.advanceTimersByTimeAsync(10);
  expect(started).toEqual([0, 1, 2]);
  await jest.advanceTimersByTimeAsync(50);
  expect(started).toEqual([0, 1, 2, 3]);
  await jest.advanceTimersByTimeAsync(40);
  await expect(result).resolves.toEqual([0, 1, 2, 3]);
  expect(peak).toBe(2);
  expect(active).toBe(0);
});

test("failure stops queued work and drains active work before allowing a retry", async () => {
  jest.useFakeTimers();
  const started: number[] = [];
  let finished = false;
  let reported = false;
  const result = mapCinemaWork([10, 30, 50], 2, async (ms, index) => {
    started.push(index);
    await new Promise((resolve) => setTimeout(resolve, ms));
    if (!index) throw new Error("research failed");
    finished = true;
  }).catch((error: unknown) => {
    reported = true;
    return error;
  });
  await jest.advanceTimersByTimeAsync(10);
  expect(reported).toBe(false);
  await jest.advanceTimersByTimeAsync(20);
  expect(started).toEqual([0, 1]);
  expect(finished).toBe(true);
  await expect(result).resolves.toEqual(new Error("research failed"));
});

test("empty work finishes and an invalid limit cannot silently skip work", async () => {
  await expect(mapCinemaWork([], 2, () => Promise.resolve())).resolves.toEqual([]);
  await expect(mapCinemaWork([1], 0, () => Promise.resolve())).rejects.toThrow(RangeError);
});
