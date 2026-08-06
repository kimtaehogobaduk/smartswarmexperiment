import { useState } from "react";
import { Play, Save } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import type { SimConfig } from "@/sim/engine";

interface Props {
  config: SimConfig;
  onArchive: (stats: BatchStats[], runs: number) => void;
}

export function BatchPanel({ config, onArchive }: Props) {
  const [runs, setRuns] = useState(10);
  const [maxTime, setMaxTime] = useState(300);
  const [compare, setCompare] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stats, setStats] = useState<BatchStats[]>([]);

  const execute = async () => {
    const modes = compare ? (["swarm", "central"] as const) : ([config.mode] as const);
    const total = runs * modes.length;
    let completed = 0;
    setProgress({ done: 0, total });
    const collected: BatchStats[] = [];
    for (const mode of modes) {
      const results = await runBatch({ ...config, mode }, runs, maxTime, () => {
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
            <Label className="label-hud">Runs per mode</Label>
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
            <span className="text-sm text-hud">{maxTime}s</span>
          </div>
          <Slider
            min={60}
            max={900}
            step={30}
            value={[maxTime]}
            onValueChange={(v) => setMaxTime(v[0] ?? 300)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch id="cmp" checked={compare} onCheckedChange={setCompare} />
          <Label htmlFor="cmp" className="text-[11px]">
            Compare both modes
          </Label>
        </div>
        <Button size="sm" className="gap-1" disabled={!!progress} onClick={execute}>
          <Play className="size-3.5" />
          {progress ? "RUNNING…" : "RUN HEADLESS BATCH"}
        </Button>
        {stats.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => onArchive(stats, runs)}
          >
            <Save className="size-3.5" /> ARCHIVE RESULTS
          </Button>
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
        <div className="space-y-5">
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
                      <TableHead className="text-[10px]">Avg time</TableHead>
                      <TableHead className="text-[10px]">σ</TableHead>
                      <TableHead className="text-[10px]">Found</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.perTarget.map((t) => (
                      <TableRow key={t.index}>
                        <TableCell className="py-1 text-[11px]">Target {t.index}</TableCell>
                        <TableCell className="py-1 text-[11px] text-hud">
                          {t.avg == null ? "—" : `${t.avg.toFixed(1)}s`}
                        </TableCell>
                        <TableCell className="py-1 text-[11px]">
                          ±{t.sd.toFixed(1)}s
                        </TableCell>
                        <TableCell className="py-1 text-[11px]">
                          {(t.foundRate * 100).toFixed(0)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <Stat label="Mission time" value={`${s.avgCompletion.toFixed(1)}s`} />
                  <Stat label="Variance σ" value={`±${s.sdCompletion.toFixed(1)}s`} />
                  <Stat label="Distance" value={`${s.avgDistance.toFixed(0)} tiles`} />
                  <Stat label="Congestion" value={`${s.avgCongestion.toFixed(0)} r·s`} />
                  <Stat
                    label="Full sweeps"
                    value={`${(s.completionRate * 100).toFixed(0)}%`}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="panel-frame p-3">
            <div className="label-hud mb-2">Average time to first detection per target</div>
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