import { Simulation, type Metrics, type SimConfig, type SimMode } from "./engine";

export interface BatchStats {
  mode: SimMode;
  runs: number;
  perTarget: { index: number; avg: number | null; sd: number; foundRate: number }[];
  avgCompletion: number;
  sdCompletion: number;
  avgDistance: number;
  avgCongestion: number;
  completionRate: number;
}

export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
export const stdev = (v: number[]) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
};

export function summarize(mode: SimMode, results: Metrics[], targets: number): BatchStats {
  const completions = results.map((r) => r.elapsed);
  const perTarget = Array.from({ length: targets }, (_, i) => {
    const times = results
      .map((r) => r.targetTimes[i])
      .filter((t): t is number => t != null);
    return {
      index: i + 1,
      avg: times.length ? mean(times) : null,
      sd: stdev(times),
      foundRate: results.length ? times.length / results.length : 0,
    };
  });
  return {
    mode,
    runs: results.length,
    perTarget,
    avgCompletion: mean(completions),
    sdCompletion: stdev(completions),
    avgDistance: mean(results.map((r) => r.totalDistance)),
    avgCongestion: mean(results.map((r) => r.congestionTime)),
    completionRate: results.length
      ? results.filter((r) => r.done).length / results.length
      : 0,
  };
}

/** Runs simulations headless in small async chunks so the UI stays responsive. */
export async function runBatch(
  base: SimConfig,
  runs: number,
  maxTime: number,
  onProgress: (done: number, total: number) => void,
): Promise<Metrics[]> {
  const out: Metrics[] = [];
  for (let i = 0; i < runs; i++) {
    const sim = new Simulation({ ...base, runSeed: (base.runSeed + i * 7919) >>> 0 });
    out.push(sim.runHeadless(maxTime));
    onProgress(i + 1, runs);
    await new Promise((res) => setTimeout(res, 0));
  }
  return out;
}