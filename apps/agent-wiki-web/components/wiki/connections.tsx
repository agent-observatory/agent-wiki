"use client";
import { Pagination } from "./pagination";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { useApi } from "@/lib/api";
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
  const { data, error } = useApi(`/api/workspaces/${workspaceId}/keys`);
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
