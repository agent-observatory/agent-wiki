"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Failure } from "./common";

export function WorkspaceDataReset({
  base,
  enabled,
  running,
  onRebuilt,
}: {
  base: string;
  enabled: boolean;
  running: number;
  onRebuilt: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [requestId, setRequestId] = useState<string>();
  const [result, setResult] = useState<{ sources: number }>();
  const blocked = enabled || running > 0;
  async function rebuild() {
    if (!requestId || busy || blocked) return;
    setBusy(true);
    setError(undefined);
    try {
      const value = await api(base + "/curation/rebuild", {
        method: "POST",
        body: JSON.stringify({ requestId }),
      });
      setResult(value);
      setRequestId(undefined);
      setOpen(false);
      onRebuilt();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-8 border-t pt-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          L1 · Raw Sources 유지 · L2 · Curation 결과와 L3 · Knowledge 초기화
        </p>
        <AlertDialog
          open={open}
          onOpenChange={(value) => {
            if (busy) return;
            if (value) {
              setRequestId((previous) => previous ?? crypto.randomUUID());
              setError(undefined);
            }
            setOpen(value);
          }}
        >
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={blocked}>
              <RotateCcw />
              L2·L3 초기화
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                이 Workspace의 L2·L3를 초기화할까요?
              </AlertDialogTitle>
              <AlertDialogDescription>
                L3 · Knowledge 전체와 L2 · Curation 결과를 지우고 L1 원문을 다시
                대기열에 넣습니다. 수동으로 작성한 지식도 삭제됩니다. 원문·수집
                위치·AI 설정·호출 이력은 유지됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="text-sm">
              초기화 후에도 정제는 중지 상태입니다. 확인한 뒤 재개해 주세요.
            </p>
            {!!error && <Failure error={error} />}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busy || blocked}
                onClick={(e) => {
                  e.preventDefault();
                  void rebuild();
                }}
              >
                {busy ? "준비 중…" : "지우고 다시 준비"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {blocked && (
        <p className="text-xs text-muted-foreground">
          자동 정제를 중지하고 진행 중인 작업이 마무리되면 사용할 수 있습니다.
        </p>
      )}
      {result && (
        <p role="status" className="text-sm">
          원문 {result.sources.toLocaleString()}개를 다시 준비했습니다. 자동
          정제를 재개하면 시작합니다.
        </p>
      )}
    </div>
  );
}
