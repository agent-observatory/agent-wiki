"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, useApi } from "@/lib/api";
import { Login } from "./shell";
import { Heading, Loading, Failure } from "./common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
            <Link
              key={s.id}
              className="flex p-6 hover:bg-accent"
              href={"/workspaces/" + s.id + "/knowledge"}
            >
              {s.name} →
            </Link>
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
