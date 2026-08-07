
class MinHeap {
  private ids = new Int32Array(1 << 16);
  private keys = new Float32Array(1 << 16);
  private n = 0;
  clear() {
    this.n = 0;
  }
  get size() {
    return this.n;
  }
  push(id: number, key: number) {
    if (this.n === this.ids.length) {
      const ids = new Int32Array(this.n * 2);
      const keys = new Float32Array(this.n * 2);
      ids.set(this.ids);
      keys.set(this.keys);
      this.ids = ids;
      this.keys = keys;
    }
    let i = this.n++;
    this.ids[i] = id;
    this.keys[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.keys[p] as number) <= (this.keys[i] as number)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0] as number;
    this.n--;
    if (this.n > 0) {
      this.ids[0] = this.ids[this.n] as number;
      this.keys[0] = this.keys[this.n] as number;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && (this.keys[l] as number) < (this.keys[m] as number)) m = l;
        if (r < this.n && (this.keys[r] as number) < (this.keys[m] as number)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    const i = this.ids[a] as number;
    const k = this.keys[a] as number;
    this.ids[a] = this.ids[b] as number;
    this.keys[a] = this.keys[b] as number;
    this.ids[b] = i;
    this.keys[b] = k;
  }
}

/**
 * Reusable A* over the tile grid. Scratch buffers are allocated once
 * per simulation and reused with a generation stamp instead of being cleared.
 */
export class PathFinder {
  private readonly S: number;
  private g: Float32Array;
  private stamp: Int32Array;
  private from: Int32Array;
  private closed: Uint8Array;
  private gen = 0;
  private heap = new MinHeap();

  constructor(size: number) {
    this.S = size;
    const n = size * size;
    this.g = new Float32Array(n);
    this.stamp = new Int32Array(n);
    this.from = new Int32Array(n);
    this.closed = new Uint8Array(n);
  }

  /** @param isBlocked returns true when the tile cannot be entered */
  find(
    sx: number,
    sy: number,
    gx: number,
    gy: number,
    isBlocked: (x: number, y: number) => boolean,
    maxNodes = 40000,
  ): number[] {
    const start = sy * this.S + sx;
    const goal = gy * this.S + gx;
    if (start === goal) return [];
    const gen = ++this.gen;
    this.heap.clear();
    this.stamp[start] = gen;
    this.g[start] = 0;
    this.from[start] = -1;
    this.closed[start] = 0;
    this.heap.push(start, Math.hypot(gx - sx, gy - sy));
    let expanded = 0;
    let bestNode = start;
    let bestH = Math.hypot(gx - sx, gy - sy);

    while (this.heap.size && expanded < maxNodes) {
      const cur = this.heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      expanded++;
      const cx = cur % this.S;
      const cy = (cur - cx) / this.S;
      const h = Math.hypot(gx - cx, gy - cy);
      if (h < bestH) {
        bestH = h;
        bestNode = cur;
      }
      if (cur === goal) return this.trace(goal, gen);
      for (let d = 0; d < 8; d++) {
        const dx = d < 4 ? (d === 0 ? 1 : d === 1 ? -1 : 0) : d === 4 || d === 6 ? 1 : -1;
        const dy = d < 4 ? (d === 2 ? 1 : d === 3 ? -1 : 0) : d === 4 || d === 7 ? 1 : -1;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.S || ny >= this.S) continue;
        if (isBlocked(nx, ny)) continue;
        if (dx !== 0 && dy !== 0) {
          // no corner cutting through diagonal gaps
          if (isBlocked(cx + dx, cy) || isBlocked(cx, cy + dy)) continue;
        }
        const ni = ny * this.S + nx;
        if (this.closed[ni] === gen) continue;
        const step = dx !== 0 && dy !== 0 ? 1.4142 : 1;
        const ng = (this.g[cur] as number) + step;
        if (this.stamp[ni] === gen && (this.g[ni] as number) <= ng) continue;
        this.stamp[ni] = gen;
        this.g[ni] = ng;
        this.from[ni] = cur;
        this.heap.push(ni, ng + Math.hypot(gx - nx, gy - ny) * 1.05);
      }
    }
    // partial path toward the closest reached node
    return bestNode === start ? [] : this.trace(bestNode, gen);
  }

  private trace(goal: number, gen: number): number[] {
    const out: number[] = [];
    let cur = goal;
    let guard = 0;
    while (cur >= 0 && guard++ < 200000) {
      out.push(cur);
      if (this.stamp[cur] !== gen) break;
      cur = this.from[cur] as number;
    }
    out.reverse();
    // subsample waypoints
    return out.filter((_, i) => i % 3 === 0 || i === out.length - 1);
  }
}