import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CanvasFeed } from "@/components/sim/CanvasFeed";
import { ControlPanel } from "@/components/sim/ControlPanel";
import { BatchPanel } from "@/components/sim/BatchPanel";
import { HistoryPanel } from "@/components/sim/HistoryPanel";
import { Simulation, type Metrics, type SimConfig } from "@/sim/engine";
import type { BatchStats } from "@/sim/batch";
import {
  downloadJson,
  loadHistory,
  loadPresets,
  newId,
  readJsonFile,
  saveHistory,
  savePresets,
  type Preset,
  type RunRecord,
  type TelemetrySnapshot,
} from "@/sim/storage";
import { randomSeed } from "@/sim/rng";
import { MAP_SIZE_MAX } from "@/sim/map";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "2026 상산고 영어 심화 탐구_smart swarm vs control tower" },
      {
        name: "description",
        content:
          "Interactive tactical simulator comparing decentralized swarm intelligence against a centralized control tower on a 500×500 indoor multi-target search mission.",
      },
      { property: "og:title", content: "Swarm vs Tower — Multi-Robot Search Simulator" },
      {
        property: "og:description",
        content:
          "Run live or headless batch simulations and compare swarm intelligence with global A* routing across detection time, distance and congestion.",
      },
    ],
  }),
  component: Index,
});

const DEFAULT_CONFIG: SimConfig = {
  robots: 20,
  targets: 6,
  mode: "swarm",
  mapSize: MAP_SIZE_MAX,
  mapSeed: 20260806,
  runSeed: 1337,
};

