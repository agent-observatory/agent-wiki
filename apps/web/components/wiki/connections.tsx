"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { api, useApi } from "@/lib/api";
import { Heading, Loading, Failure, Empty, CopyButton, When } from "./common";
export function Activity() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { data, error } = useApi(`/api/workspaces/${workspaceId}/publications`);
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
        <div className="space-y-5">
          {data.items.map((p: any) => (
            <section key={p.id} className="rounded-lg border p-5">
              <div className="flex flex-wrap gap-3 items-center">
                <Badge variant="outline">
                  {p.producer.type === "agent" ? "에이전트" : "직접 작성"}
                </Badge>
                <strong>{p.producer.client}</strong>
                <span className="text-xs text-muted-foreground">
                  <When value={p.created_at} />
                </span>
              </div>
              {p.reason && <p className="mt-3">{p.reason}</p>}
              <ul className="mt-3 space-y-2">
                {p.result.items.map((a: any) => (
                  <li key={a.id}>
                    <Link
                      className="underline"
                      href={`/workspaces/${workspaceId}/knowledge/${a.id}?revision=${a.revision}`}
                    >
                      {a.clientRef} · r{a.revision}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
export function Connections() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { data, error, reload } = useApi(`/api/workspaces/${workspaceId}/keys`);
  const [scope, setScope] = useState("publish");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<unknown>();
  const names: Record<string, string> = {
    read: "조회 전용",
    "source:write": "조회 + 원문 보관",
    publish: "조회 + 원문 보관 + 지식 반영",
  };
  return (
    <>
      <Heading
        title="에이전트 연결"
        description="같은 공간을 읽고 기록할 수 있는 키를 발급합니다."
      />
      <div className="mb-8 rounded-lg border p-5 space-y-3">
        <p>처음이라면 조회·원문·지식 반영 권한으로 연결하세요.</p>
        <Link className="underline" href={`/workspaces/${workspaceId}/guide`}>
          CLI 설치와 사용 순서 보기 →
        </Link>
        <div className="text-xs text-muted-foreground break-all">
          Workspace: {workspaceId}
        </div>
        <CopyButton text={workspaceId} label="Workspace ID 복사" />
      </div>
      <form
        className="mb-6 flex flex-wrap gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = String(new FormData(e.currentTarget).get("name"));
          setBusy(true);
          try {
            const k = await api(`/api/workspaces/${workspaceId}/keys`, {
              method: "POST",
              body: JSON.stringify({ name, scope }),
            });
            setToken(k.token);
            reload();
          } catch (e) {
            setFailed(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          name="name"
          aria-label="키 이름"
          placeholder="나의 에이전트"
          required
          maxLength={80}
          className="w-56"
        />
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger aria-label="키 권한" className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(names).map(([s, n]) => (
              <SelectItem key={s} value={s}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button disabled={busy}>키 발급</Button>
      </form>
      {token && (
        <div className="my-6 rounded-lg border p-5 space-y-3">
          <p>이 키는 지금 한 번만 표시됩니다. 로컬 비밀 설정에 보관하세요.</p>
          <code className="block break-all rounded bg-muted p-3">{token}</code>
          <CopyButton text={token} label="키 복사" />
          <Button variant="ghost" onClick={() => setToken("")}>
            닫기
          </Button>
        </div>
      )}
      {!!failed && <Failure error={failed} />}
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
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await api(`/api/workspaces/${workspaceId}/keys/${k.id}`, {
                      method: "DELETE",
                      body: "{}",
                    });
                    reload();
                  } catch (e) {
                    setFailed(e);
                  }
                }}
              >
                폐기
              </Button>
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
            wiki recall --project agent-wiki
          </pre>
        </section>
        <section>
          <h2 className="text-lg font-bold mb-3">
            자동 수집·정제는 준비 중입니다
          </h2>
          <p className="leading-7 text-muted-foreground">
            별도 Collector가 클라이언트의 세션 기록을 읽고, 별도 실행이
            군집화·정제하는 구조를 설계하고 있습니다. 수집을 위해 작업 대화에
            메시지를 끼워 넣거나 응답을 기다리게 하지 않습니다. 현재는 자동
            수집·정제가 없으며, 명시적으로 요청한 수동 등록·반영만 가능합니다.
          </p>
          <div className="mt-4 rounded-lg border p-4">
            계획: 별도 Collector → 원격 원문 보관 → 백그라운드 정제 → 지식 반영
          </div>
        </section>
        <section>
          <h2 className="text-lg font-bold mb-3">
            원문과 지식의 개정을 확인합니다
          </h2>
          <p className="leading-7 text-muted-foreground">
            “왜 단일 VM을 선택했지?”처럼 물으면 저장된 결정과 당시 근거를
            찾아옵니다. 웹에서는 인용한 줄과 과거 개정을 확인하고 잘못된 내용을
            정정할 수 있습니다. 저장하지 않은 대화까지 복구하지는 못합니다.
          </p>
        </section>
        <section className="rounded-lg border p-5 space-y-3">
          <h2 className="font-bold">처음 연결하기 · 한 번만 설정</h2>
          <p>저장소에서 CLI를 연결한 뒤 에이전트에 Wiki Skill을 설치합니다.</p>
          <pre className="overflow-auto rounded bg-muted p-4 text-xs leading-6">{`npm link ./packages/cli\nwiki init --project agent-wiki --workspace ${workspaceId} --tag agent-wiki\nwiki skill install\nwiki recall --project agent-wiki`}</pre>
          <p className="text-muted-foreground">
            인증 키는 에이전트 연결에서 발급해 로컬의 Git 제외 .env.local에
            WIKI_TOKEN으로 보관합니다. Skill은 조회·정제 방법을 설명하는
            지침이며 설치만으로 자동 수집을 실행하지 않습니다.
          </p>
          <Button asChild variant="outline">
            <Link href={`/workspaces/${workspaceId}/connections`}>
              연결 키 발급
            </Link>
          </Button>
        </section>
      </div>
    </>
  );
}
