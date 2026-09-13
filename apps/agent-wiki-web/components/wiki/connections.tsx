"use client";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/api";
import { Loading, Failure, When } from "./common";
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
      <p className="mb-4 text-sm text-muted-foreground">
        CLI와 Collector가 공유하는 기기 연결입니다.
      </p>
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
