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
export function useApi<T = any>(url: string | null, refreshMs = 0) {
  const [state, set] = useState<{
    url: string | null;
    data?: T;
    error?: Error;
  }>({ url: null });
  const [version, bump] = useState(0);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    set((previous) =>
      previous.url === url ? { ...previous, error: undefined } : { url },
    );
    api<T>(url, { signal: controller.signal })
      .then((data) => set({ url, data }))
      .catch((error) => {
        if (!controller.signal.aborted) set({ url, error });
      });
    return () => controller.abort();
  }, [url, version]);
  useEffect(() => {
    if (!url || !refreshMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") bump((x) => x + 1);
    }, refreshMs);
    return () => clearInterval(timer);
  }, [url, refreshMs]);
  return {
    ...(state.url === url ? state : {}),
    reload: () => bump((x) => x + 1),
  };
}
const messages: Record<string, string> = {
  AI_FREE_QUOTA_EXHAUSTED:
    "무료 할당량을 모두 사용했습니다. 연결 설정을 확인하세요.",
  USE_CURATION_CONTROL: "정제 시작·중지는 Curation의 제어 버튼을 사용하세요.",
  AI_ENDPOINT_NOT_ALLOWED:
    "허용된 API 호스트를 입력하세요. 추가 호스트는 서버에서 허용해야 합니다.",
  CURATION_PAUSE_REQUIRED: "자동 정제를 먼저 중지해 주세요.",
  CURATION_STILL_RUNNING: "진행 중인 정제가 마무리된 뒤 다시 시도해 주세요.",
  AI_KEY_REQUIRED: "이 연결에 사용할 API 키를 입력해 주세요.",
  AI_TEST_TIMEOUT: "응답 대기 시간이 지났습니다. 잠시 후 다시 테스트해 주세요.",
  AI_TEST_INVALID_RESPONSE: "모델이 예상한 Hello 응답을 반환하지 않았습니다.",
  AI_CONNECTION_FAILED: "AI 연결에 실패했습니다. 주소와 키를 확인해 주세요.",
  AI_REASONING_NOT_SUPPORTED: "이 모델에서 지원하는 추론 설정을 선택해 주세요.",
  AI_FALLBACK_REASONING_NOT_SUPPORTED:
    "2번 모델이 현재 추론 설정을 지원하지 않습니다. 같은 계열 모델을 지정하거나 추론 설정을 바꿔 주세요.",
  AI_ENCRYPTION_NOT_CONFIGURED: "서버의 API 키 암호화 설정이 필요합니다.",
  REVISION_CONFLICT:
    "다른 변경이 먼저 저장됐습니다. 최신 Version을 다시 열어 비교하세요.",
  EVIDENCE_MISMATCH: "인용 내용이 원문의 지정한 줄과 다릅니다.",
  CLAIM_TARGET_ALREADY_RETIRED:
    "이미 대체되거나 철회된 주장입니다. 현재 결정을 확인하세요.",
  CLAIM_TARGET_VERSION_CHANGED:
    "참조한 주장의 Version이 바뀌었습니다. 최신 근거를 다시 확인하세요.",
  CLAIM_SCOPE_MISMATCH:
    "같은 대상과 적용 범위의 주장만 변경 관계로 연결할 수 있습니다.",
  CLAIM_RELATION_EVIDENCE_REQUIRED:
    "변경 관계를 뒷받침하는 원문 근거가 필요합니다.",
  DECISION_AUTHORITY_MISMATCH: "AI 해석으로 사용자 결정을 취소할 수 없습니다.",
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
