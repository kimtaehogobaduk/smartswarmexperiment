# 상산고등학교 영어 심화탐구활동

Build a full-stack interactive React + TypeScript + HTML5 Canvas web application styled with Tailwind CSS to simulate and compare "Swarm Intelligence" (Decentralized) vs. "Centralized Control Tower" (Global Routing) in a multi-target search mission.

### 1. MAP & VISUAL FEED ENGINE

- Map Size: Exactly 500 x 500 virtual grid tiles. Use viewport culling to render only visible tiles for high performance.

- Layout: Multi-room indoor structure with narrow 2-tile doorways and dense (20% floor space) furniture assets (beds, closets, desks, crates) blocking vision and movement.

- Overhead Camera Aesthetic: Dark tactical C2 interface styled like a "LIVE TRANSMISSION CAM_01" feed.

  * Real-time timestamp, green/tinted HUD overlay, dynamic robot FOV cones.

  * Camera Controls: Mouse drag/touch panning, scroll-to-zoom (+/-), and a "Reset Viewport" button.

### 2. ROBOT & TARGET RULES

- Dimensions & Speed: Robots occupy exactly 1 tile and travel at a maximum speed of 2.0 tiles per second.

- Bottleneck Spawn: All robots spawn stacked/clustered inside a single 2x2 start tile area, forcing bottleneck queue handling immediately.

- Configurable Parameters (Sidebar):

  * Number of Robots (1 to 100)

  * Number of Targets (1 to 20)

  * Mode Selector: Swarm Intelligence vs. Centralized Tower

  * Sim Speed Controls: Play / Pause / Step / 1x / 2x / 5x / 10x

### 3. STOCHASTIC REALISM ENGINE

- Non-deterministic Physics: Apply slight Gaussian noise to robot movement vectors (±3% speed jitter, sensor angle variance) so that NO two runs produce identical results, even with identical settings.

### 4. ALGORITHMS TO IMPLEMENT

A. Swarm Mode:

   - No global map access. Local 360/cone sensors only.

   - Boid separation for collision avoidance in tight doorways.

   - Wall-following and local frontier exploration around furniture.

   - Target knowledge shared only when within physical radio range of peers.

B. Centralized Mode:

   - Central server holds the full map and calculates optimal routes using global A* pathfinding.

   - Doorway queue manager to schedule robot entry through choke points and prevent gridlock.

### 5. FILE MANAGEMENT & RUN HISTORY

- Save/Load Projects: Ability to save simulation presets (map structure, seeds, parameters) to local storage or export/import as JSON files.

- History Manager: A sidebar listing past saved runs, allowing users to load and compare historical performance metrics.

### 6. BATCH RUNNER & ANALYTICS DASHBOARD

- Headless Multi-Sim Mode: A dedicated panel allowing the user to execute 1 to 100 simulation runs in the background (disabling canvas rendering for maximum execution speed).

- Per-Target Timestamp Logging: Record the exact elapsed time (in seconds) when Target #1, Target #2, ... Target #M is spotted.

- Statistical Output:

  * Table displaying the average time to find each individual target across batch runs (e.g., "Target 1 Avg: 14.2s", "Target 2 Avg: 31.8s").

  * Standard deviation / variance indicators showing system consistency.

  * Charts comparing Swarm vs. Centralized metrics (Total Distance, Completion Time, Congestion Delays).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/63090cad-06dc-43c8-8509-ed4381377361).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
