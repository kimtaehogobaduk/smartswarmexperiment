import {
  COARSE,
  MAP_SIZE,
  blocked,
  clampMapSize,
  generateMap,
  hasLineOfSight,
  type SimMap,
} from "./map";
import { PathFinder } from "./astar";
import { Rng } from "./rng";

export type SimMode = "swarm" | "central";

export interface SimConfig {
  robots: number;
  targets: number;
  mode: SimMode;
  mapSeed: number;
  runSeed: number;
  /** grid edge length in tiles (100–500) */
  mapSize: number;
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
  /** coarse knowledge: 0 unknown, 1 free, 2 blocked */
  known: Uint8Array;
  /** fine tile beliefs: 0 unknown, 1 free, 2 blocked */
  fine: Uint8Array;
  path: number[];
  goalCell: number;
  replanIn: number;
  knownTargets: Set<number>;
  distance: number;
  waiting: boolean;
  stuckFor: number;
  avoid: Map<number, number>;
  /**
   * Ring of past positions sampled every ~2 tiles of travel, newest first.
   * index 0 = last good tile, index 1 = ~2 tiles before that, etc.
   * Capped at 20 entries so memory stays bounded.
   */
  posHistory: { x: number; y: number }[];
  /** sim-time of the last meaningful move (used for the 3-s teleport rescue) */
  lastMoveTime: number;
  /** how many consecutive rescues have fired; used as the posHistory index */
  rescueCount: number;
  /** position where the last rescue teleport landed */
  rescueX: number;
  rescueY: number;
  /** how many consecutive rescues have landed within ~3 tiles of each other */
  sameSpotRescues: number;
}

export interface Target {
  x: number;
  y: number;
  found: boolean;
  foundAt: number | null;
}

export const MAX_SPEED = 3.5; // tiles per second (1.75× original 2.0)
const SENSOR_RANGE = 26;
const FOV = (100 * Math.PI) / 180;
const RADIO_RANGE = 40;
const UNKNOWN = 0;
const FREE = 1;
const BLOCKED = 2;


export class Simulation {
  readonly config: SimConfig;
  readonly map: SimMap;
  /** grid edge length */
  readonly S: number;
  /** coarse grid edge length */
  readonly CS: number;
  robots: Robot[] = [];
  targets: Target[] = [];
  /** team-visible explored coarse grid (fog rendering + central planner) */
  explored: Uint8Array;
  /** coarse passability derived from the true map (central planner only) */
  passable: Uint8Array;
  time = 0;
  congestionTime = 0;
  totalDistance = 0;
  private rng: Rng;
  private pf: PathFinder;
  private senseAcc = 0;
  private radioAcc = 0;
  private claims = new Map<number, number>();
  private doorLock: { dir: number; ttl: number }[] = [];
  private truthFine: Uint8Array;
  /** cached count of found targets — avoids rebuilding metrics in hot loops */
  private foundCount = 0;

  constructor(config: SimConfig) {
    const mapSize = clampMapSize(config.mapSize ?? MAP_SIZE);
    this.config = { ...config, mapSize };
    this.map = generateMap(config.mapSeed, mapSize);
    this.S = this.map.size;
    this.CS = this.map.coarseSize;
    this.pf = new PathFinder(this.S);
    this.rng = new Rng(config.runSeed);
    this.explored = new Uint8Array(this.CS * this.CS);
    this.passable = new Uint8Array(this.CS * this.CS);
    this.truthFine = new Uint8Array(this.S * this.S);
    for (let i = 0; i < this.S * this.S; i++) {
      this.truthFine[i] = this.map.tiles[i] === 0 ? FREE : BLOCKED;
    }
    for (let cy = 0; cy < this.CS; cy++) {
      for (let cx = 0; cx < this.CS; cx++) {
        let free = 0;
        for (let j = 0; j < COARSE; j++)
          for (let i = 0; i < COARSE; i++)
            if (!blocked(this.map, cx * COARSE + i, cy * COARSE + j)) free++;
        this.passable[this.cIdx(cx, cy)] = free >= 4 ? 1 : 0;
      }
    }
    this.doorLock = this.map.doorways.map(() => ({ dir: 0, ttl: 0 }));
    this.spawnRobots();
    this.spawnTargets();
  }

  private cIdx(cx: number, cy: number) {
    return cy * this.CS + cx;
  }

