import { Simulation } from "./src/sim/engine";
for (const mode of ["swarm","central"] as const) {
  const t0=Date.now();
  const s=new Simulation({robots:20,targets:6,mode,mapSeed:20260806,runSeed:1337});
  const m=s.runHeadless(400);
  console.log(mode,"elapsed",m.elapsed.toFixed(1),"found",m.found,"dist",m.totalDistance.toFixed(0),"cong",m.congestionTime.toFixed(0),"times",m.targetTimes.map(t=>t?t.toFixed(1):"-").join(","),"wall",Date.now()-t0,"ms");
}
