"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/lib/api";
import { Loading, Failure, Empty, When } from "./common";
import { Pagination } from "./pagination";
export function KnowledgeHistory() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const query = useSearchParams();
  const { data, error } = useApi(
    `/api/workspaces/${workspaceId}/publications?${query}`,
  );
  return (
    <>
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
