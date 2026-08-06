# 상산고등학교 영어 심화탐구활동 — Swarm vs. Centralized Simulation

A full-stack interactive React + TypeScript web application that simulates and compares **Swarm Intelligence** (decentralized) vs. **Centralized Control Tower** (global A* routing) in a multi-target search mission on a 500×500 indoor grid map.

## Stack

- **Framework**: React 19 + TanStack Start (SSR) + TanStack Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Build tool**: Vite 8 (via `@lovable.dev/vite-tanstack-config`)
- **Package manager**: Bun
- **Charts**: Recharts
- **UI components**: Radix UI + shadcn/ui

## How to run

```bash
bun install   # install dependencies
bun run dev   # start dev server on port 5000
```

The workflow **"Start application"** (`bun run dev`) is configured and starts automatically.

## Key features

- 500×500 virtual grid with multi-room indoor map, furniture obstacles, and narrow doorways
- Tactical dark HUD aesthetic with live camera feed (panning, zoom, reset viewport)
- Configurable robots (1–100), targets (1–20), simulation speed (1×/2×/5×/10×), Play/Pause/Step
- **Swarm mode**: local sensors, boid collision avoidance, radio-range knowledge sharing
- **Centralized mode**: global A* pathfinding, doorway queue manager
- Stochastic physics (Gaussian noise) for non-deterministic runs
- Batch runner (up to 100 headless runs), per-target timestamp logging, statistical dashboard
- Save/load simulation presets via localStorage or JSON export/import
- Run history sidebar for comparing past sessions

## Lovable compatibility

This project was originally built with [Lovable](https://lovable.dev/projects/63090cad-06dc-43c8-8509-ed4381377361). The `@lovable.dev/vite-tanstack-config` package manages plugin setup. To continue editing in Lovable, push changes to the `main` branch on GitHub.

The `vite.config.ts` passes `server: { host: "0.0.0.0", port: 5000, allowedHosts: true }` for Replit compatibility; the Lovable sandbox overrides port to 8080 automatically via its own sandbox detection.

## User preferences

- Keep the project structure and Lovable-compatible stack intact when making changes.
