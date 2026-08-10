import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Metrics, SimConfig } from "@/sim/engine";
import { DENSITY_DEFAULT } from "@/sim/map";

interface Props {
  config: SimConfig;
  metrics: Metrics;
}

/** Post-mission statistics table for the live camera-feed run. */
export function RunReport({ config, metrics }: Props) {
  const times = metrics.targetTimes
    .map((t, i) => ({ i: i + 1, t }))
    .filter((r): r is { i: number; t: number } => r.t != null)
    .sort((a, b) => a.t - b.t);

  const first = times[0]?.t ?? 0;
  const last = times[times.length - 1]?.t ?? 0;
  const avg = times.length ? times.reduce((a, r) => a + r.t, 0) / times.length : 0;
  const gaps = times.slice(1).map((r, k) => r.t - (times[k] as { t: number }).t);
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const perRobot = metrics.totalDistance / Math.max(1, config.robots);
  const efficiency = metrics.found ? metrics.totalDistance / metrics.found : 0;
  const congestionShare = metrics.elapsed
    ? metrics.congestionTime / (metrics.elapsed * config.robots)
    : 0;

  return (
    <div className="space-y-4">
      <div className="panel-frame p-3">
        <div className="label-hud mb-2">
          Mission debrief · {config.mode === "swarm" ? "Decentralized swarm" : "Centralized tower"}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-4">
          <Stat label="Mission time" value={`${metrics.elapsed.toFixed(1)} s`} />
          <Stat label="Targets found" value={`${metrics.found} / ${config.targets}`} />
          <Stat label="First detection" value={`${first.toFixed(1)} s`} />
          <Stat label="Last detection" value={`${last.toFixed(1)} s`} />
          <Stat label="Avg detection" value={`${avg.toFixed(1)} s`} />
          <Stat label="Avg gap between finds" value={`${avgGap.toFixed(1)} s`} />
          <Stat label="Total distance" value={`${metrics.totalDistance.toFixed(0)} tiles`} />
          <Stat label="Distance / robot" value={`${perRobot.toFixed(0)} tiles`} />
          <Stat label="Tiles per target" value={`${efficiency.toFixed(0)} tiles`} />
          <Stat label="Congestion" value={`${metrics.congestionTime.toFixed(1)} robot·s`} />
          <Stat label="Congestion share" value={`${(congestionShare * 100).toFixed(1)} %`} />
          <Stat
            label="Search rate"
            value={`${(metrics.found / Math.max(metrics.elapsed, 0.1) * 60).toFixed(2)} /min`}
          />
        </div>
      </div>

      <div className="panel-frame p-3">
        <div className="label-hud mb-2">Detection timeline</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[10px]">Order</TableHead>
              <TableHead className="text-[10px]">Target</TableHead>
              <TableHead className="text-[10px]">Found at</TableHead>
              <TableHead className="text-[10px]">Δ prev</TableHead>
              <TableHead className="text-[10px]">Progress</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {times.map((r, k) => (
              <TableRow key={r.i}>
                <TableCell className="py-1 text-[11px]">#{k + 1}</TableCell>
                <TableCell className="py-1 text-[11px]">T{r.i}</TableCell>
                <TableCell className="py-1 text-[11px] text-hud">{r.t.toFixed(1)} s</TableCell>
                <TableCell className="py-1 text-[11px]">
                  {k === 0 ? "—" : `+${(r.t - (times[k - 1] as { t: number }).t).toFixed(1)} s`}
                </TableCell>
                <TableCell className="py-1 text-[11px]">
                  {k + 1} / {config.targets}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="panel-frame p-3">
        <div className="label-hud mb-2">Run configuration</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-4">
          <Stat label="Mode" value={config.mode === "swarm" ? "SWARM" : "TOWER"} />
          <Stat label="Map size" value={`${config.mapSize}×${config.mapSize}`} />
          <Stat
            label="Obstacle density"
            value={`${Math.round((config.obstacleDensity ?? DENSITY_DEFAULT) * 100)} %`}
          />
          <Stat label="Robots" value={String(config.robots)} />
          <Stat label="Targets" value={String(config.targets)} />
          <Stat label="Map seed" value={String(config.mapSeed)} />
          <Stat label="Run seed" value={String(config.runSeed)} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-hud">{value}</span>
    </div>
  );
}
