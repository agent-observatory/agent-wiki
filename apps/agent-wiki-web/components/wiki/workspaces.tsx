"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, useApi } from "@/lib/api";
import { Login } from "./shell";
import { Heading, Loading, Failure } from "./common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { WorkspaceDataReset } from "./workspace-data-reset";
import ThemeToggle from "@/app/theme-toggle";
export function Workspaces() {
  const { data, error, reload } = useApi("/api/workspaces");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<unknown>();
  const router = useRouter();
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
      <form
        className="mt-8 flex gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const s = await api("/api/workspaces", {
              method: "POST",
              body: JSON.stringify({ name }),
            });
            reload();
            router.push("/workspaces/" + s.id + "/knowledge");
          } catch (e) {
            setFailed(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          aria-label="새 공간 이름"
          placeholder="새 공간 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
        <Button disabled={busy}>공간 만들기</Button>
      </form>
      {!!failed && <Failure error={failed} />}
    </main>
  );
}

function WorkspaceRow({
  workspace,
}: {
  workspace: { id: string; name: string };
}) {
  const [opened, setOpened] = useState(false);
  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          className="font-medium hover:underline"
          href={"/workspaces/" + workspace.id + "/knowledge"}
        >
          {workspace.name} →
        </Link>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={opened}
          onClick={() => setOpened(!opened)}
        >
          데이터 관리
        </Button>
      </div>
      {opened && <WorkspaceDataManagement id={workspace.id} />}
    </div>
  );
}
function WorkspaceDataManagement({ id }: { id: string }) {
  const base = "/api/workspaces/" + id;
  const status = useApi(base + "/refinements?pageSize=25", 15000);
  if (status.error) return <Failure error={status.error} />;
  if (!status.data) return <Loading />;
  return (
    <WorkspaceDataReset
      base={base}
      enabled={status.data.progress.control.enabled}
      running={status.data.progress.summary.running}
      onRebuilt={status.reload}
    />
  );
}
