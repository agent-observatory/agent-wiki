"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Check, ChevronRight } from "lucide-react";
import { errorText } from "@/lib/api";
import { formatWhen } from "@/lib/time";
// Collapsed by default: these hold detail lists further down the page that
// are secondary to the summary cards/table above them. `id` must be stable
// and unique per section on the page — it's the localStorage key, so the
// open/closed choice is remembered per viewer, per section, across visits.
export function Section({
  id,
  title,
  defaultOpen = false,
  action,
  children,
}: {
  id: string;
  title: React.ReactNode;
  defaultOpen?: boolean;
  // Rendered next to the title, inside the clickable <summary>; the wrapper
  // stops click propagation so pressing it does not also toggle the section.
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const storageKey = `agent-wiki:section:${id}`;
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) setOpen(stored === "1");
    } catch {
      // Private browsing or blocked storage: keep defaultOpen.
    }
  }, [storageKey]);
  return (
    <details
      className="mt-8 group"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        try {
          localStorage.setItem(storageKey, next ? "1" : "0");
        } catch {
          // Best-effort only; nothing to fall back to for persistence.
        }
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold">
        <span className="flex items-center gap-2">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
          {title}
        </span>
        {action && (
          <span onClick={(e) => e.stopPropagation()}>{action}</span>
        )}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
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
export function When({
  value,
  compact = false,
}: {
  value: string;
  compact?: boolean;
}) {
  const formatted = formatWhen(value);
  if (compact)
    return (
      <time
        dateTime={value}
        title={formatted}
        className="whitespace-nowrap tabular-nums"
      >
        {formatted}
      </time>
    );
  return <time dateTime={value}>{formatted}</time>;
}
