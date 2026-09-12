"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function Pagination({
  data,
  pageKey = "page",
  label = "목록",
}: {
  data?: { page: number; pageSize: number; hasNext: boolean };
  pageKey?: string;
  label?: string;
}) {
  const router = useRouter(),
    pathname = usePathname(),
    query = useSearchParams();
  if (!data) return null;
  function change(page: number, size = data!.pageSize) {
    const next = new URLSearchParams(query);
    if (size !== data!.pageSize)
      for (const key of [...next.keys()])
        if (key === "page" || key.endsWith("Page")) next.delete(key);
    next.set(pageKey, String(page));
    next.set("pageSize", String(size));
    router.push(`${pathname}?${next}`, { scroll: false });
  }
  return (
    <nav
      aria-label={`${label} 페이지`}
      className="my-4 flex flex-wrap items-center justify-end gap-2 text-sm"
    >
      <Select
        value={String(data.pageSize)}
        onValueChange={(v) => change(1, Number(v))}
      >
        <SelectTrigger className="w-28" aria-label={`${label} 표시 개수`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[25, 50, 100].map((n) => (
            <SelectItem value={String(n)} key={n}>
              {n}개씩
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        disabled={data.page <= 1}
        onClick={() => change(data.page - 1)}
        aria-label={`${label} 이전 페이지`}
      >
        <ChevronLeft />
      </Button>
      <span className="px-2 tabular-nums">{data.page}페이지</span>
      <Button
        size="sm"
        variant="outline"
        disabled={!data.hasNext}
        onClick={() => change(data.page + 1)}
        aria-label={`${label} 다음 페이지`}
      >
        <ChevronRight />
      </Button>
    </nav>
  );
}
