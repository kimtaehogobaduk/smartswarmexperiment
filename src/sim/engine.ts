import {
  COARSE,
  COARSE_SIZE,
  MAP_SIZE,
  blocked,
  generateMap,
  hasLineOfSight,
  type SimMap,
} from "./map";
import { Rng } from "./rng";

export type SimMode = "swarm" | "central";

export interface SimConfig {
  robots: number;
  targets: number;
  mode: SimMode;
  mapSeed: number;
  runSeed: number;
}

export interface Metrics {
  elapsed: number;
  targetTimes: (number | null)[];
  totalDistance: number;
  congestionTime: number;
  found: number;
  done: boolean;
}

export interface Robot {
  x: number;
  y: number;
  heading: number;
  speedNoise: number;
  sensorBias: number;
  path: number[]; // coarse cell indices
  goal: number; // coarse cell index, -1 none
  replanIn: number;
  known: Uint8Array; // coarse knowledge (swarm only; shared array in central)
  knownTargets: Set<number>;
  distance: number;
  waiting: boolean;
  stuckFor: number;
}

export interface Target {
  x: number;
  y: number;
  found: boolean;
  foundAt: number | null;
}

export const MAX_SPEED = 2.0; // tiles / second
const SENSOR_RANGE = 26;
const FOV = (100 * Math.PI) / 180;
const RADIO_RANGE = 40;
const UNKNOWN = 0;
const FREE = 1;
const BLOCKED = 2;

const cIdx = (cx: number, cy: number) => cy * COARSE_SIZE + cx;

export class Simulation {
  readonly config: SimConfig;
  readonly map: SimMap;
  robots: Robot[] = [];
  targets: Target[] = [];
  /** team-visible explored grid (used for fog rendering + central planner) */
  explored: Uint8Array;
  /** coarse passability derived from the true map (central planner) */
  passable: Uint8Array;
  time = 0;
  congestionTime = 0;
  totalDistance = 0;
  private rng: Rng;
  private senseAcc = 0;
  private radioAcc = 0;
  private claims = new Map<number, number>(); // coarse cell -> robot id
  private doorLock: { dir: number; ttl: number; owner: number }[] = [];

  constructor(config: SimConfig) {
    this.config = config;
    this.map = generateMap(config.mapSeed);
    this.rng = new Rng(config.runSeed);
    this.explored = new Uint8Array(COARSE_SIZE * COARSE_SIZE);
    this.passable = new Uint8Array(COARSE_SIZE * COARSE_SIZE);
    for (let cy = 0; cy < COARSE_SIZE; cy++) {
      for (let cx = 0; cx < COARSE_SIZE; cx++) {
        let free = 0;
        for (let j = 0; j < COARSE; j++)
          for (let i = 0; i < COARSE; i++)
            if (!blocked(this.map, cx * COARSE + i, cy * COARSE + j)) free++;
        this.passable[cIdx(cx, cy)] = free >= 4 ? 1 : 0;
      }
    }
    this.doorLock = this.map.doorways.map(() => ({ dir: 0, ttl: 0, owner: -1 }));
    this.spawnRobots();
    this.spawnTargets();
  }

  private spawnRobots() {
    const { spawn } = this.map;
    const shared = new Uint8Array(COARSE_SIZE * COARSE_SIZE);
    for (let i = 0; i < this.config.robots; i++) {
      // all robots stacked inside a single 2x2 tile pad -> immediate bottleneck
      const x = spawn.x + this.rng.range(0, 2);
      const y = spawn.y + this.rng.range(0, 2);
      this.robots.push({
        x,
        y,
        heading: this.rng.range(0, Math.PI * 2),
        speedNoise: 1 + this.rng.gauss() * 0.03, // ±3% speed jitter
        sensorBias: this.rng.gauss() * 0.04,
        path: [],
        goal: -1,
        replanIn: this.rng.range(0, 0.6),
        known:
          this.config.mode === "central"
            ? shared
            : new Uint8Array(COARSE_SIZE * COARSE_SIZE),
        knownTargets: new Set<number>(),
        distance: 0,
        waiting: false,
        stuckFor: 0,
      });
    }
  }

