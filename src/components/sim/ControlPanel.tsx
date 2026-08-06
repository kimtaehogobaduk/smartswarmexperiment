import { Pause, Play, RefreshCw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import type { Metrics, SimConfig, SimMode } from "@/sim/engine";

const SPEEDS = [1, 2, 5, 10, 25, 100, 150];

interface Props {
  config: SimConfig;
  onConfig: (patch: Partial<SimConfig>) => void;
  playing: boolean;
  speed: number;
  metrics: Metrics | null;
  onPlayToggle: () => void;
  onStep: () => void;
  onSpeed: (s: number) => void;
  onReset: (newSeeds: boolean) => void;
}

export function ControlPanel({
  config,
  onConfig,
  playing,
  speed,
  metrics,
  onPlayToggle,
  onStep,
  onSpeed,
  onReset,
}: Props) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-1.5">
        {(["swarm", "central"] as SimMode[]).map((m) => (
          <Button
            key={m}
            variant={config.mode === m ? "default" : "outline"}
            className="h-auto flex-col items-start gap-0.5 px-2 py-2 text-left"
            onClick={() => onConfig({ mode: m })}
          >
            <span className="text-[11px] tracking-widest">
              {m === "swarm" ? "SWARM" : "TOWER"}
            </span>
            <span className="text-[9px] opacity-70">
              {m === "swarm" ? "Decentralized" : "Global A*"}
            </span>
          </Button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label className="label-hud">Robots</Label>
          <span className="text-sm text-hud">{config.robots}</span>
        </div>
        <Slider
          min={1}
          max={100}
          step={1}
          value={[config.robots]}
          onValueChange={(v) => onConfig({ robots: v[0] ?? 1 })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label className="label-hud">Targets</Label>
          <span className="text-sm text-hud">{config.targets}</span>
        </div>
        <Slider
          min={1}
          max={20}
          step={1}
          value={[config.targets]}
          onValueChange={(v) => onConfig({ targets: v[0] ?? 1 })}
        />
      </div>

      <div className="space-y-2">
        <Label className="label-hud">Transport</Label>
        <div className="flex gap-1.5">
          <Button size="sm" className="flex-1 gap-1" onClick={onPlayToggle}>
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {playing ? "PAUSE" : "PLAY"}
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={onStep}>
            <SkipForward className="size-3.5" /> STEP
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {SPEEDS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={speed === s ? "secondary" : "ghost"}
              className="h-7 min-w-[2.75rem] text-[11px]"
              onClick={() => onSpeed(s)}
            >
              {s}x
            </Button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1 text-[10px]"
            onClick={() => onReset(false)}
          >
            <RefreshCw className="size-3" /> RESTART RUN
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-[10px]"
            onClick={() => onReset(true)}
          >
            NEW MAP + SEED
          </Button>
        </div>
      </div>

      <div className="panel-frame space-y-1.5 p-3">
        <div className="label-hud">Telemetry</div>
        <Row label="Elapsed" value={`${(metrics?.elapsed ?? 0).toFixed(1)} s`} />
        <Row
          label="Targets found"
          value={`${metrics?.found ?? 0} / ${config.targets}`}
        />
        <Row
          label="Distance"
          value={`${(metrics?.totalDistance ?? 0).toFixed(0)} tiles`}
        />
        <Row
          label="Congestion"
          value={`${(metrics?.congestionTime ?? 0).toFixed(1)} robot·s`}
        />
        <div className="label-hud pt-1">Seeds</div>
        <Row label="Map" value={String(config.mapSeed)} />
        <Row label="Run" value={String(config.runSeed)} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-hud">{value}</span>
    </div>
  );
}