  private spawnRobots() {
    const { spawn } = this.map;
    const central = this.config.mode === "central";
    const sharedCoarse = new Uint8Array(this.CS * this.CS);
    for (let i = 0; i < this.config.robots; i++) {
      // every robot spawns inside one 2x2 tile pad -> immediate bottleneck queue
      const x = spawn.x + this.rng.range(0, 2);
      const y = spawn.y + this.rng.range(0, 2);
      this.robots.push({
        x,
        y,
        heading: this.rng.range(0, Math.PI * 2),
        speedNoise: 1 + this.rng.gauss() * 0.03, // ±3% speed jitter
        sensorBias: Math.abs(this.rng.gauss()) * 0.04,
        known: central ? sharedCoarse : new Uint8Array(this.CS * this.CS),
        // the central tower holds the full map; swarm robots build beliefs locally
        fine: central ? this.truthFine : new Uint8Array(this.S * this.S),
        path: [],
        goalCell: -1,
        replanIn: this.rng.range(0, 0.5),
        knownTargets: new Set<number>(),
        distance: 0,
        waiting: false,
        stuckFor: 0,
        avoid: new Map(),
        posHistory: [{ x, y }],
        lastMoveTime: 0,
        rescueCount: 0,
        rescueX: x,
        rescueY: y,
        sameSpotRescues: 0,
      });
    }
  }

  private spawnTargets() {
    const reach = this.map.reachable;
    const spawn = this.map.spawn;
    const minSpawnDist = Math.min(60, this.S * 0.25);
    // targets must be well spread out: 30 tiles apart, relaxed only if the map
    // is too small / cluttered to honour it
    const separations = [30, 22, 15, 8, 0].map((d) => Math.min(d, this.S * 0.3));
    for (let i = 0; i < this.config.targets; i++) {
      let placed = false;
      for (const sep of separations) {
        for (let tries = 0; tries < 600 && !placed; tries++) {
          const flat = reach[this.rng.int(0, reach.length - 1)] as number;
          const x = flat % this.S;
          const y = (flat - x) / this.S;
          if (Math.hypot(x - spawn.x, y - spawn.y) < minSpawnDist) continue;
          let ok = true;
          for (const t of this.targets) {
            if (Math.hypot(t.x - (x + 0.5), t.y - (y + 0.5)) < sep) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          this.targets.push({ x: x + 0.5, y: y + 0.5, found: false, foundAt: null });
          placed = true;
        }
        if (placed) break;
      }
    }
  }

  /** cheap done check — no allocation, safe to call inside the headless loop */
  get done(): boolean {
    return this.targets.length > 0 && this.foundCount === this.targets.length;
  }

  get metrics(): Metrics {
    return {
      elapsed: this.time,
      targetTimes: this.targets.map((t) => t.foundAt),
      totalDistance: this.totalDistance,
      congestionTime: this.congestionTime,
      found: this.foundCount,
      done: this.done,
    };
  }

  // ---------------------------------------------------------------- sensing
  private sense(r: Robot) {
    const rays = 30;
    const half = FOV / 2;
    const swarm = this.config.mode === "swarm";
    for (let k = 0; k < rays; k++) {
      const a =
        r.heading - half + (FOV * k) / (rays - 1) + r.sensorBias * this.rng.gauss();
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      for (let d = 1; d <= SENSOR_RANGE; d++) {
        const x = Math.floor(r.x + dx * d);
        const y = Math.floor(r.y + dy * d);
        if (x < 0 || y < 0 || x >= this.S || y >= this.S) break;
        const flat = y * this.S + x;
        const c = this.cIdx(Math.floor(x / COARSE), Math.floor(y / COARSE));
        if (blocked(this.map, x, y)) {
          if (swarm) r.fine[flat] = BLOCKED;
          if (r.known[c] === UNKNOWN) r.known[c] = BLOCKED;
          if (this.explored[c] === UNKNOWN) this.explored[c] = BLOCKED;
          break;
        }
        if (swarm) r.fine[flat] = FREE;
        r.known[c] = FREE;
        this.explored[c] = FREE;
      }
    }
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i] as Target;
      const dist = Math.hypot(t.x - r.x, t.y - r.y);
      if (dist > SENSOR_RANGE) continue;
      const ang = Math.atan2(t.y - r.y, t.x - r.x);
      const diff = Math.abs(((ang - r.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff > half) continue;
      if (!hasLineOfSight(this.map, r.x, r.y, t.x, t.y)) continue;
      r.knownTargets.add(i);
      if (!t.found) {
        t.found = true;
        t.foundAt = this.time;
      }
    }
  }

  /** swarm peers exchange knowledge only inside physical radio range */
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
    return this.cIdx(Math.floor(r.x / COARSE), Math.floor(r.y / COARSE));
  }

