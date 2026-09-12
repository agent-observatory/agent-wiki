"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Check } from "lucide-react";
import { errorText } from "@/lib/api";
export function Loading() {
  return (
    <div className="space-y-4" aria-label="불러오는 중">
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}
export function Failure({ error }: { error: unknown }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 p-4 text-destructive"
    >
      {errorText(error)}
    </div>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed py-16 px-6 text-center text-muted-foreground">
      {children}
    </div>
  );
}
export function Heading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-2 text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </header>
  );
}
export function CopyButton({
  text,
  label = "복사",
}: {
  text: string;
  label?: string;
}) {
  const [copied, set] = useState(false);
  const [failed, fail] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            set(true);
            fail(false);
          } catch {
            fail(true);
          }
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "복사됨" : label}
      </Button>
      {!!failed && <span role="alert">복사에 실패했습니다.</span>}
    </span>
  );
}
export function When({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}
