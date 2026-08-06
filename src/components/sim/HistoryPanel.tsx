import { useRef, useState } from "react";
import { Download, FolderOpen, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Preset, RunRecord } from "@/sim/storage";

interface Props {
  presets: Preset[];
  history: RunRecord[];
  onSavePreset: (name: string) => void;
  onLoadPreset: (p: Preset) => void;
  onDeletePreset: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onLoadRun: (r: RunRecord) => void;
  onDeleteRun: (id: string) => void;
}

export function HistoryPanel({
  presets,
  history,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  onExport,
  onImport,
  onLoadRun,
  onDeleteRun,
}: Props) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const compared = history.filter((h) => selected.includes(h.id));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="label-hud">Save preset (map + seeds + parameters)</div>
        <div className="flex gap-1.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="preset name"
            className="h-8 text-[11px]"
          />
          <Button
            size="sm"
            className="h-8"
            onClick={() => {
              onSavePreset(name.trim() || `preset-${presets.length + 1}`);
              setName("");
            }}
          >
            SAVE
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-8 flex-1 gap-1 text-[10px]" onClick={onExport}>
            <Download className="size-3" /> EXPORT JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 flex-1 gap-1 text-[10px]"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-3" /> IMPORT JSON
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="label-hud">Presets ({presets.length})</div>
        <ScrollArea className="h-32 panel-frame p-1">
          {presets.length === 0 && (
            <div className="p-2 text-[11px] text-muted-foreground">No presets saved.</div>
          )}
          {presets.map((p) => (
            <div key={p.id} className="flex items-center gap-1 px-1 py-1 text-[11px]">
              <span className="flex-1 truncate">
                {p.name}
                <span className="text-muted-foreground">
                  {" "}
                  · {p.config.robots}R/{p.config.targets}T · {p.config.mode}
                </span>
              </span>
              <Button size="icon" variant="ghost" className="size-6" onClick={() => onLoadPreset(p)}>
                <FolderOpen className="size-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                onClick={() => onDeletePreset(p.id)}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </ScrollArea>
      </div>

      <div className="space-y-1.5">
        <div className="label-hud">Run history ({history.length})</div>
        <ScrollArea className="h-56 panel-frame p-1">
          {history.length === 0 && (
            <div className="p-2 text-[11px] text-muted-foreground">
              Completed live runs and archived batches appear here.
            </div>
          )}
          {history.map((h) => (
            <div key={h.id} className="flex items-center gap-1.5 px-1 py-1 text-[11px]">
              <Checkbox
                checked={selected.includes(h.id)}
                onCheckedChange={(v) =>
                  setSelected((s) => (v ? [...s, h.id] : s.filter((x) => x !== h.id)))
                }
              />
              <span className="flex-1 truncate">
                {h.name}
                <span className="text-muted-foreground">
                  {" "}
                  · {new Date(h.savedAt).toLocaleTimeString()}
                </span>
              </span>
              <Button size="icon" variant="ghost" className="size-6" onClick={() => onLoadRun(h)}>
                <FolderOpen className="size-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                onClick={() => onDeleteRun(h.id)}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </ScrollArea>
      </div>

      {compared.length > 0 && (
        <div className="panel-frame space-y-2 p-2">
          <div className="label-hud">Historical comparison</div>
          {compared.map((h) => {
            const time =
              h.metrics?.elapsed ?? h.stats?.avgCompletion ?? 0;
            const dist = h.metrics?.totalDistance ?? h.stats?.avgDistance ?? 0;
            const cong = h.metrics?.congestionTime ?? h.stats?.avgCongestion ?? 0;
            return (
              <div key={h.id} className="space-y-0.5 border-t border-border pt-1 text-[11px]">
                <div className="text-hud">{h.name}</div>
                <div className="flex justify-between text-muted-foreground">
                  <span>{h.config.mode === "swarm" ? "Swarm" : "Centralized"}</span>
                  <span>
                    {h.config.robots}R / {h.config.targets}T · {h.kind}
                    {h.kind === "batch" ? ` ×${h.runs}` : ""}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mission time</span>
                  <span>{time.toFixed(1)}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Distance</span>
                  <span>{dist.toFixed(0)} tiles</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Congestion</span>
                  <span>{cong.toFixed(1)} robot·s</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}