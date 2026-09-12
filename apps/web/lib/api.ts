"use client";
import { useEffect, useState } from "react";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(response.status, data.error ?? "REQUEST_FAILED");
  return data;
}
export function useApi<T = any>(url: string | null) {
  const [state, set] = useState<{
    url: string | null;
    data?: T;
    error?: Error;
  }>({ url: null });
  const [version, bump] = useState(0);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    set({ url });
    api<T>(url, { signal: controller.signal })
      .then((data) => set({ url, data }))
      .catch((error) => {
        if (!controller.signal.aborted) set({ url, error });
      });
    return () => controller.abort();
  }, [url, version]);
  return {
    ...(state.url === url ? state : {}),
    reload: () => bump((x) => x + 1),
  };
}
const messages: Record<string, string> = {
  REVISION_CONFLICT:
    "다른 변경이 먼저 저장됐습니다. 최신 개정을 다시 열어 비교하세요.",
  EVIDENCE_MISMATCH: "인용 내용이 원문의 지정한 줄과 다릅니다.",
  CLAIM_NOT_IN_CONTENT: "근거를 연결한 주장이 수정된 본문에 없습니다.",
  NOT_FOUND: "자료가 없거나 접근할 수 없습니다.",
  INVALID_INPUT: "입력 형식을 확인해 주세요.",
  LOGIN_REQUIRED: "로그인이 필요합니다.",
  SESSION_EXPIRED: "세션이 만료됐습니다. 다시 로그인해 주세요.",
  SOURCE_DELETED: "삭제한 원문입니다.",
  IDEMPOTENCY_CONFLICT: "같은 반영 키에 다른 내용이 있습니다.",
};
export function errorText(e: unknown) {
  return e instanceof ApiError
    ? (messages[e.code] ?? `요청에 실패했습니다. ${e.code}`)
    : "연결에 실패했습니다. 다시 시도해 주세요.";
}
