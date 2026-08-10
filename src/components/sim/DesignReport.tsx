import {
  MAP_SIZE_MIN,
  MAP_SIZE_MAX,
  MAP_SIZE_STEP,
  DENSITY_MIN,
  DENSITY_MAX,
  COARSE,
} from "@/sim/map";
import { MAX_SPEED, SENSOR } from "@/sim/engine";

const FOV_DEG = Math.round((SENSOR.FOV * 180) / Math.PI);

/** Full system-design report for the simulation environment. */
export function DesignReport() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 pb-16 text-[13px] leading-relaxed">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold text-hud">
          시뮬레이션 환경 및 시스템 설계 보고서
        </h1>
        <p className="text-muted-foreground">
          Smart Swarm(분산 군집 지능) vs. Control Tower(중앙 집중 전역 라우팅) 다중
          목표 탐색 시뮬레이터 — 알고리즘 설계 조건, 탐색 맵 복잡도 설정, 탐색 대상
          탐지 기준 및 측정 지표 정의
        </p>
      </header>

      <Section n="1" title="연구 목적과 실험 설계">
        <p>
          동일한 실내 환경·동일한 로봇 수·동일한 목표 배치 조건에서 통신 범위 내
          국소 정보만 사용하는 <b>분산 군집(SWARM)</b> 전략과, 전역 지도와 전역
          할당을 사용하는 <b>중앙 관제(TOWER)</b> 전략의 탐색 성능을 정량 비교한다.
        </p>
        <ul>
          <li>독립변수: 제어 구조(SWARM/TOWER), 맵 크기, 장애물 비율, 로봇 수, 목표 수</li>
          <li>
            종속변수: 전체 임무 완료 시간, 목표별 최초 탐지 시각, 총 이동 거리,
            혼잡 시간(robot·s), 완주율
          </li>
          <li>
            통제변수: 동일 시드(mapSeed/runSeed) → 두 모드가 완전히 동일한 맵·동일한
            초기 배치·동일한 잡음 시퀀스에서 실행된다.
          </li>
        </ul>
      </Section>

      <Section n="2" title="시간·공간 이산화 (알고리즘 설계 조건)">
        <ul>
          <li>
            <b>시간 적분</b>: 고정 스텝 오일러 적분, dt = 0.05 s(실시간 뷰) / 0.1 s(헤드리스
            배치). 화면 프레임과 물리 스텝을 분리해 가속(1×–150×) 시에도 결과가
            프레임레이트에 의존하지 않는다.
          </li>
          <li>
            <b>공간 격자</b>: 정사각 타일 격자 {MAP_SIZE_MIN}×{MAP_SIZE_MIN} ~{" "}
            {MAP_SIZE_MAX}×{MAP_SIZE_MAX} (스텝 {MAP_SIZE_STEP}). 타일 1칸 = 로봇 직경
            기준 단위 길이.
          </li>
          <li>
            <b>이중 해상도</b>: 충돌·경로계획은 미세 타일 격자, 탐색 의사결정(프론티어
            선정·지식 공유)은 {COARSE}×{COARSE} 타일을 묶은 조립 격자에서 수행한다.
            이는 500×500 = 250,000 셀 규모에서 의사결정 비용을 1/25로 줄이기 위한 설계다.
          </li>
          <li>
            <b>난수</b>: 시드 기반 결정론적 PRNG(mulberry 계열) + Box–Muller 가우시안.
            동일 시드 → 동일 결과(재현성), 시드 변경 → 통계적 변동성 확보.
          </li>
        </ul>
      </Section>

      <Section n="3" title="탐색 맵 생성과 복잡도 설정">
        <ul>
          <li>
            <b>구획 분할(BSP)</b>: 전체 영역을 재귀 이분할하여 방을 생성한다. 최소 방
            변 길이는 max(30, 0.088·S) 타일로 맵 크기에 비례해 스케일되므로, 100×100과
            500×500이 "비슷한 실내 복잡도"를 갖도록 정규화된다.
          </li>
          <li>
            <b>내벽과 출입구</b>: 분할 경계마다 벽을 세우고 폭 1–2 타일의 문(doorway)을
            하나만 남긴다. 문은 병목(bottleneck)으로 등록되어 혼잡 측정과 중앙 관제의
            통행 허가 큐에 사용된다.
          </li>
          <li>
            <b>장애물 밀도</b>: 사용자 조절 가능 {Math.round(DENSITY_MIN * 100)}–
            {Math.round(DENSITY_MAX * 100)} %. 각 방 내부 바닥 면적 대비 가구
            (bed/closet/desk/crate) 점유 면적 비율로 정의하며, 가구는 벽에서 최소 여유를
            두고 배치된다.
          </li>
          <li>
            <b>모서리 라운딩 후처리</b>: 볼록 모서리 타일(직교 두 방향이 바닥인 장애물
            타일)을 1칸 깎아 원형 충돌 반경을 가진 로봇이 모서리에 걸리는 현상을 제거한다.
            외곽 2타일 경계벽은 보존되어 영역이 항상 폐쇄된다.
          </li>
          <li>
            <b>연결성 보장</b>: 생성 직후 시작 지점에서 flood fill을 수행해 도달 불가
            영역을 벽으로 봉인한다. 따라서 모든 목표는 원리상 도달 가능하며, 미탐지는
            전적으로 탐색 전략의 성능 차이로 해석된다.
          </li>
        </ul>
      </Section>

      <Section n="4" title="로봇 모델과 센서·통신 규격">
        <ul>
          <li>최대 속도 {MAX_SPEED} 타일/s, 개체별 속도 계수 잡음(가우시안)으로 이질성 부여</li>
          <li>
            시야: 반경 {SENSOR.RANGE} 타일, 화각 {FOV_DEG}°, 30개 레이캐스트로 가시선
            (LOS) 판정 — 벽·가구에 막히면 그 뒤는 관측되지 않는다.
          </li>
          <li>센서 편향(sensorBias): 개체별 각도 오차를 넣어 완전 이상적 관측을 배제</li>
          <li>
            통신: SWARM 모드에서 반경 {SENSOR.RADIO_RANGE} 타일 이내 로봇끼리만 지도·목표
            정보를 교환한다(union-find 클러스터 단위 1회 병합, O(N·cells)).
          </li>
          <li>
            충돌 회피: 이웃 분리(separation) + 여유 공간(clearance) 기반 조향, 정지 감지
            시 목표 셀 블랙리스트 및 재계획.
          </li>
        </ul>
      </Section>

      <Section n="5" title="탐색 알고리즘 — 두 모드의 시스템적 차이">
        <ul>
          <li>
            <b>지도 소유권</b>: TOWER는 모든 로봇이 전역 진리 지도(ground-truth)를 참조.
            SWARM은 로봇마다 개인 점유 격자(unknown/free/blocked)를 보유하며 진리 지도에
            접근하지 못한다.
          </li>
          <li>
            <b>정보 지연</b>: TOWER는 지연 0·전역 공유. SWARM은 무선 도달 시점에만 병합되어
            정보가 국소적·시간 지연을 갖는다.
          </li>
          <li>
            <b>목표 선정</b>: 둘 다 프론티어(미지 셀에 접한 자유 셀) 기반이지만, TOWER는
            전역 비용 행렬로 로봇–프론티어 중복 없는 전역 할당을 수행하고, SWARM은 각
            로봇이 "낙관적 가정(미지 = 통행 가능)"으로 국소 최적 프론티어를 독립 선택한다.
          </li>
          <li>
            <b>경로 계획</b>: 공통 A*(8방향, 노드 상한 6만, 웨이포인트 서브샘플링).
            TOWER는 실제 지도로 계획해 항상 실현 가능한 경로를 얻고, SWARM은 믿음 지도로
            계획하므로 벽에 부딪히며 학습·재계획한다.
          </li>
          <li>
            <b>혼잡 관리</b>: TOWER는 문 단위 통행 허가 큐(신호등)로 병목을 직렬화.
            SWARM은 중앙 조정 없이 국소 회피만 사용한다.
          </li>
        </ul>
      </Section>

      <Section n="6" title="탐색 대상(목표) 배치 및 탐지 기준">
        <ul>
          <li>
            <b>배치 규칙</b>: 도달 가능한 바닥 타일 중 균등 표본. 목표 간 최소 유클리드
            거리 30 타일, 로봇 스폰 지점과도 최소 이격을 강제한다(작거나 밀집된 맵에서는
            제약을 점진적으로 완화하여 항상 배치가 성립하도록 한다).
          </li>
          <li>
            <b>탐지 판정</b>: (i) 로봇–목표 거리 ≤ 센서 반경 {SENSOR.RANGE}, (ii) 목표가
            로봇 진행 방향 기준 화각 {FOV_DEG}° 내부, (iii) 벽·가구에 가리지 않은
            가시선(LOS) 성립 — 세 조건이 동시에 만족되는 최초 시각을 그 목표의
            foundAt으로 기록한다. 한 번 탐지된 목표는 재탐지되지 않는다.
          </li>
          <li>
            <b>임무 종료</b>: 모든 목표가 탐지되면 완료(done). 배치 실행에서는 시간 상한
            (기본 300 s, 상한 해제 옵션 가능) 도달 시 미완료로 종결하고 완주율에 반영한다.
          </li>
        </ul>
      </Section>

      <Section n="7" title="측정 지표 정의">
        <ul>
          <li><b>Completion time</b>: 마지막 목표 탐지 시각(초). 미완료 런은 시간 상한값.</li>
          <li><b>Per-target time</b>: 목표 i의 최초 탐지 시각. 평균·표준편차·최소·최대·탐지율 집계.</li>
          <li><b>Total distance</b>: 전체 로봇 이동 거리 합(타일). 에너지 소비 대리 지표.</li>
          <li>
            <b>Congestion</b>: 이동 명령이 있으나 실제 변위가 기대 변위에 크게 미달한
            상태의 누적 로봇·초. 문 앞 정체/상호 차단을 정량화.
          </li>
          <li><b>Completion rate</b>: 시간 상한 내 전 목표 탐지에 성공한 런의 비율.</li>
        </ul>
      </Section>

      <Section n="8" title="배치 실험(무작위화) 설계">
        <p>
          BATCH &amp; ANALYTICS 탭은 렌더링 없이 헤드리스로 실행하며, 맵마다 두 모드를
          동일 조건으로 교차 실행한다(paired design). 무작위화 옵션은 맵 크기, 장애물 비율,
          로봇 수, 목표 수이며, 각 맵에서 두 모드는 항상 같은 값을 공유해 비교 공정성이
          유지된다. 결과는 목표별 평균 ± σ 막대그래프와 지표 비교 차트, 표로 제공되고
          PDF 내보내기 및 히스토리 보관이 가능하다.
        </p>
      </Section>

      <Section n="9" title="가정과 한계">
        <ul>
          <li>2D 평면·정적 환경(이동 장애물 없음), 로봇 고장·배터리 소모 미모델링</li>
          <li>통신은 거리 기반 이상적 링크(패킷 손실·대역 제한 없음)</li>
          <li>TOWER는 통신 지연 0을 가정하므로 중앙 집중 방식의 상한 성능을 나타낸다</li>
          <li>목표는 정지 상태이며 탐지 후 회수/운반 과정은 범위 밖</li>
        </ul>
      </Section>
    </article>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="panel-frame space-y-2 p-4">
      <h2 className="text-hud text-sm font-semibold">
        {n}. {title}
      </h2>
      <div className="space-y-2 [&_b]:text-hud [&_li]:ml-4 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </section>
  );
}