function Index() {
  const [config, setConfig] = useState<SimConfig>(DEFAULT_CONFIG);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const archived = useRef(false);

  useEffect(() => {
    setPresets(loadPresets());
    setHistory(loadHistory());
  }, []);

  const build = useCallback((cfg: SimConfig) => {
    const s = new Simulation(cfg);
    archived.current = false;
    setSim(s);
    setMetrics(s.metrics);
    return s;
  }, []);

  useEffect(() => {
    build(config);
    // rebuild whenever structural parameters change
  }, [build, config]);

  // simulation loop
  useEffect(() => {
    if (!sim || !playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastMetrics = 0;
    const DT = 0.05;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      acc += Math.min((now - last) / 1000, 0.25) * speed;
      last = now;
      let steps = 0;
      while (acc >= DT && steps < 400) {
        sim.step(DT);
        acc -= DT;
        steps++;
      }
      // metrics allocate arrays — refresh at ~12 Hz instead of every frame
      if (now - lastMetrics > 80 || sim.done) {
        lastMetrics = now;
        setMetrics(sim.metrics);
      }
      if (sim.done) setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sim, playing, speed]);

  // archive finished live runs
  useEffect(() => {
    if (!sim || !metrics?.done || archived.current) return;
    archived.current = true;
    const record: RunRecord = {
      id: newId(),
      name: `LIVE ${config.mode === "swarm" ? "SWARM" : "TOWER"} ${config.robots}R/${config.targets}T`,
      savedAt: Date.now(),
      config,
      kind: "live",
      runs: 1,
      metrics,
    };
    setHistory((h) => {
      const next = [record, ...h];
      saveHistory(next);
      return next;
    });
    toast.success("Mission complete — run archived to history");
  }, [sim, metrics, config]);

  const patchConfig = (patch: Partial<SimConfig>) => {
    setPlaying(false);
    setConfig((c) => ({ ...c, ...patch }));
  };

  const reset = (newSeeds: boolean) => {
    setPlaying(false);
    if (newSeeds) {
      setConfig((c) => ({ ...c, mapSeed: randomSeed(), runSeed: randomSeed() }));
    } else {
      setConfig((c) => ({ ...c, runSeed: randomSeed() }));
    }
  };

  const savePreset = (name: string) => {
    const next: Preset[] = [
      { id: newId(), name, savedAt: Date.now(), config, ...(metrics ? { metrics } : {}) },
      ...presets,
    ];
    setPresets(next);
    savePresets(next);
    toast.success(`Preset "${name}" saved with telemetry`);
  };

  const archiveBatch = (stats: BatchStats[], runs: number) => {
    const records: RunRecord[] = stats.map((s) => ({
      id: newId(),
      name: `BATCH ${s.mode === "swarm" ? "SWARM" : "TOWER"} ×${runs}`,
      savedAt: Date.now(),
      config: { ...config, mode: s.mode },
      kind: "batch",
      runs,
      stats: s,
    }));
    setHistory((h) => {
      const next = [...records, ...h];
      saveHistory(next);
      return next;
    });
    toast.success("Batch results archived");
  };

  const banner = useMemo(
    () => (config.mode === "swarm" ? "DECENTRALIZED SWARM" : "CENTRALIZED CONTROL TOWER"),
    [config.mode],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Toaster />
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-3">
          <Radio className="size-4 text-hud" />
          <h1 className="text-sm font-semibold text-hud">
            2026 상산고 영어 심화 탐구_smart swarm vs control tower
          </h1>
          <span className="text-[10px] tracking-wide text-muted-foreground">made by smartlab</span>
          <span className="label-hud hidden sm:inline">{banner}</span>
        </div>
        <span className="label-hud">
          {metrics?.found ?? 0}/{config.targets} TARGETS · T+{(metrics?.elapsed ?? 0).toFixed(1)}s
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 border-r border-border lg:block">
          <ScrollArea className="h-full">
            <div className="p-3">
              <ControlPanel
                config={config}
                onConfig={patchConfig}
                playing={playing}
                speed={speed}
                metrics={metrics}
                snapshot={snapshot}
                onClearSnapshot={() => setSnapshot(null)}
                onPlayToggle={() => setPlaying((p) => !p)}
                onStep={() => {
                  sim?.step(0.05);
                  if (sim) setMetrics(sim.metrics);
                }}
                onSpeed={setSpeed}
                onReset={reset}
              />
            </div>
          </ScrollArea>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <Tabs defaultValue="feed" className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="m-2 self-start">
              <TabsTrigger value="feed" className="text-[11px]">
                CAMERA FEED
              </TabsTrigger>
              <TabsTrigger value="batch" className="text-[11px]">
                BATCH &amp; ANALYTICS
              </TabsTrigger>
              <TabsTrigger value="files" className="text-[11px]">
                FILES &amp; HISTORY
              </TabsTrigger>
            </TabsList>

            <TabsContent value="feed" className="min-h-0 flex-1">
              <CanvasFeed sim={sim} paused={!playing} speed={speed} />
            </TabsContent>

            <TabsContent value="batch" className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                <div className="p-4">
                  <BatchPanel config={config} onArchive={archiveBatch} />
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="files" className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                <div className="max-w-xl p-4">
                  <HistoryPanel
                    presets={presets}
                    history={history}
                    onSavePreset={savePreset}
                    onLoadPreset={(p) => {
                      setPlaying(false);
                      setConfig(p.config);
                      setSnapshot(
                        p.metrics
                          ? {
                              name: p.name,
                              source: "preset",
                              runs: 1,
                              targets: p.config.targets,
                              elapsed: p.metrics.elapsed,
                              found: p.metrics.found,
                              distance: p.metrics.totalDistance,
                              congestion: p.metrics.congestionTime,
                            }
                          : null,
                      );
                      toast.success(
                        p.metrics
                          ? `Loaded preset "${p.name}" with saved telemetry`
                          : `Loaded preset "${p.name}"`,
                      );
                    }}
                    onDeletePreset={(id) => {
                      const next = presets.filter((p) => p.id !== id);
                      setPresets(next);
                      savePresets(next);
                    }}
                    onExport={() =>
                      downloadJson("swarm-sim-project.json", { config, presets, history })
                    }
                    onImport={async (file) => {
                      try {
                        const data = await readJsonFile<{
                          config?: SimConfig;
                          presets?: Preset[];
                          history?: RunRecord[];
                        }>(file);
                        if (data.config) setConfig(data.config);
                        if (data.presets) {
                          setPresets(data.presets);
                          savePresets(data.presets);
                        }
                        if (data.history) {
                          setHistory(data.history);
                          saveHistory(data.history);
                        }
                        toast.success("Project imported");
                      } catch {
                        toast.error("Invalid project file");
                      }
                    }}
                    onLoadRun={(r) => {
                      setPlaying(false);
                      setConfig(r.config);
                      const s = r.stats;
                      const m = r.metrics;
                      setSnapshot(
                        m
                          ? {
                              name: r.name,
                              source: "live",
                              runs: 1,
                              targets: r.config.targets,
                              elapsed: m.elapsed,
                              found: m.found,
                              distance: m.totalDistance,
                              congestion: m.congestionTime,
                            }
                          : s
                            ? {
                                name: r.name,
                                source: "batch",
                                runs: r.runs,
                                targets: r.config.targets,
                                elapsed: s.avgCompletion,
                                found:
                                  s.perTarget.reduce((a, p) => a + p.foundRate, 0),
                                distance: s.avgDistance,
                                congestion: s.avgCongestion,
                                completionRate: s.completionRate,
                              }
                            : null,
                      );
                      toast.success(`Loaded configuration from "${r.name}"`);
                    }}
                    onDeleteRun={(id) => {
                      const next = history.filter((h) => h.id !== id);
                      setHistory(next);
                      saveHistory(next);
                    }}
                  />
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}
