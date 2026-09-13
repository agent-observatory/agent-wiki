"use client";
import { layerLabel } from "@/lib/layers";
import { Pagination } from "./pagination";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";

import { Badge } from "@/components/ui/badge";
import { api, useApi } from "@/lib/api";
import { Heading, Loading, Failure, Empty, CopyButton, When } from "./common";
export function Activity() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const query = useSearchParams();
  const { data, error } = useApi(
    `/api/workspaces/${workspaceId}/publications?${query}`,
  );
  return (
    <>
      <Heading
        title="반영 이력"
        description="누가 어떤 근거로 지식을 만들고 정정했는지 확인합니다."
      />
      {error ? (
        <Failure error={error} />
      ) : !data ? (
        <Loading />
      ) : !data.items.length ? (
        <Empty>아직 지식 반영 이력이 없습니다.</Empty>
      ) : (
        <div className="divide-y border-y">
          {data.items.map((p: any) => (
            <section key={p.id} className="py-3 space-y-2">
              <div className="flex flex-wrap gap-3 items-center">
                <Badge variant="outline">
                  {p.producer.type === "agent" ? "에이전트" : "직접 작성"}
                </Badge>
                <strong className="text-sm">{p.producer.client}</strong>
                <span className="ml-auto text-xs text-muted-foreground">
                  <When value={p.created_at} compact />
                </span>
              </div>
              {p.reason && <p className="text-sm break-words">{p.reason}</p>}
              <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {p.result.items.map((a: any) => (
                  <li key={a.id} className="min-w-0 max-w-full">
                    <Link
                      className="inline-flex max-w-full items-center gap-2 rounded-md hover:bg-accent/50"
                      href={`/workspaces/${workspaceId}/knowledge/${a.id}?revision=${a.revision}`}
                    >
                      <span className="min-w-0 truncate underline">
                        {a.title || "확인할 수 없는 지식"}
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        Version {a.revision}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Pagination data={data?.pagination} label="반영 이력" />
    </>
  );
}
export function Connections() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { data, error, reload } = useApi(`/api/workspaces/${workspaceId}/keys`);
  const names: Record<string, string> = {
    manage: "Workspace 관리",
    read: "조회 전용",
    "source:write": "조회 + 원문 보관",
    publish: "조회 + 원문 보관 + 지식 반영",
  };
  return (
    <>
      <Heading
        title="에이전트 연결"
        description="연결된 에이전트의 접근 권한을 확인합니다."
      />
      <div className="mb-8 rounded-lg border p-5 space-y-3">
        <p>
          작업 에이전트에는 조회 전용, Collector에는 원문 보관 권한을 CLI로
          발급합니다.
        </p>
        <Link className="underline" href={`/workspaces/${workspaceId}/guide`}>
          CLI 설치와 사용 순서 보기 →
        </Link>
        <div className="text-xs text-muted-foreground break-all">
          Workspace: {workspaceId}
        </div>
        <CopyButton text={workspaceId} label="Workspace ID 복사" />
      </div>
      <div className="divide-y border-y">
        {error ? (
          <Failure error={error} />
        ) : !data ? (
          <Loading />
        ) : (
          data.items.map((k: any) => (
            <div
              className="flex flex-wrap justify-between gap-4 py-5"
              key={k.id}
            >
              <div>
                <strong>{k.name}</strong>
                <p className="mt-2 text-xs text-muted-foreground">
                  {names[k.scope]} · <When value={k.created_at} />
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
export function Guide() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <>
      <Heading
        title="위키 사용법"
        description="필요한 지식은 에이전트에서 조회합니다. 수집·정제는 작업 대화와 분리합니다."
      />
      <div className="max-w-3xl space-y-8">
        <section>
          <h2 className="text-lg font-bold mb-3">
            필요한 결정과 근거를 조회합니다
          </h2>
          <p className="leading-7 text-muted-foreground">
            “왜 단일 VM을 선택했지?”처럼 이전 결정이 필요할 때 Wiki를
            조회합니다. 에이전트는 관련 지식과 근거를 읽고 현재 작업을
            계속합니다. 매 작업 시작마다 조회를 요구하지 않습니다.
          </p>
          <pre className="mt-4 rounded-lg bg-muted p-4 overflow-auto">
            agent-wiki recall --project agent-wiki
          </pre>
        </section>
        <section>
          <h2 className="text-lg font-bold mb-3">
            수집과 정제는 백그라운드에서 실행합니다
          </h2>
          <p className="leading-7 text-muted-foreground">
            Collector가 수집 범위에 포함된 세션 기록을 읽어 보냅니다. 원격
            Worker가 외부 AI로 정제하고 정확한 원문 근거를 검사해 지식에
            반영합니다. {layerLabel("L2")} 메뉴에서 모델, 호출 한도, 처리 상태를
            확인하세요.
          </p>
          <div className="mt-4 rounded-lg border p-4">
            Collector → 원격 원문 보관 → 백그라운드 정제 → 지식 반영
          </div>
        </section>
        <section>
          <h2 className="text-lg font-bold mb-3">
            원문과 지식의 Version을 확인합니다
          </h2>
          <p className="leading-7 text-muted-foreground">
            “왜 단일 VM을 선택했지?”처럼 물으면 저장된 결정과 당시 근거를
            찾아옵니다. 웹에서는 인용한 줄과 과거 Version을 확인합니다. 정정과
            검토는 에이전트가 CLI로 수행합니다. 저장하지 않은 대화까지
            복구하지는 못합니다.
          </p>
        </section>
        <section className="rounded-lg border p-5 space-y-3">
          <h2 className="font-bold">처음 연결하기 · 한 번만 설정</h2>
          <p>한 패키지를 설치하면 세 역할을 함께 사용할 수 있습니다.</p>
          <ul className="space-y-1 text-sm">
            <li>조회 Skill · 조회 필요성과 근거 활용을 안내하는 지침</li>
            <li>Wiki CLI · 조회·검토·편집·설정 명령</li>
            <li>Collector · 작업 대화와 독립된 백그라운드 수집</li>
          </ul>
          <pre className="overflow-auto rounded bg-muted p-4 text-xs leading-6">{`# 저장소 루트에서 설치
npm install --global ./packages/agent-wiki-client
# 사용할 프로젝트 디렉터리에서 실행
agent-wiki skill install --client codex\nagent-wiki setup --no-skill --workspace ${workspaceId} --project agent-wiki --path /absolute/project --env /absolute/project/.env.local\nagent-wiki collector start`}</pre>
          <p className="text-muted-foreground">
            키는 관리 CLI로 발급해 Git 제외 .env.local에 보관합니다. 조회는
            WIKI_TOKEN, 수집은 WIKI_COLLECTOR_TOKEN, 관리는
            WIKI_MANAGEMENT_TOKEN을 사용합니다. setup은 Skill과 연결 설정을
            준비하고, collector start가 자동 수집을 켭니다.
          </p>
          <p className="text-muted-foreground">
            Codex 지침은 현재 프로젝트의 .agents/skills/agent-wiki에 설치됩니다.
            Claude Code는 --client claude로 .claude/skills/agent-wiki에, 둘 다
            사용하면 --client all로 설치합니다.
          </p>
          <p className="text-muted-foreground">
            지침 설치만으로 검색이 자동 실행되지는 않습니다. 에이전트가 과거
            결정이 필요할 때 agent-wiki search를 실행하고, 현재 코드로 충분하면
            생략합니다. 시작·재개·컴팩션마다 호출하지 않습니다.
          </p>
          <p className="text-muted-foreground">
            기본은 전체 프로젝트·10분 주기입니다. --path로 수집 범위를 제한하고,
            agent-wiki collector start --interval 20으로 주기를 바꿉니다.
            agent-wiki collector status로 확인하거나 agent-wiki collector
            stop으로 중지합니다.
          </p>
          <Button asChild variant="outline">
            <Link href={`/workspaces/${workspaceId}/connections`}>
              연결 권한 확인
            </Link>
          </Button>
        </section>
      </div>
    </>
  );
}
