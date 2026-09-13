"use client";
import Link from "next/link";

import { useRouter } from "next/navigation";
import { api, useApi } from "@/lib/api";
import { Login } from "./shell";
import { Heading, Loading, Failure } from "./common";

import ThemeToggle from "@/app/theme-toggle";
export function Workspaces() {
  const { data, error, reload } = useApi("/api/workspaces");
  if (error && "status" in error && error.status === 401) return <Login />;
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Heading
        title="나의 공간"
        description="같은 공간 안에서 기록을 쌓고 근거를 찾아봅니다."
        action={<ThemeToggle />}
      />
      {error ? (
        <Failure error={error} />
      ) : !data ? (
        <Loading />
      ) : (
        <div className="divide-y rounded-lg border">
          {data.items.map((s: any) => (
            <WorkspaceRow key={s.id} workspace={s} />
          ))}
        </div>
      )}
    </main>
  );
}

function WorkspaceRow({
  workspace,
}: {
  workspace: { id: string; name: string };
}) {
  return (
    <Link
      className="block p-6 font-medium hover:underline"
      href={"/workspaces/" + workspace.id + "/knowledge"}
    >
      {workspace.name} →
    </Link>
  );
}
