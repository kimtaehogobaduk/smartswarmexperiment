import { Rng } from "./rng";

export const MAP_SIZE = 500; // default / maximum grid edge
export const MAP_SIZE_MIN = 100;
export const MAP_SIZE_MAX = 500;
export const MAP_SIZE_STEP = 20;
export const COARSE = 5; // coarse cell = 5x5 tiles
export const COARSE_SIZE = MAP_SIZE / COARSE; // 100 (for the default size)

export const coarseSizeOf = (size: number) => Math.floor(size / COARSE);

export const clampMapSize = (n: number) => {
  const v = Math.round(n / MAP_SIZE_STEP) * MAP_SIZE_STEP;
  return Math.max(MAP_SIZE_MIN, Math.min(MAP_SIZE_MAX, v));
};

export const TILE_FLOOR = 0;
export const TILE_WALL = 1;
export const TILE_FURNITURE = 2;

export type FurnitureKind = "bed" | "closet" | "desk" | "crate";

export interface Furniture {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: FurnitureKind;
}

export interface Doorway {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SimMap {
  size: number;
  coarseSize: number;
  /** 0 floor, 1 wall, 2 furniture — blocks movement and vision */
  tiles: Uint8Array;
  /** doorway index + 1 per tile, 0 = none */
  doorwayAt: Int16Array;
  doorways: Doorway[];
  furniture: Furniture[];
  rooms: { x: number; y: number; w: number; h: number }[];
  spawn: { x: number; y: number };
  /** reachable floor tiles from spawn (flat indices) */
  reachable: Int32Array;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function generateMap(seed: number, size = MAP_SIZE): SimMap {
  const S = clampMapSize(size);
  const idx = (x: number, y: number) => y * S + x;
  const fillRect = (tiles: Uint8Array, x: number, y: number, w: number, h: number, v: number) => {
    for (let j = y; j < y + h; j++) {
      if (j < 0 || j >= S) continue;
      for (let i = x; i < x + w; i++) {
        if (i < 0 || i >= S) continue;
        tiles[idx(i, j)] = v;
      }
    }
  };

  const rng = new Rng(seed);
  const tiles = new Uint8Array(S * S);
  const doorwayAt = new Int16Array(S * S);
  const doorways: Doorway[] = [];
  const furniture: Furniture[] = [];

  // outer shell
  fillRect(tiles, 0, 0, S, 2, TILE_WALL);
  fillRect(tiles, 0, S - 2, S, 2, TILE_WALL);
  fillRect(tiles, 0, 0, 2, S, TILE_WALL);
  fillRect(tiles, S - 2, 0, 2, S, TILE_WALL);

  const rooms: Rect[] = [];
  // rooms scale with the map, but never get so small that doorway placement breaks
  const MIN = Math.max(30, Math.round(S * 0.088));

  const split = (r: Rect, depth: number) => {
    const canH = r.w > MIN * 2 + 2;
    const canV = r.h > MIN * 2 + 2;
    if (depth > 5 || (!canH && !canV)) {
      rooms.push(r);
      return;
    }
    const vertical = canH && (!canV || rng.next() < 0.5);
    if (vertical) {
      const cut = Math.round(rng.range(r.x + MIN, r.x + r.w - MIN));
      fillRect(tiles, cut, r.y, 1, r.h, TILE_WALL);
      // two 8-tile doorways, one per half of the wall
      const mid = r.y + Math.floor(r.h / 2);
      const dy1 = Math.round(rng.range(r.y + 4, Math.max(r.y + 5, mid - 9)));
      fillRect(tiles, cut, dy1, 1, 8, TILE_FLOOR);
      doorways.push({ x: cut, y: dy1, w: 1, h: 8 });
      const dy2 = Math.round(rng.range(mid + 2, Math.max(mid + 3, r.y + r.h - 12)));
      fillRect(tiles, cut, dy2, 1, 8, TILE_FLOOR);
      doorways.push({ x: cut, y: dy2, w: 1, h: 8 });
      split({ x: r.x, y: r.y, w: cut - r.x, h: r.h }, depth + 1);
      split({ x: cut + 1, y: r.y, w: r.x + r.w - cut - 1, h: r.h }, depth + 1);
    } else {
      const cut = Math.round(rng.range(r.y + MIN, r.y + r.h - MIN));
      fillRect(tiles, r.x, cut, r.w, 1, TILE_WALL);
      // two 8-tile doorways, one per half of the wall
      const mid = r.x + Math.floor(r.w / 2);
      const dx1 = Math.round(rng.range(r.x + 4, Math.max(r.x + 5, mid - 9)));
      fillRect(tiles, dx1, cut, 8, 1, TILE_FLOOR);
      doorways.push({ x: dx1, y: cut, w: 8, h: 1 });
      const dx2 = Math.round(rng.range(mid + 2, Math.max(mid + 3, r.x + r.w - 12)));
      fillRect(tiles, dx2, cut, 8, 1, TILE_FLOOR);
      doorways.push({ x: dx2, y: cut, w: 8, h: 1 });
      split({ x: r.x, y: r.y, w: r.w, h: cut - r.y }, depth + 1);
      split({ x: r.x, y: cut + 1, w: r.w, h: r.y + r.h - cut - 1 }, depth + 1);
    }
  };
  split({ x: 2, y: 2, w: S - 4, h: S - 4 }, 0);

  doorways.forEach((d, i) => {
    for (let y = d.y - 1; y < d.y + d.h + 1; y++) {
      for (let x = d.x - 1; x < d.x + d.w + 1; x++) {
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        if (tiles[idx(x, y)] === TILE_FLOOR) doorwayAt[idx(x, y)] = i + 1;
      }
    }
  });

  // spawn: 2x2 cluster in the first room
  const first = rooms[0] ?? { x: 4, y: 4, w: 10, h: 10 };
  const spawn = {
    x: first.x + Math.floor(first.w / 2),
    y: first.y + Math.floor(first.h / 2),
  };
  const kinds: FurnitureKind[] = ["bed", "closet", "desk", "crate"];

  // furniture: ~16% of each room's floor area
  for (const r of rooms) {
    const area = r.w * r.h;
    let placed = 0;
    let guard = 0;
    while (placed < area * 0.16 && guard < 4000) {
      guard++;
      const kind = kinds[rng.int(0, 3)] as FurnitureKind;
      const w =
        kind === "bed" ? rng.int(6, 9) : kind === "desk" ? rng.int(5, 10) : rng.int(3, 6);
      const h =
        kind === "bed" ? rng.int(4, 6) : kind === "closet" ? rng.int(6, 9) : rng.int(3, 6);
      const x = rng.int(r.x + 2, r.x + r.w - w - 2);
      const y = rng.int(r.y + 2, r.y + r.h - h - 2);
      if (x <= r.x || y <= r.y) continue;
      // keep clear of doorways, spawn pad and existing furniture (2 tile margin)
      let ok = true;
      for (let j = y - 3; j < y + h + 3 && ok; j++) {
        for (let i = x - 3; i < x + w + 3 && ok; i++) {
          if (i < 0 || j < 0 || i >= S || j >= S) continue;
          if (tiles[idx(i, j)] !== TILE_FLOOR) ok = false;
          if (doorwayAt[idx(i, j)] !== 0) ok = false;
        }
      }
      if (Math.abs(x - spawn.x) < 8 && Math.abs(y - spawn.y) < 8) ok = false;
      if (!ok) continue;
      fillRect(tiles, x, y, w, h, TILE_FURNITURE);
      furniture.push({ x, y, w, h, kind });
      placed += w * h;
    }
  }

  // reachability flood fill from spawn
  const seen = new Uint8Array(S * S);
  const queue = new Int32Array(S * S);
  let qh = 0;
  let qt = 0;
  const start = idx(spawn.x, spawn.y);
  queue[qt++] = start;
  seen[start] = 1;
  const reach: number[] = [];
  while (qh < qt) {
    const cur = queue[qh++] as number;
    reach.push(cur);
    const cx = cur % S;
    const cy = (cur - cx) / S;
    const nb = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const n of nb) {
      const nx = n[0] as number;
      const ny = n[1] as number;
      if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      const ni = idx(nx, ny);
      if (seen[ni] || tiles[ni] !== TILE_FLOOR) continue;
      seen[ni] = 1;
      queue[qt++] = ni;
    }
  }

  return {
    size: S,
    coarseSize: coarseSizeOf(S),
    tiles,
    doorwayAt,
    doorways,
    furniture,
    rooms,
    spawn,
    reachable: new Int32Array(reach),
  };
}

export const blocked = (map: SimMap, x: number, y: number): boolean => {
  const S = map.size;
  if (x < 0 || y < 0 || x >= S || y >= S) return true;
  return map.tiles[y * S + x] !== TILE_FLOOR;
};

/** Bresenham line of sight over blocking tiles. */
export function hasLineOfSight(
  map: SimMap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  let x = Math.floor(x0);
  let y = Math.floor(y0);
  const tx = Math.floor(x1);
  const ty = Math.floor(y1);
  const dx = Math.abs(tx - x);
  const dy = Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx - dy;
  while (x !== tx || y !== ty) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x === tx && y === ty) break;
    if (blocked(map, x, y)) return false;
  }
  return true;
}
