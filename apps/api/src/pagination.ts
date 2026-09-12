import { z } from "zod";

export function pagination(raw: unknown, pageKey = "page") {
  const q = (raw ?? {}) as Record<string, unknown>;
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(1)
    .parse(q[pageKey]);
  const size = z.coerce
    .number()
    .refine((n) => [25, 50, 100].includes(n))
    .default(25)
    .parse(q.pageSize);
  return { page, size, offset: (page - 1) * size };
}
export function paged<T>(rows: T[], p: ReturnType<typeof pagination>) {
  return {
    items: rows.slice(0, p.size),
    pagination: {
      page: p.page,
      pageSize: p.size,
      hasNext: rows.length > p.size,
    },
  };
}
