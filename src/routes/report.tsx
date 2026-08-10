import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DesignReport } from "@/components/sim/DesignReport";

export const Route = createFileRoute("/report")({
  head: () => ({
    meta: [
      { title: "시뮬레이션 시스템 설계 보고서 — Swarm vs Control Tower" },
      {
        name: "description",
        content:
          "다중 로봇 탐색 시뮬레이터의 알고리즘 설계 조건, 맵 복잡도 설정, 목표 탐지 기준과 측정 지표를 정리한 상세 설계 보고서.",
      },
      { property: "og:title", content: "시뮬레이션 시스템 설계 보고서" },
      {
        property: "og:description",
        content:
          "격자 이산화, BSP 맵 생성, 센서·통신 규격, 분산/중앙 탐색 알고리즘과 탐지 기준을 담은 보고서.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Link to="/" className="label-hud flex items-center gap-1 hover:text-hud">
          <ArrowLeft className="size-3.5" /> SIMULATOR
        </Link>
        <h1 className="text-sm font-semibold text-hud">시스템 설계 보고서</h1>
        <span className="text-[10px] tracking-wide text-muted-foreground">made by smartlab</span>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          <DesignReport />
        </div>
      </ScrollArea>
    </div>
  );
}
