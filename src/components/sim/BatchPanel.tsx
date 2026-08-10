import { useState } from "react";
import { FileDown, Play, Save } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { runBatch, summarize, type BatchStats } from "@/sim/batch";
import { Simulation, type SimConfig } from "@/sim/engine";
import { MAP_SIZE_MAX, MAP_SIZE_MIN, MAP_SIZE_STEP, clampMapSize } from "@/sim/map";
import { randomSeed } from "@/sim/rng";

interface Props {
  config: SimConfig;
  onArchive: (stats: BatchStats[], runs: number) => void;
}

const randomMapSize = () =>
  clampMapSize(
    MAP_SIZE_MIN +
      Math.floor(Math.random() * ((MAP_SIZE_MAX - MAP_SIZE_MIN) / MAP_SIZE_STEP + 1)) *
        MAP_SIZE_STEP,
  );

export function BatchPanel({ config, onArchive }: Props) {
  const [runs, setRuns] = useState(10);
  const [maxTime, setMaxTime] = useState(300);
  const [noLimit, setNoLimit] = useState(false);
  const [compare, setCompare] = useState(true);
  const [rotateMap, setRotateMap] = useState(false);
  const [randomSize, setRandomSize] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stats, setStats] = useState<BatchStats[]>([]);

  const handlePDF = () => {
    const style = document.createElement("style");
    style.id = "__bpr";
    style.textContent = `@media print {
      body > * { display: none !important; }
      #batch-results { display: block !important; position: static !important; color: #000 !important; background: #fff !important; padding: 16px; }
      #batch-results * { color: #000 !important; fill: currentColor; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      #batch-results .panel-frame { border: 1px solid #ccc !important; background: #f9f9f9 !important; margin-bottom: 16px; page-break-inside: avoid; }
      #batch-results .label-hud { font-weight: bold; margin-bottom: 8px; }
      #batch-results .text-hud { color: #000 !important; }
      #batch-results .text-muted-foreground { color: #555 !important; }
      #batch-results svg text { fill: #000 !important; }
    }`;
    document.head.appendChild(style);
    window.print();
    window.addEventListener("afterprint", () => document.getElementById("__bpr")?.remove(), { once: true });
  };

  const execute = async () => {
    if (rotateMap) {
      // "Change mode every map": swarm + centralized on the same map, then new random map
      const timeLimit = noLimit ? Infinity : maxTime;
      const total = runs * 2;
      let completed = 0;
      setProgress({ done: 0, total });
      const swarmResults: ReturnType<InstanceType<typeof Simulation>["runHeadless"]>[] = [];
      const centralResults: ReturnType<InstanceType<typeof Simulation>["runHeadless"]>[] = [];
      let currentMapSeed = config.mapSeed;
      let currentMapSize = randomSize ? randomMapSize() : config.mapSize;
      for (let i = 0; i < runs; i++) {
        const runSeed = (config.runSeed + i * 7919) >>> 0;
        const swarmSim = new Simulation({ ...config, mode: "swarm", mapSeed: currentMapSeed, mapSize: currentMapSize, runSeed });
        swarmResults.push(swarmSim.runHeadless(timeLimit));
        setProgress({ done: ++completed, total });
        await new Promise((res) => setTimeout(res, 0));
        const centralSim = new Simulation({ ...config, mode: "central", mapSeed: currentMapSeed, mapSize: currentMapSize, runSeed });
        centralResults.push(centralSim.runHeadless(timeLimit));
        setProgress({ done: ++completed, total });
        await new Promise((res) => setTimeout(res, 0));
        currentMapSeed = randomSeed();
        if (randomSize) currentMapSize = randomMapSize();
      }
      setStats([
        summarize("swarm", swarmResults, config.targets),
        summarize("central", centralResults, config.targets),
      ]);
      setProgress(null);
      return;
    }

    const modes = compare ? (["swarm", "central"] as const) : ([config.mode] as const);
    const total = runs * modes.length;
    let completed = 0;
    setProgress({ done: 0, total });
    const collected: BatchStats[] = [];
    for (const mode of modes) {
      const results = await runBatch({ ...config, mode }, runs, noLimit ? Infinity : maxTime, () => {
        completed++;
        setProgress({ done: completed, total });
      });
      collected.push(summarize(mode, results, config.targets));
    }
    setStats(collected);
    setProgress(null);
  };

  const perTargetData = stats.length
    ? (stats[0] as BatchStats).perTarget.map((row, i) => ({
        name: `T${row.index}`,
        swarm:
          stats.find((s) => s.mode === "swarm")?.perTarget[i]?.avg ?? 0,
        central: stats.find((s) => s.mode === "central")?.perTarget[i]?.avg ?? 0,
      }))
    : [];

  const metricData = [
    { name: "Completion (s)", key: "avgCompletion" as const },
    { name: "Distance (tiles)", key: "avgDistance" as const },
    { name: "Congestion (robot·s)", key: "avgCongestion" as const },
  ].map((m) => ({
    name: m.name,
    swarm: stats.find((s) => s.mode === "swarm")?.[m.key] ?? 0,
    central: stats.find((s) => s.mode === "central")?.[m.key] ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label className="label-hud">{rotateMap ? "Maps to try" : "Runs per mode"}</Label>
            <span className="text-sm text-hud">{runs}</span>
          </div>
          <Slider
            min={1}
            max={100}
            value={[runs]}
            onValueChange={(v) => setRuns(v[0] ?? 1)}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label className="label-hud">Time cap / run</Label>
            <span className="text-sm text-hud">{noLimit ? "∞" : `${maxTime}s`}</span>
          </div>
          <Slider
            min={60}
            max={900}
            step={30}
            value={[maxTime]}
            disabled={noLimit}
            onValueChange={(v) => setMaxTime(v[0] ?? 300)}
          />
          <div className="flex items-center gap-2 pt-1">
            <Switch id="nolimit" checked={noLimit} onCheckedChange={setNoLimit} />
            <Label htmlFor="nolimit" className="text-[11px]">
              No time limit — ends when all targets found
            </Label>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch id="cmp" checked={compare} onCheckedChange={setCompare} disabled={rotateMap} />
          <Label htmlFor="cmp" className="text-[11px] opacity-100 disabled:opacity-50">
            Compare both modes
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="rotate" checked={rotateMap} onCheckedChange={setRotateMap} />
          <Label htmlFor="rotate" className="text-[11px]">
            Change mode every map
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="randsize"
            checked={randomSize}
            onCheckedChange={setRandomSize}
            disabled={!rotateMap}
          />
          <Label htmlFor="randsize" className="text-[11px]">
            Randomize map size ({MAP_SIZE_MIN}–{MAP_SIZE_MAX})
          </Label>
        </div>
        <Button size="sm" className="gap-1" disabled={!!progress} onClick={execute}>
          <Play className="size-3.5" />
          {progress ? "RUNNING…" : "RUN HEADLESS BATCH"}
        </Button>
        {stats.length > 0 && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => onArchive(stats, runs)}
            >
              <Save className="size-3.5" /> ARCHIVE RESULTS
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={handlePDF}
            >
              <FileDown className="size-3.5" /> EXPORT PDF
            </Button>
          </>
        )}
        <span className="label-hud">
          Canvas rendering is skipped during batch execution
        </span>
      </div>

      {progress && (
        <div className="space-y-1">
          <Progress value={(progress.done / progress.total) * 100} />
          <div className="label-hud">
            {progress.done} / {progress.total} simulations complete
          </div>
        </div>
      )}

      {stats.length > 0 && (
        <div id="batch-results" className="space-y-5">
          {/* ── comparison tables ── */}
          <div className="grid gap-3 sm:grid-cols-2">
            {stats.map((s) => (
              <div key={s.mode} className="panel-frame p-3">
                <div className="label-hud mb-2">
                  {s.mode === "swarm" ? "Swarm intelligence" : "Centralized tower"} ·{" "}
                  {s.runs} runs
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">Target</TableHead>
                      <TableHead className="text-[10px]">Avg</TableHead>
                      <TableHead className="text-[10px]">σ</TableHead>
                      <TableHead className="text-[10px]">Min</TableHead>
                      <TableHead className="text-[10px]">Max</TableHead>
                      <TableHead className="text-[10px]">Found</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.perTarget.map((t) => (
                      <TableRow key={t.index}>
                        <TableCell className="py-1 text-[11px]">T{t.index}</TableCell>
                        <TableCell className="py-1 text-[11px] text-hud">
                          {t.avg == null ? "—" : `${t.avg.toFixed(1)}s`}
                        </TableCell>
                        <TableCell className="py-1 text-[11px]">
                          ±{t.sd.toFixed(1)}s
                        </TableCell>
                        <TableCell className="py-1 text-[11px]">
                          {t.min == null ? "—" : `${t.min.toFixed(1)}s`}
                        </TableCell>
                        <TableCell className="py-1 text-[11px]">
                          {t.max == null ? "—" : `${t.max.toFixed(1)}s`}
                        </TableCell>
                        <TableCell className="py-1 text-[11px]">
                          {(t.foundRate * 100).toFixed(0)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <Stat label="Avg completion" value={`${s.avgCompletion.toFixed(1)}s`} />
                  <Stat label="Avg targets found" value={`${s.avgFound.toFixed(1)}/${s.targets}`} />
                  <Stat label="σ completion" value={`±${s.sdCompletion.toFixed(1)}s`} />
                  <Stat label="Min / Max" value={`${s.minCompletion.toFixed(1)}s / ${s.maxCompletion.toFixed(1)}s`} />
                  <Stat label="Distance" value={`${s.avgDistance.toFixed(0)} tiles`} />
                  <Stat label="Congestion" value={`${s.avgCongestion.toFixed(0)} r·s`} />
                  <Stat label="Full sweeps" value={`${(s.completionRate * 100).toFixed(0)}%`} />
                </div>
              </div>
            ))}
          </div>

          {/* ── per-mode individual charts with error bars ── */}
          {stats.map((s) => {
            const color = s.mode === "swarm" ? "var(--chart-1)" : "var(--chart-2)";
            const chartData = s.perTarget.map((t) => ({
              name: `T${t.index}`,
              avg: t.avg ?? 0,
              sd: t.sd,
              min: t.min ?? 0,
              max: t.max ?? 0,
              foundPct: +(t.foundRate * 100).toFixed(1),
            }));
            return (
              <div key={s.mode} className="panel-frame p-3 space-y-3">
                <div className="label-hud">
                  {s.mode === "swarm" ? "Swarm Intelligence" : "Centralized Tower"} — per-target avg ± σ
                </div>
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--grid-line)" vertical={false} />
                      <XAxis dataKey="name" stroke="var(--hud-dim)" fontSize={10} />
                      <YAxis stroke="var(--hud-dim)" fontSize={10} unit="s" />
                      <Tooltip
                        contentStyle={{
                          background: "var(--panel)",
                          border: "1px solid var(--border)",
                          fontSize: 11,
                        }}
                        formatter={(v: number, key: string) => {
                          if (key === "avg") return [`${v.toFixed(2)}s`, "Avg"];
                          return [v, key];
                        }}
                      />
                      <Bar dataKey="avg" name="Avg (s)" fill={color} maxBarSize={40}>
                        <ErrorBar
                          dataKey="sd"
                          width={5}
                          strokeWidth={2}
                          stroke="var(--hud-dim)"
                          opacity={0.9}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
                  <Stat label="Avg mission" value={`${s.avgCompletion.toFixed(1)}s`} />
                  <Stat label="Avg targets found" value={`${s.avgFound.toFixed(1)}/${s.targets}`} />
                  <Stat label="σ mission" value={`±${s.sdCompletion.toFixed(1)}s`} />
                  <Stat label="Min / Max" value={`${s.minCompletion.toFixed(1)}s / ${s.maxCompletion.toFixed(1)}s`} />
                  <Stat label="Distance" value={`${s.avgDistance.toFixed(0)} tiles`} />
                  <Stat label="Congestion" value={`${s.avgCongestion.toFixed(0)} r·s`} />
                  <Stat label="Full sweeps" value={`${(s.completionRate * 100).toFixed(0)}%`} />
                </div>
              </div>
            );
          })}

          {/* ── side-by-side comparison charts ── */}
          <div className="panel-frame p-3">
            <div className="label-hud mb-2">Average detection time per target — both modes</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perTargetData}>
                  <CartesianGrid stroke="var(--grid-line)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--hud-dim)" fontSize={10} />
                  <YAxis stroke="var(--hud-dim)" fontSize={10} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      fontSize: 11,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="swarm" name="Swarm" fill="var(--chart-1)" />
                  <Bar dataKey="central" name="Centralized" fill="var(--chart-2)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel-frame p-3">
            <div className="label-hud mb-2">System metrics comparison</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metricData} layout="vertical">
                  <CartesianGrid stroke="var(--grid-line)" horizontal={false} />
                  <XAxis type="number" stroke="var(--hud-dim)" fontSize={10} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    stroke="var(--hud-dim)"
                    fontSize={10}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      fontSize: 11,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="swarm" name="Swarm" fill="var(--chart-1)">
                    {metricData.map((d) => (
                      <Cell key={d.name} />
                    ))}
                  </Bar>
                  <Bar dataKey="central" name="Centralized" fill="var(--chart-2)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-hud">{value}</span>
    </div>
  );
}