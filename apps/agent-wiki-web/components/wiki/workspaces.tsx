"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/api";
import { EntryFrame, GitHubLogin } from "./entry";
import { Loading, Failure, Empty } from "./common";

type Workspace = { id: string; name: string };

export function Workspaces() {
  const router = useRouter();
  const { data, error } = useApi<{ items: Workspace[] }>("/api/workspaces");
  const workspaceId = data?.items[0]?.id;
  const loginRequired = error && "status" in error && error.status === 401;

  useEffect(() => {
    if (workspaceId) router.replace(`/workspaces/${workspaceId}/knowledge`);
  }, [router, workspaceId]);

  return (
    <EntryFrame>
      {loginRequired ? (
        <GitHubLogin />
      ) : error ? (
        <Failure error={error} />
      ) : data && !workspaceId ? (
        <Empty>등록된 Workspace가 없습니다.</Empty>
      ) : (
        <Loading />
      )}
    </EntryFrame>
  );
}