  private spawnTargets() {
    const reach = this.map.reachable;
    const spawn = this.map.spawn;
    for (let i = 0; i < this.config.targets; i++) {
      let tries = 0;
      while (tries++ < 500) {
        const flat = reach[this.rng.int(0, reach.length - 1)] as number;
        const x = flat % MAP_SIZE;
        const y = (flat - x) / MAP_SIZE;
        if (Math.hypot(x - spawn.x, y - spawn.y) < 60) continue;
        this.targets.push({ x: x + 0.5, y: y + 0.5, found: false, foundAt: null });
        break;
      }
    }
  }

  get metrics(): Metrics {
    return {
      elapsed: this.time,
      targetTimes: this.targets.map((t) => t.foundAt),
      totalDistance: this.totalDistance,
      congestionTime: this.congestionTime,
      found: this.targets.filter((t) => t.found).length,
      done: this.targets.every((t) => t.found),
    };
  }

  // ---------------------------------------------------------------- sensing
  private sense(r: Robot) {
    const rays = 26;
    const half = FOV / 2;
    for (let k = 0; k < rays; k++) {
      const a =
        r.heading -
        half +
        (FOV * k) / (rays - 1) +
        r.sensorBias * this.rng.gauss(); // sensor angle variance
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      for (let d = 1; d <= SENSOR_RANGE; d++) {
        const x = Math.floor(r.x + dx * d);
        const y = Math.floor(r.y + dy * d);
        if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) break;
        const c = cIdx(Math.floor(x / COARSE), Math.floor(y / COARSE));
        if (blocked(this.map, x, y)) {
          if (r.known[c] === UNKNOWN) r.known[c] = BLOCKED;
          if (this.explored[c] === UNKNOWN) this.explored[c] = BLOCKED;
          break;
        }
        r.known[c] = FREE;
        this.explored[c] = FREE;
      }
    }
    // target detection inside the FOV cone
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i] as Target;
      const dist = Math.hypot(t.x - r.x, t.y - r.y);
      if (dist > SENSOR_RANGE) continue;
      const ang = Math.atan2(t.y - r.y, t.x - r.x);
      let diff = Math.abs(((ang - r.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff > half) continue;
      if (!hasLineOfSight(this.map, r.x, r.y, t.x, t.y)) continue;
      r.knownTargets.add(i);
      if (!t.found) {
        t.found = true;
        t.foundAt = this.time;
      }
    }
  }

  /** swarm peer-to-peer knowledge sharing inside physical radio range */
  private radioSync() {
    if (this.config.mode !== "swarm") return;
    const n = this.robots.length;
    for (let i = 0; i < n; i++) {
      const a = this.robots[i] as Robot;
      for (let j = i + 1; j < n; j++) {
        const b = this.robots[j] as Robot;
        if (Math.hypot(a.x - b.x, a.y - b.y) > RADIO_RANGE) continue;
        for (const t of a.knownTargets) b.knownTargets.add(t);
        for (const t of b.knownTargets) a.knownTargets.add(t);
        for (let k = 0; k < a.known.length; k++) {
          const av = a.known[k] as number;
          const bv = b.known[k] as number;
          if (av === UNKNOWN && bv !== UNKNOWN) a.known[k] = bv;
          else if (bv === UNKNOWN && av !== UNKNOWN) b.known[k] = av;
        }
      }
    }
  }

  // ------------------------------------------------------------- navigation
  private cellOf(r: Robot) {
    return cIdx(Math.floor(r.x / COARSE), Math.floor(r.y / COARSE));
  }

  /** BFS from robot cell to the best unclaimed frontier; returns path of cells */
  private planFrontier(r: Robot, id: number): number[] {
    const central = this.config.mode === "central";
    const known = central ? this.explored : r.known;
    const start = this.cellOf(r);
    const prev = new Int32Array(COARSE_SIZE * COARSE_SIZE).fill(-1);
    const seen = new Uint8Array(COARSE_SIZE * COARSE_SIZE);
    const queue: number[] = [start];
    seen[start] = 1;
    let head = 0;
    let best = -1;
    // priority: an assigned known target, otherwise the nearest frontier
    const targetCells = new Set<number>();
    for (const ti of r.knownTargets) {
      const t = this.targets[ti] as Target;
      targetCells.add(cIdx(Math.floor(t.x / COARSE), Math.floor(t.y / COARSE)));
    }
    while (head < queue.length) {
      const cur = queue[head++] as number;
      const cx = cur % COARSE_SIZE;
      const cy = (cur - cx) / COARSE_SIZE;
      const frontier = this.isFrontier(known, cx, cy, central);
      if (frontier && !this.claims.has(cur)) {
        best = cur;
        break;
      }
      for (let d = 0; d < 4; d++) {
        const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= COARSE_SIZE || ny >= COARSE_SIZE) continue;
        const ni = cIdx(nx, ny);
        if (seen[ni]) continue;
        const walkable = central
          ? this.passable[ni] === 1
          : known[ni] === FREE || known[ni] === UNKNOWN;
        if (!walkable) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
    if (best < 0) {
      // fall back to any reachable explored cell, keeps robots moving
      const pool = queue.filter((c) => c !== start);
      if (!pool.length) return [];
      best = pool[this.rng.int(0, pool.length - 1)] as number;
    }
    const path: number[] = [];
    let cur = best;
    while (cur !== start && cur >= 0) {
      path.push(cur);
      cur = prev[cur] as number;
    }
    path.reverse();
    this.claims.set(best, id);
    r.goal = best;
    return path;
  }

  private isFrontier(
    known: Uint8Array,
    cx: number,
    cy: number,
    central: boolean,
  ): boolean {
    const self = cIdx(cx, cy);
    if (central) {
      if (this.passable[self] !== 1) return false;
      if (known[self] !== UNKNOWN) return false;
      return true;
    }
    if (known[self] !== FREE) return false;
    for (let d = 0; d < 4; d++) {
      const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= COARSE_SIZE || ny >= COARSE_SIZE) continue;
      if (known[cIdx(nx, ny)] === UNKNOWN) return true;
    }
    return false;
  }

  /** clearance along a direction, in tiles (max 4) */
  private clearance(x: number, y: number, dx: number, dy: number): number {
    for (let d = 1; d <= 4; d++) {
      if (blocked(this.map, Math.floor(x + dx * d), Math.floor(y + dy * d))) return d - 1;
    }
    return 4;
  }

  /** doorway queue manager for centralized mode */
  private doorwayPermit(r: Robot, dirAngle: number): boolean {
    const di = this.map.doorwayAt[Math.floor(r.y) * MAP_SIZE + Math.floor(r.x)] as number;
    if (!di) return true;
    const lock = this.doorLock[di - 1];
    if (!lock) return true;
    const dir = Math.abs(Math.cos(dirAngle)) > Math.abs(Math.sin(dirAngle))
      ? Math.sign(Math.cos(dirAngle))
      : Math.sign(Math.sin(dirAngle)) * 2;
    if (lock.ttl <= 0 || lock.dir === dir) {
      lock.dir = dir;
      lock.ttl = 1.2;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------- step
  step(dt: number) {
    this.time += dt;
    for (const l of this.doorLock) l.ttl = Math.max(0, l.ttl - dt);

    this.senseAcc += dt;
    const doSense = this.senseAcc >= 0.1;
    if (doSense) this.senseAcc = 0;

    this.radioAcc += dt;
    if (this.radioAcc >= 0.5) {
      this.radioAcc = 0;
      this.radioSync();
    }

    for (let id = 0; id < this.robots.length; id++) {
      const r = this.robots[id] as Robot;
      if (doSense) this.sense(r);

      r.replanIn -= dt;
      const cell = this.cellOf(r);
      if (r.path.length && r.path[0] === cell) r.path.shift();
      if (r.replanIn <= 0 || !r.path.length || r.stuckFor > 1.5) {
        if (r.goal >= 0 && this.claims.get(r.goal) === id) this.claims.delete(r.goal);
        r.path = this.planFrontier(r, id);
        r.replanIn = 1.5 + this.rng.range(0, 1);
        r.stuckFor = 0;
      }

      // desired heading toward next waypoint (or a known unvisited target)
      let desired = r.heading;
      const next = r.path[0];
      if (next !== undefined) {
        const gx = (next % COARSE_SIZE) * COARSE + COARSE / 2;
        const gy = Math.floor(next / COARSE_SIZE) * COARSE + COARSE / 2;
        desired = Math.atan2(gy - r.y, gx - r.x);
      }

      // boid separation from nearby peers
      let sepX = 0;
      let sepY = 0;
      let neighbors = 0;
      for (let j = 0; j < this.robots.length; j++) {
        if (j === id) continue;
        const o = this.robots[j] as Robot;
        const ddx = r.x - o.x;
        const ddy = r.y - o.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > 9 || d2 === 0) continue;
        const d = Math.sqrt(d2) || 0.001;
        sepX += ddx / (d * d);
        sepY += ddy / (d * d);
        neighbors++;
      }

      // candidate steering directions weighted by clearance + separation
      let bestScore = -Infinity;
      let bestAngle = desired;
      for (let k = -6; k <= 6; k++) {
        const a = desired + (k * Math.PI) / 9;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const clr = this.clearance(r.x, r.y, dx, dy);
        if (clr === 0) continue;
        let score = clr * 1.6 + Math.cos(a - desired) * 3.2;
        if (neighbors) score += (dx * sepX + dy * sepY) * 2.4;
        score += this.rng.gauss() * 0.25; // stochastic tie-breaking
        if (score > bestScore) {
          bestScore = score;
          bestAngle = a;
        }
      }
      if (bestScore === -Infinity) {
        // fully boxed in: wall-follow by rotating in place
        r.heading += 0.9 * dt * 6;
        r.stuckFor += dt;
        this.congestionTime += dt;
        r.waiting = true;
        continue;
      }

      // turn toward chosen direction
      let delta = ((bestAngle - r.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const maxTurn = 3.2 * dt;
      r.heading += Math.max(-maxTurn, Math.min(maxTurn, delta));

      let speed = MAX_SPEED * r.speedNoise * (1 + this.rng.gauss() * 0.01);
      // slow down while turning hard, and crowd throttling
      if (Math.abs(delta) > 1) speed *= 0.45;
      if (neighbors > 2) speed *= 0.7;

      if (this.config.mode === "central" && !this.doorwayPermit(r, r.heading)) {
        speed = 0;
      }

      const nx = r.x + Math.cos(r.heading) * speed * dt;
      const ny = r.y + Math.sin(r.heading) * speed * dt;
      let moved = 0;
      if (!blocked(this.map, Math.floor(nx), Math.floor(ny))) {
        moved = Math.hypot(nx - r.x, ny - r.y);
        r.x = nx;
        r.y = ny;
      } else {
        r.stuckFor += dt;
      }
      r.distance += moved;
      this.totalDistance += moved;
      const ratio = moved / (MAX_SPEED * dt || 1);
      r.waiting = ratio < 0.4;
      if (r.waiting) this.congestionTime += dt;
      if (ratio > 0.6) r.stuckFor = Math.max(0, r.stuckFor - dt);
    }
  }

  /** run headless until all targets found or the time limit is reached */
  runHeadless(maxTime = 900, dt = 0.1): Metrics {
    while (this.time < maxTime && !this.targets.every((t) => t.found)) {
      this.step(dt);
    }
    return this.metrics;
  }
}

export const SENSOR = { RANGE: SENSOR_RANGE, FOV, RADIO_RANGE };