  private isFrontier(r: Robot, cell: number): boolean {
    const central = this.config.mode === "central";
    const cx = cell % this.CS;
    const cy = (cell - cx) / this.CS;
    if (central) return this.passable[cell] === 1 && this.explored[cell] === UNKNOWN;
    // frontier = an unknown cell touching known-free space; unknown tiles are
    // optimistically treated as walkable by the local planner
    if (r.known[cell] !== UNKNOWN) return false;
    for (let d = 0; d < 4; d++) {
      const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= this.CS || ny >= this.CS) continue;
      if (r.known[this.cIdx(nx, ny)] === FREE) return true;
    }
    return false;
  }

  /** pick an unclaimed goal: a known target first, otherwise nearest frontier */
  private chooseGoal(r: Robot, id: number): { x: number; y: number; cell: number } | null {
    for (const ti of r.knownTargets) {
      const t = this.targets[ti] as Target;
      if (!t) continue;
    }
    const from = this.cellOf(r);
    const fx = from % this.CS;
    const fy = (from - fx) / this.CS;
    let best = -1;
    let bestScore = Infinity;
    for (let cell = 0; cell < this.CS * this.CS; cell++) {
      if (!this.isFrontier(r, cell)) continue;
      const cx = cell % this.CS;
      const cy = (cell - cx) / this.CS;
      const claimed = this.claims.has(cell) && this.claims.get(cell) !== id;
      const avoided = (r.avoid.get(cell) ?? 0) > this.time;
      if (avoided) continue;
      const d = Math.hypot(cx - fx, cy - fy);
      const score = d + (claimed ? 26 : 0) + this.rng.range(0, 3);
      if (score < bestScore) {
        bestScore = score;
        best = cell;
      }
    }
    if (best < 0) return null;
    const cx = best % this.CS;
    const cy = (best - cx) / this.CS;
    // pick a walkable tile inside the goal cell
    let gx = cx * COARSE + 2;
    let gy = cy * COARSE + 2;
    let found = false;
    for (let j = 0; j < COARSE && !found; j++) {
      for (let i = 0; i < COARSE && !found; i++) {
        const x = cx * COARSE + i;
        const y = cy * COARSE + j;
        if (r.fine[y * this.S + x] !== BLOCKED) {
          gx = x;
          gy = y;
          found = true;
        }
      }
    }
    return { x: gx, y: gy, cell: best };
  }

  private replan(r: Robot, id: number) {
    if (r.goalCell >= 0 && this.claims.get(r.goalCell) === id) this.claims.delete(r.goalCell);
    // a detected-but-unvisited target takes priority over frontier sweeping
    let goal = this.chooseGoal(r, id);
    if (!goal) {
      // nothing left to explore: patrol toward a random known-free cell
      const pool: number[] = [];
      for (let c = 0; c < r.known.length; c++)
        if ((this.config.mode === "central" ? this.passable[c] : r.known[c]) === 1) pool.push(c);
      if (!pool.length) {
        r.path = [];
        return;
      }
      const cell = pool[this.rng.int(0, pool.length - 1)] as number;
      const cx = cell % this.CS;
      const cy = (cell - cx) / this.CS;
      goal = { x: cx * COARSE + 2, y: cy * COARSE + 2, cell };
    }
    r.goalCell = goal.cell;
    this.claims.set(goal.cell, id);
    const fine = r.fine;
    r.path = this.pf.find(
      Math.floor(r.x),
      Math.floor(r.y),
      goal.x,
      goal.y,
      (x, y) => fine[y * this.S + x] === BLOCKED,
      this.config.mode === "central" ? 60000 : 35000,
    );
    if (!r.path.length) r.avoid.set(goal.cell, this.time + 25);
  }

  private clearance(x: number, y: number, dx: number, dy: number): number {
    for (let d = 1; d <= 4; d++) {
      if (blocked(this.map, Math.floor(x + dx * d * 0.8), Math.floor(y + dy * d * 0.8)))
        return d - 1;
    }
    return 4;
  }

  /** centralized doorway queue manager: one direction of travel at a time */
  private doorwayPermit(r: Robot, angle: number): boolean {
    const di = this.map.doorwayAt[Math.floor(r.y) * this.S + Math.floor(r.x)] as number;
    if (!di) return true;
    const lock = this.doorLock[di - 1];
    if (!lock) return true;
    const dir =
      Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle))
        ? Math.sign(Math.cos(angle))
        : Math.sign(Math.sin(angle)) * 2;
    if (lock.ttl <= 0 || lock.dir === dir) {
      lock.dir = dir;
      lock.ttl = 0.35; // shorter lock window reduces deadlocks
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

      // consume reached waypoints
      while (r.path.length) {
        const wp = r.path[0] as number;
        const wx = (wp % this.S) + 0.5;
        const wy = Math.floor(wp / this.S) + 0.5;
        if (Math.hypot(wx - r.x, wy - r.y) < 1.3) r.path.shift();
        else break;
      }

      r.replanIn -= dt;
      if (r.replanIn <= 0 || !r.path.length || r.stuckFor > 0.7) {
        if (r.stuckFor > 0.7 && r.goalCell >= 0) r.avoid.set(r.goalCell, this.time + 30);
        this.replan(r, id);
        r.replanIn = r.stuckFor > 0.7
          ? 1 + this.rng.range(0, 1)  // replan quickly after being stuck
          : 3 + this.rng.range(0, 2);
        r.stuckFor = 0;
      }

      // desired direction: next waypoint + boid separation from peers
      let dirX = Math.cos(r.heading);
      let dirY = Math.sin(r.heading);
      const wp = r.path[0];
      if (wp !== undefined) {
        const wx = (wp % this.S) + 0.5;
        const wy = Math.floor(wp / this.S) + 0.5;
        const len = Math.hypot(wx - r.x, wy - r.y) || 1;
        dirX = (wx - r.x) / len;
        dirY = (wy - r.y) / len;
      }
      let neighbors = 0;
      let sepX = 0;
      let sepY = 0;
      for (let j = 0; j < this.robots.length; j++) {
        if (j === id) continue;
        const o = this.robots[j] as Robot;
        const ddx = r.x - o.x;
        const ddy = r.y - o.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > 6.25 || d2 === 0) continue;
        const d = Math.sqrt(d2) || 0.01;
        sepX += ddx / (d * d);
        sepY += ddy / (d * d);
        neighbors++;
      }
      if (neighbors) {
        const sl = Math.hypot(sepX, sepY) || 1;
        dirX += (sepX / sl) * 0.7;
        dirY += (sepY / sl) * 0.7;
      }
      const desired = Math.atan2(dirY, dirX);

      // wall-hugging steering: keep the best clear direction near the desired one
      let bestScore = -Infinity;
      let bestAngle = desired;
      const knownGrid = this.config.mode === "central" ? this.explored : r.known;
      for (let k = -8; k <= 8; k++) {
        const a = desired + (k * Math.PI) / 12;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const clr = this.clearance(r.x, r.y, dx, dy);
        if (clr === 0) continue;
        // small bonus for directions pointing toward unexplored coarse cells
        const lx = Math.min(this.CS - 1, Math.max(0, Math.floor((r.x + dx * 4) / COARSE)));
        const ly = Math.min(this.CS - 1, Math.max(0, Math.floor((r.y + dy * 4) / COARSE)));
        const unexploredBonus = knownGrid[this.cIdx(lx, ly)] === UNKNOWN ? 0.6 : 0;
        const score =
          clr * 0.9 + Math.cos(a - desired) * 4 + this.rng.gauss() * 0.2 - Math.abs(k) * 0.05 + unexploredBonus;
        if (score > bestScore) {
          bestScore = score;
          bestAngle = a;
        }
      }
      // Fallback: full 360° sweep to escape corners and jams
      if (bestScore === -Infinity) {
        for (let k = 0; k < 24; k++) {
          const a = r.heading + (k / 24) * Math.PI * 2;
          const dx = Math.cos(a);
          const dy = Math.sin(a);
          const clr = this.clearance(r.x, r.y, dx, dy);
          if (clr > 0) {
            bestAngle = a;
            bestScore = 0;
            break;
          }
        }
      }
      if (bestScore === -Infinity) {
        // Truly jammed — spin and accumulate stuck time
        r.heading += (this.rng.next() > 0.5 ? 1 : -1) * 8 * dt;
        r.stuckFor += dt;
        this.congestionTime += dt;
        r.waiting = true;
        continue;
      }

      const delta = ((bestAngle - r.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const maxTurn = 4.5 * dt;
      r.heading += Math.max(-maxTurn, Math.min(maxTurn, delta));

      let speed = MAX_SPEED * r.speedNoise * (1 + this.rng.gauss() * 0.01);
      if (Math.abs(delta) > 1.2) speed *= 0.5;
      if (neighbors > 3) speed *= 0.75;
      if (this.config.mode === "central" && !this.doorwayPermit(r, r.heading)) speed = 0;

      const nx = r.x + Math.cos(r.heading) * speed * dt;
      const ny = r.y + Math.sin(r.heading) * speed * dt;
      let moved = 0;
      if (!blocked(this.map, Math.floor(nx), Math.floor(ny))) {
        moved = Math.hypot(nx - r.x, ny - r.y);
        // Record position history only while actually moving
        if (moved > 0.05) {
          const last = r.posHistory[0]!;
          // Push a new snapshot every ~2 tiles of travel from the previous one
          if (Math.hypot(r.x - last.x, r.y - last.y) >= 2) {
            r.posHistory.unshift({ x: r.x, y: r.y });
            if (r.posHistory.length > 20) r.posHistory.length = 20;
          }
          r.lastMoveTime = this.time;
          r.rescueCount = 0; // moving freely — reset escalation counter
        }
        r.x = nx;
        r.y = ny;
      } else {
        r.stuckFor += dt;
      }
      r.distance += moved;
      this.totalDistance += moved;
      const ratio = moved / (MAX_SPEED * dt || 1);
      r.waiting = ratio < 0.4;
      if (r.waiting) {
        this.congestionTime += dt;
        r.stuckFor += dt * 0.5;
      } else if (ratio > 0.6) {
        r.stuckFor = Math.max(0, r.stuckFor - dt);
      }

      // 3-second rescue: escalating teleport-back — walks posHistory deeper on every attempt.
      // Sends to spawn after 15 s (rescueCount >= 5) OR if rescued 5+ times near the same spot.
      if (this.time - r.lastMoveTime > 3 && this.time > 3) {
        // Check whether this rescue is firing near the same location as the last one
        const nearSameSpot = Math.hypot(r.x - r.rescueX, r.y - r.rescueY) < 3;
        if (nearSameSpot) r.sameSpotRescues++; else r.sameSpotRescues = 1;
        r.rescueX = r.x;
        r.rescueY = r.y;

        const sendToSpawn = r.rescueCount >= 5 || r.sameSpotRescues > 5;
        if (sendToSpawn) {
          r.x = this.map.spawn.x + 0.5;
          r.y = this.map.spawn.y + 0.5;
          r.rescueCount = 0;
          r.sameSpotRescues = 0;
          r.posHistory = [{ x: r.x, y: r.y }];
        } else {
          const idx = Math.min(r.rescueCount, r.posHistory.length - 1);
          const snap = r.posHistory[idx]!;
          if (!blocked(this.map, Math.floor(snap.x), Math.floor(snap.y))) {
            r.x = snap.x;
            r.y = snap.y;
          }
          r.rescueCount++;
        }
        r.path = [];
        r.goalCell = -1;
        r.stuckFor = 0;
        r.lastMoveTime = this.time;
        r.replanIn = 0;
      }
    }
  }

  /** run headless until every target is found or the time cap is reached.
   *  Pass Infinity for maxTime to run with no cap (ends when all targets found). */
  runHeadless(maxTime = 900, dt = 0.1): Metrics {
    const cap = isFinite(maxTime) ? maxTime : 86400; // safety: max 24h sim-time
    while (this.time < cap && !this.metrics.done) this.step(dt);
    return this.metrics;
  }
}

export const SENSOR = { RANGE: SENSOR_RANGE, FOV, RADIO_RANGE };
