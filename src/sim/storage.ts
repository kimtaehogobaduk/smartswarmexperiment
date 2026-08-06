import type { SimConfig } from "./engine";
import type { BatchStats } from "./batch";
import type { Metrics } from "./engine";

const PRESET_KEY = "swarmsim.presets.v1";
const HISTORY_KEY = "swarmsim.history.v1";

export interface Preset {
  id: string;
  name: string;
  savedAt: number;
  config: SimConfig;
}

export interface RunRecord {
  id: string;
  name: string;
  savedAt: number;
  config: SimConfig;
  kind: "live" | "batch";
  runs: number;
  metrics?: Metrics;
  stats?: BatchStats;
}

const read = <T>(key: string): T[] => {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
};
const write = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

export const loadPresets = () => read<Preset>(PRESET_KEY);
export const savePresets = (p: Preset[]) => write(PRESET_KEY, p);
export const loadHistory = () => read<RunRecord>(HISTORY_KEY);
export const saveHistory = (h: RunRecord[]) => write(HISTORY_KEY, h.slice(0, 60));

export const newId = () =>
  `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readJsonFile<T>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as T);
      } catch (e) {
        reject(e as Error);
      }
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsText(file);
  });
}