# 결정 리니지 · 작은 추론 비교

2026-09-13, Alibaba Singapore `deepseek-v4-flash`. 호출 전에 [기대 결과](expected.json)를 고정하고 같은 [합성 입력](input.json)·[Worker 지침](prompt.txt)을 사용했다. 실제 사용자 원문이나 운영 정제 큐는 사용하지 않았다.

| 설정 | 결과 | 입력 | 출력 전체 | 그중 추론 | 지연 |
| --- | --- | ---: | ---: | ---: | ---: |
| OFF | 변경 관계·범위 구분, 과거 상태 표기 보정 필요 | 874 | 1,373 | 미보고 | 12.8초 |
| ON · budget 1,024 | `["quote"]` 반환, 출력 계약 실패 | 874 | 1,028 | 1,024 | 12.9초 |
| ON · budget 4,096 | `finish_reason=length`, JSON 잘림 | 874 | 4,096 | 3,813 | 45.6초 |
| ON · high · budget 미지정 | A → B·로컬 범위 보존, 과거 발언으로 회귀하지 않음 | 874 | 3,591 | 2,804 | 37.0초 |

**현재 선택은 단일 호출 + 추론 ON(high)**이다. 좁은 추론 예산을 강제하지 않고 전체 생성 상한을 유지한다. ON 실패 2건으로 추론 자체가 부적합하다고 결론 내리지 않았다. 첫 두 실행의 `max_completion_tokens`는 4,096, 뒤 두 실행은 8,192다. budget 4,096 실행은 요청한 전체 상한 이전에 4,096 출력에서 중단됐으며 공급자 내부 원인은 확인하지 않았다. 설정이 다른 추가 진단이므로 통제된 대규모 성능 비교로 해석하지 않는다.

- OFF와 high 모두 NVIDIA → Alibaba 대체 근거와 별도 로컬 NVIDIA 결정을 만들었다. high는 회고 문장을 별도 관찰로 중복 생성하지 않았고 초기 주장 상태도 계약에 맞았다.
- high는 ExampleCloud 검토 의견을 별도 지식으로 남기지 않았다. 변경 이유는 정정 인용에 있고 주장 문장에는 생략했다. 한 사례로 모든 검토 의견·변경 이유의 추출 완전성을 보장하지 않는다.
- OFF는 이전 주장에 `superseded`와 대체 관계를 함께 출력했다. 서버는 역할·대상·범위가 일치하는 명시적 관계가 있을 때만 저장 상태를 정규화한다. 원래 응답은 보존한다.
- 캡처 응답의 Worker→근거 검증→로컬 PostgreSQL 반영을 회귀 테스트로 확인한다. API 테스트는 네 결정의 관계, 기본 현재 조회, 이력 조회, 불변 근거, 잘못된 참조의 원자적 거부를 확인한다. 운영 원문에 대한 실제 정제·사용자 검토 완료와 구분한다.

총 **4회, 입력 3,496 / 출력 10,088토큰**. 출력에 보고된 추론 7,641토큰이 포함된다. 캐시 입력 1,536토큰은 입력의 부분 집합이다. 이후 회귀 검사는 저장된 합성 응답을 재생하며 모델을 다시 호출하지 않는다.

[OFF 원래 응답](result.json) · [ON 1,024](result-thinking.json) · [ON 4,096](result-thinking-4096.json) · [ON high](result-thinking-high.json)

`run.mjs`는 명시적으로 실행하는 실험이며 실행별 `.attempt`가 중복 호출을 막는다. 운영 Wiki의 설정·키·큐를 변경하지 않는다. 키와 원격 호스트는 결과에 기록하지 않으며 추론 본문도 보관하지 않는다.

파라미터 기준: [Alibaba Chat API](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions), [DeepSeek API](https://www.alibabacloud.com/help/en/model-studio/deepseek-api). `max_completion_tokens`는 추론과 답변을 포함한다. DeepSeek의 강도는 `high/max`이며 단계 수·추론 활성화·강도·출력 한도는 별도 설정이다.
