# 구현·배포 현황

현재 상태를 먼저 읽고, 이전 수치·명령은 아래의 당시 검증 기록으로만 참고한다. 설계·명령의 기준은 [아키텍처](architecture.md)와 [사용법](client-and-api.md)이다.

| 구분 | 확인한 상태 |
| --- | --- |
| 원격 앱 | 단일 OCI VM · K3s, main → Actions → GHCR → SSH → Kubernetes |
| 로컬 패키지 | 0.7.5 설치 완료 · 단계적 조회·검토·관리 CLI·Skill·Collector 통합 · 조회 응답 `unmatchedTerms` |
| 웹 | Knowledge → Sources → 설정. 정제 중지·재개는 웹/CLI, 수정·검토 확정은 CLI, AI 연결은 웹/CLI |
| 수집 | Codex·Claude 모두 Agent Wiki 프로젝트만 · 10분 · Claude는 2026-09-14 사용자 지시로 활성화 |
| 정제 | BYOK Alibaba DeepSeek Flash · 사용자 중지 Version 67 · 1번 `deepseek-v4-flash-0731` · 2번 모델 `deepseek-v4.1-flash` · `maxInputTokens` 16,000 · `timeoutSeconds` 두 슬롯 다 900초(사용자 지정) · 출력 상한 제공자 기본값 · 시작·중지는 사용자 명령 |
| 지식 | 초기화 후 Wiki Page 4개 생성·Version 증가 확인. 원문·성공 처리 범위 유지 |
| 비용·오류 알림 | [OCI 기본 오류 알림](#oci-기본-오류-알림) · 비용 요약은 Actions |

## 비용 정기 요약 시각을 09:13 → 10:00 한국 시각으로 변경

2026-09-15. 09:13 KST 예약이 9/13·9/14·9/15 사흘 연속 GitHub에서 발동 자체가 안 됐다(스킵). 어제 고친 "늦게라도 하루 한 번 보완" 로직은 정상 동작했지만, 스킵 이후 다음 점검 기회(15:13 KST)가 오기 전까지는 그날 요약이 안 오는 것도 사실이었다. 사용자 요청으로 목표 시각을 10:00 KST로 옮겼다: `.github/workflows/cost-monitor.yml`의 정기 요약 cron을 `13 1 * * *`(01:13 UTC)로, `scripts/monitoring/cost_report.py`의 `daily_due` 기준을 10:00으로 바꿨다. 분 단위를 정각(`:00`)이 아니라 `:13`으로 유지한 이유는 그대로다 — GitHub 자체가 매시 정각 직후는 지연 가능성이 더 크다고 안내한다. 이상 점검 cron(03:13·09:13·15:13·21:13 KST)은 그대로 둔다.

같은 날, 9/15 09:13 요약도 스킵된 것을 확인하고 `workflow_dispatch`(mode=daily)로 즉시 수동 발송해 43초 만에 `daily_summary=delivered`로 Slack 전달을 확인했다([실행 34925290312](https://github.com/agent-observatory/agent-wiki/actions/runs/34925290312)).

## subject·scope 정의 · 어휘 재추출 · Knowledge 주제별 묶음 · 그림에 자료구조·판단 주체 표시

2026-09-16. 운영 화면에서 "묶음이 23개나 되는데 너무 많은 분류 아니냐"는 질문에서 시작해, 원인을 재고 고친 뒤 L2·L3를 전체 재추출했다.

측정한 사실(인프라 페이지 Version 46, 재추출 전):

| 항목 | 값 |
| --- | --- |
| 주장 | 212개 (current 98 · unconfirmed 59 · proposed 29 · superseded 18 · conflicted 8) |
| 관계 | 25개 |
| current의 (subject, scope) 묶음 | 23개, 이 중 15개가 주장 1개 |
| 가장 큰 묶음 | `infrastructure`/`curation` 53개 (current의 54%) |
| `scope='curation'` | current 98개 중 68개 |
| `subject`가 페이지의 topic_key와 같음 | current 98개 중 62개 |
| `(type, state)`가 `(unconfirmed, unconfirmed)` | 212개 중 59개 |

- 원인은 분류가 많아서가 아니라 **분류 기준이 없어서**였다. 프롬프트에 `subject`·`scope`의 정의가 한 줄도 없었고 JSON 예시의 `"subject":"ai-provider","scope":"curation"`가 유일한 안내였다. 예시값이 그대로 출력에 샜다.
- 이 두 값은 표시용이 아니라 **관계 게이트**다. `storeClaimRelations`가 양끝의 subject·scope 불일치를 거부하고(`CLAIM_SCOPE_MISMATCH`) Consolidation의 `gather`는 정확히 같은 쌍으로 묶은 뒤 `current`가 2개 미만이면 건너뛴다. 그래서 `infrastructure`/`oci`/`compute`/`infrastructure-design`은 서로 절대 비교될 수 없었고 1개짜리 묶음 15개는 Consolidation에 영원히 보이지 않았다. 관계 25개는 Consolidation이 어려서만이 아니라 키가 갈라놓은 결과다.
- `(unconfirmed, unconfirmed)` 59건은 모델의 혼동이 아니라 서버 로직이었다. `curation-proposal.ts`가 `type==='unconfirmed'`일 때 `state`도 같이 세팅한다. 두 축이 같은 값 이름을 공유한 탓에 화면에서도 `typeLabels`·`unresolvedLabels` 둘 다 "미확인"으로 렌더됐다.

고친 것(`f9c0e4c`, [실행 35104437129](https://github.com/agent-observatory/agent-wiki/actions/runs/35104437129)):

- 프롬프트 `remote-curation-16`(이후 재추출 중 `-17`로 한 번 더 올렸다, 아래). `subject`는 대상 하나의 소문자 slug이며 topic_key와 같을 수 없다(`CLAIM_SUBJECT_IS_TOPIC`, 출력 오류 재시도 대상). `scope`는 닫힌 다섯 값 `general`·`local`·`production`·`dev-mode`·`experiment`로 zod가 강제한다. 예시값은 `SUBJECT-SLUG`·`TOPIC-KEY` 같은 자리표시자로 바꿔 다시 새지 않게 했다.
- 모델에 **그 주제가 이미 쓰는 subject 목록**을 준다(주제당 최대 24개, 직렬화 1,200바이트 예산을 넘으면 최근 주제부터 유지하고 나머지는 목록 없이 key·title만). 어휘는 코드가 정하고 모델은 고른다.
- `type`의 `unconfirmed` → `agent_statement`. `state`의 `unconfirmed`는 그대로 두어 두 축을 분리했다. DB 제약은 `DROP` → `UPDATE` → `ADD` 순으로 바꿔야 기존 행이 통과한다(한 번 순서를 틀려 마이그레이션이 실패했다).
- 입력 예산 하한을 올렸다. 지시문만 4.8KB인데 기존 최소 3,000·기본 8,000은 정작 읽어야 할 원문에 300토큰도 안 남겼다. 최소 12,000·기본 16,000으로 바꿨다. 운영은 이미 16,000이라 영향이 없다.
- 테스트 215개 통과. 과거에 캡처한 실제 Alibaba 응답 3건은 파일을 고치지 않고 재생 시점에 구 어휘를 매핑하는 주석 달린 shim으로 처리했다. 캡처는 당시 기록이므로 보존한다.

재추출(2026-09-16): `POST /curation/rebuild`로 L2·L3를 비우고 원문 606개를 다시 큐에 넣었다. 제거된 Article 283개, 원문 606개·업로드 177개·기록 18,338개는 재추출 전후가 같다(L1 보존 확인). 이어서 `ai resume`로 정제를 재개했다(설정 Version 68). 결과 측정은 아래 후속 기록을 따른다.

화면·문서(`40b32f7`):

- Knowledge는 이제 **`subject`별로** 묶는다. `scope`는 "어디에 적용되는가"라는 다른 질문이라 묶는 기준에서 빼고 행 배지로 내렸다. 왼쪽에 고정 목차(subject·개수, 현재 위치 표시)와 페이지 내 텍스트 찾기를 넣었다.
- 그림 세 장에 겹쳐 쓰는 두 축을 넣었다. 카드 아래 **저장 테이블 토큰**(데이터베이스 기호 + 실제 테이블 이름)이 그 단계가 읽고 쓰는 곳을 보여주고, 원래 모델 호출 카드에만 쓰이던 **연보라를 "모델 판단"으로 정의**해 결정적/비결정적 경계를 드러냈다. 연보라가 아니면 코드다. 섞인 단계는 한쪽으로 몰지 않고 본문 줄로 나눠 적는다.
- `architecture.md`에 지식 모델 표를 넣었다. 저장 순서는 `원문 → 근거 → 주장 ⇄ 관계 → 페이지`이고, **Decision은 테이블이 아니라 `type=user_decision`인 Claim**이며, `type`(권한)과 `state`(채택)는 독립 축이고 표시되는 상태는 `claim_relations`로 계산한다.
- 재추출 중 발견해 고친 결함(`remote-curation-17`): 서버는 `user_decision`을 `user_decision`으로만 대체할 수 있게 강제하는데(`DECISION_AUTHORITY_MISMATCH`) **프롬프트에 그 규칙이 없었고**, 이 코드는 출력 오류 재시도 목록에도 없었다. 모델이 관찰·추론으로 결정을 대체하려 하면 청크 추출 전체가 버려지고 확인 필요로 죽은 채 끝났다. 규칙을 프롬프트에 적고(이견은 `contradicts`이지 대체가 아니다) 재시도 목록에 넣었다. 실제로 작업 1개가 이 코드로 죽은 것을 보고 찾았다.
- 남은 것: `topic_key`는 여전히 모델이 짓는다(최근 40개 재사용 힌트만 있음). 그림의 AI 추출 카드가 이 사실을 그대로 적고 있다.

## 하네스 적대적 리뷰 · 결함 7건 · 측정이 무효였던 이유

2026-09-17. 하루 동안 결함이 계속 나오는 패턴을 Fable에 적대적 리뷰로 넘겼다. "잘 했는지"가 아니라 "무엇을 틀렸는지"를 물었고, 운영 DB 읽기 권한을 줘서 코드만이 아니라 실제 상태와 대조하게 했다.

### 검증 공백의 정체

일곱 결함이 한 모양을 공유한다: **검사를 "코드가 만들 상태"에 대고 썼고 "시스템이 이미 가진 상태"는 확인하지 않았다.** 넷은 그대로 가정의 실패다 — 락, 역할, 제약 정의, 기존 관계. 로컬 테스트는 자기 세계를 만들어 통과하고, 운영은 역사를 갖고 있어서 실패한다.

구조적 원인 네 가지: 로컬 DB를 절대 새로 만들지 않는다(`test-local-db.sh`가 컨테이너를 재사용); 마이그레이션을 "돌았다"로 검증하고 "스키마가 말한 대로인가"로는 검증하지 않는다; 큐·멱등 테스트에 **방해 행이 없다**(원하는 Job만 넣고 그것만 집는다); corpus에 대한 서술을 **쿼리 전에** 한다.

마지막은 내가 같은 날 두 번 저질렀다. 근사 중복 7쌍을 보고 "통합이 놓쳤다"고 단정하고 프롬프트를 고치려 했는데, 재보니 corpus 전체의 근사 중복 9쌍이 **전부 이미 연결**돼 있었다. 텍스트만 보고 `claim_relations`를 확인하지 않았다.

### 측정이 무효였다

| 출처 | current 주장 |
| --- | --- |
| `claude:c2715289` (하네스를 만든 그 대화) | **216** |
| `codex:01a094be` | 18 |
| `codex:01a09eba` | 3 |
| `feedback:Hyune-c` | 1 |

**91%가 한 세션이다.** "결정 과분류가 57% → 23%로 잡혔다", "관계가 17 → 28로 늘었다" 같은 오늘의 수치는 전부 **위키를 만드는 대화를 추출한 결과**지 제품의 품질이 아니다. 슬라이스는 몇 분 만에 슬라이스가 아니게 됐고, 나는 "Collector가 계속 넣는다"고 기록만 하고 결론까지 따라가지 않았다.

재현 쿼리(읽기 전용, `PG_ADMIN_*`):

```sql
WITH cur AS (SELECT DISTINCT cl.article_id,cl.revision,cl.anchor FROM claims cl
   JOIN articles a ON a.workspace_id=cl.workspace_id AND a.id=cl.article_id
     AND a.revision=cl.revision AND a.deleted_at IS NULL
   WHERE cl.workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM claim_relations cr
     WHERE cr.workspace_id=$1 AND cr.to_article_id=cl.article_id
       AND cr.to_revision=cl.revision AND cr.to_anchor=cl.anchor
       AND cr.relation IN ('retracts','supersedes')))
SELECT s.origin, count(DISTINCT (cur.article_id,cur.anchor))
FROM cur JOIN evidence e ON (e.article_id,e.revision,e.anchor)=(cur.article_id,cur.revision,cur.anchor)
JOIN sources s ON s.id=e.source_id WHERE e.workspace_id=$1 GROUP BY 1 ORDER BY 2 DESC;
```

**앞으로 corpus 수치를 적을 때는 그것을 만든 쿼리를 함께 남긴다.**

### 고친 것

| 결함 | 내용 |
| --- | --- |
| 자기 순환 | Claude 수집을 다시 껐다. `AGENTS.md`가 원래 "전체 비활성화"라고 적어둔 상태이며 09-14에 켜고 문서를 안 고쳤다. 껐어도 이미 업로드된 262개 원문의 추출 백로그는 남는다 |
| `claim retire`의 topic 누락 | 사용자 수정이 `topic_key=''`로 떨어져 어느 페이지에도, 어떤 통합에도 안 잡혔다. 서버는 `topic_key`를 이미 돌려주고 있었고 CLI가 안 쓴 것뿐. 테스트가 CLI 모양을 안 거쳐서 못 잡았다 |
| 마이그레이션 락 (절반만 고쳤던 것) | 제약 6개만 가드하고 `ADD COLUMN IF NOT EXISTS` 24개·`DROP NOT NULL`·26개 테이블 RLS는 그대로였다. **진짜 범인은 그것들을 다 가드한 뒤에도 남은 `DROP POLICY`+`CREATE POLICY`**였고 문장 단위 이분 탐색으로 찾았다. `lock_timeout` 15초와 원인 메시지를 넣었다. 쓰기 트랜잭션을 연 채 마이그레이션을 돌려 검증했다 |
| 되돌아간 교훈 | `DROP → UPDATE → ADD` 순서를 이 문서에 적어놓고 같은 날 뒤집었다. 복구했다 |
| `republishChange`의 raw state | 관계는 고정 (Article, Version, anchor)를 가리켜 새 Version으로 안 옮겨간다. 저장된 `state`를 복사하면 **대체·철회된 형제 주장이 되살아난다**. `consolidateClaim`은 같은 이유로 이미 `effective_state`를 쓰고 있었다. 미발현이며 픽스를 빼면 실패하는 회귀 테스트로 검증 |
| rebuild 막다른 길 | 범위 지정 rebuild가 남긴 658개 원문이 큐로 돌아갈 길이 없었고, 유일한 방법인 rebuild는 사용자 피드백 주장을 지운다. `curation queue`를 추가했다(지식 미변경, 멱등) |
| `AI_OUTPUT_LIMIT` 미재시도 | 마지막 쿼타가 소진돼 `glm-5.2`로 전환되자 몇 분 만에 드러났다. 잘린 응답은 다른 출력 오류와 같은 종류인데 이것만 바로 확인 필요로 죽었다. 출력 상한은 이미 스키마 최대치라 재생성이 유일한 수단 |
| 게이트 주석의 거짓 | `DECISION_EVIDENCE_NOT_USER` 주석이 "병합이 붙이는 미검증 근거를 막는다"고 했지만 실제 검사는 "하나라도 user면 통과"다. 조이는 건 틀렸으므로(사용자 발언+도구 출력 결정이 정상) 주석을 사실대로 고치고 혼합 근거 케이스를 테스트로 못박았다 |

모델 4개를 모두 소진하고 `glm-5.2`로 넘어갔다. 오후에 고친 `enable_thinking` 해제 불가 건이 없었으면 여기서 정제가 멈췄다.

### 다섯 번째 모델이 드러낸 두 가지

전환 직후 `AI_OUTPUT_LIMIT`이 반복됐다. 길이 문제가 아니었다.

```
completion_tokens 16385   ← 상한 초과
prompt_tokens      3276   ← 입력은 작다
completion_tokens_details.reasoning_tokens 16384
outputChars           0   ← 본문 0자
```

**출력 예산 전부가 추론에 들어가고 본문에 1토큰도 안 남았다.** 원인 두 개가 겹쳐 있었다.

1. `response_format: {type:'json_object'}`가 `isAlibabaThinkingModel` 조건에 묶여 있었다. qwen3·deepseek-v4 계열만 JSON을 요청받고 **같은 엔드포인트의 다른 모델은 아무 지시 없이** 자유 서술을 했다. 코드 주석은 이미 "모든 호출자가 JSON 객체를 기대한다"고 적혀 있었는데 조건이 아는 계열로만 좁혀져 있었다. JSON 모드는 엔드포인트 능력이지 모델 계열 속성이 아니다. `isAlibabaEndpoint`로 바꿨다(`b181550`). **테스트가 이 버그를 고정하고 있었다** — "인식 못 하는 모델은 `response_format`을 안 받는다"를 명시적으로 검증했다.
2. 그것만으로는 안 풀렸다. `reasoning: "default"`는 요청에 아무것도 넣지 않아 모델이 자기 기본값(추론 on)으로 돈다. `reasoning: "none"`으로 바꾸니 Hello의 완성 토큰이 **16,385 → 5, 추론 0**이 됐고, 막혀 있던 작업의 오류가 `AI_OUTPUT_LIMIT` → `AI_INVALID_OUTPUT`(재시도 대상)으로 바뀌었다. 설정 Version 76.

교훈: **모델 슬롯의 `reasoning` 기본값은 모델마다 다른 뜻이다.** `default`는 "적당히"가 아니라 "제공자가 정한 대로"이며, 추론 모델에서는 출력 예산을 통째로 쓸 수 있다. 새 모델을 2번 슬롯에 걸 때는 Hello의 `completion_tokens_details.reasoning_tokens`를 확인한다.

오늘 `AI_OUTPUT_LIMIT`을 재시도 목록에 넣은 것이 여기서 값을 했다. 세 번 재생성해 **세 번 다 같은 실패**라는 것이 드러나 "길이가 아니라 다른 문제"라는 신호가 됐다. 한 번 죽고 끝났으면 원인을 못 봤다.


### 남은 것

- **평가용 세트가 없다.** corpus의 91%가 하네스를 만든 대화라 어떤 품질 측정도 그 순환을 잰다. 위키 이전의 오래된 세션을 골라 고정하고 다시 재야 한다.
- `supports`가 중복을 잇지만 화면은 둘 다 보여준다. 접기는 평가용 세트가 생긴 뒤에 판단한다.
- `consolidation.auto`는 `false`다. 순환을 막기 전에는 켜지 않는다.

## 정제 하네스 · 슬라이스 재추출 · 예측과 결과

2026-09-17. 사용자가 "하네스를 만들라"고 했다. Alibaba `open-code-review`·OpenMetadata처럼 **엔지니어링이 단위·후보군·열거형·게이트·재시도를 소유하고 모델은 그 안에서 판단하며 사람 검수가 최후 방어선**인 구조다. 전체 재추출 대신 **슬라이스로 검증**한다.

### 왜 (측정한 사실)

재추출을 64/144 청크에서 멈춘 시점의 L3: 현재 주장 313개(`user_decision` 177 = 57%, `observation` 136), **관계 17개**(`supersedes` 7 · `supports` 9 · `contradicts` 1).

- Decision 177개는 **과분류가 아니다.** 표본을 읽어보니 전부 진짜 결정이고, 문제는 **대체(supersession)의 부재**다. `oci-managed-database`의 "PostgreSQL 설치형이 아니라 AWS RDS처럼 관리형 DB를 쓰기로 한다"가 `current`로 살아 있는데 우리는 K3s 안에서 PostgreSQL을 직접 돌린다. 위키가 운영 현실과 모순되는 결정을 "현재 유효"라고 주장하는 **정확성 결함**이다.
- 그런데 그 후속 결정은 subject가 `oci-infrastructure`다. 관계 게이트는 양끝의 subject·scope 일치를 요구하므로 **둘은 영원히 비교될 수 없다.** 원인은 `oci-managed-database`가 *결정된 속성*이 아니라 *선택된 값*을 subject로 삼은 것. 올바른 이름은 `database-hosting`이다.
- Consolidation은 실패한 게 아니라 **굶었다.** `consolidate.ts`가 (a) 워크스페이스에 추출 작업이 하나라도 `running`이면 무조건 `return null`, (b) `enabled=false`면 `cycle` Job을 건너뛴다. 게다가 수동으로 호출해도 이미 열린 Job에는 `rerun_requested`만 붙고 트리거가 `cycle`로 남아 여전히 안 돈다. 실제로 Job 7개가 영구 대기 상태였다.

### 무엇을 고쳤나 (`remote-curation-18`)

| 항목 | 내용 |
| --- | --- |
| subject 정의 | **선택된 값이 아니라 결정되는 속성.** RDS/K3s 대비를 프롬프트에 예시로 넣었다 |
| `DECISION_EVIDENCE_NOT_USER` | `user_decision`은 role=user 기록을 1개 이상 인용해야 한다. 자동 발행에만 적용하고, 역할을 판정할 수 없는 원문은 건너뛴다 |
| `SUPERSEDES_BACKWARD_IN_TIME` | 출발이 대상보다 이르면 거절. **`recorded` 시각이 없는 쪽이 있으면 검사 생략** — `recovered` 추정 시각으로 순서를 단정하지 않는다 |
| 범위 지정 rebuild | `sourceIds`로 일부 원문만 큐에 넣는다. 나머지는 원문은 두고 작업 행만 지워 **미정제로 정직하게 표시**된다 |
| rebuild 정리 | `consolidation_jobs`·`consolidation_inbox`·`claim_relation_rejections`를 함께 지운다. 기존에는 빠져 있어 고아 Job이 남았다 |
| 호출 이력 보존 | 위 삭제가 `refinement_runs`를 깨뜨려서, FK를 `ON DELETE SET NULL`로 바꾸고 CHECK을 "둘 다 설정되지는 않음"으로 완화했다. 이력 보존이 우선이다 |
| 수동 배치 | 수동 트리거가 대기 중인 자동 Job을 **인수**한다. 자동 Job의 veto는 10분으로 제한한다. `consolidation.auto=false`면 자동 Job을 만들되 실행하지 않는다 |
| 새 명령 | `consolidate --all`, `consolidate plan`(모델 호출 0회 예행), `consolidate status TOPIC` 렌더링. 웹 Curation에 "지금 통합 실행" 버튼 하나 |

테스트 189+26 → **201+27** 통과. 그림 `wiki-l1-l3-curation.svg`는 점선을 전부 실선으로 바꾸고(구현·배포 반영, 운영 검증과는 무관) 트리거·후보 좁힘·게이트 분류를 넣었다. 게이트 코드 13개는 `l2-l3-memory.md`의 표로 옮겼다.

### 슬라이스 예측 (실행 전에 적는다)

원문 **2개 · 20청크**. 세션이 아니라 원문 단위로 자른다.

| 원문 | 세션 | 줄 | 청크 | 역할 |
| --- | --- | --- | --- | --- |
| `cfb00306` | codex `01a094be` | 1,271 | 19 | 옛 결정 · RDS 관리형 DB (2026-09-12 08:31, `recovered`) |
| `97815f60` | codex `01a09eba` | 61 | 1 | 후속 결정 · K3s PostgreSQL (2026-09-14 07:04, `recorded`) |

합격 기준:

1. **두 결정이 같은 `subject`로 묶인다** — 하네스가 작동했는지의 단일 판정 기준
2. 페이지 2~4개, subject 묶음 5개 이상, `current`가 2개 이상인 묶음 2개 이상
3. `consolidate --all` 후 옛 RDS 결정이 `current`가 아니게 되거나, 납득할 이유가 붙은 `leaveUnresolved`로 남는다
4. 미큐 세션은 Sources에서 미정제로 보이고 `hasUnprocessedInputs=true`다

### 슬라이스 결과

원문은 예측한 2개가 아니라 **3개**가 됐다. Collector가 이 대화를 계속 수집해 새 원문이 정상 경로로 작업을 만든다. 슬라이스 규율이 깨진 건 아니지만 범위 지정 rebuild는 "그 시점의 원문"만 고정한다는 뜻이며, 재현 실험을 할 때는 수집을 먼저 멈춰야 한다.

청크는 예측 20개가 아니라 **7개**였다. 이전 19청크 계획은 입력 예산이 더 작던 시절 값이다. 모델 호출 6회.

| 기준 | 예측 | 실제 | |
| --- | --- | --- | --- |
| `subject` == 주제 키 | 0 | **0 / 23** | 통과 |
| subject 묶음 | 5개 이상 | 20개 | 통과 |
| `current` 2+ 묶음 | 2개 이상 | 2개 | 통과 |
| 페이지 | 2~4개 | 6개 | 초과 |
| 미큐 세션 정직 표시 | true | 세션 11개 전부 `waiting`, 조회는 `not_found_with_unprocessed_inputs` | 통과 |

**옛 RDS/관리형 DB 결정이 `Superseded`가 됐다.** 고치려던 정확성 결함이 사라졌고 페이지에 "과거 결정과 주장"·"Decision History" 절이 생겼다. 단서: 이 대체 사슬은 **Consolidation이 아니라 추출이** 만들었다. 61줄짜리 원문 `97815f60`이 역사 전체를 한 청크에 담고 있어 모델이 같은 청크 안에서 A→B→C를 이었다. **세션을 가로지르는 대체는 여전히 미검증이다.**

주장 28개 중 27개가 `user_decision`이다(이전 57%보다 심하다). 이 원문이 결정 요약본이라 그럴 수 있고 분류 쏠림일 수도 있다. 판단하려면 요약본이 아닌 원문으로 한 번 더 봐야 한다.

### 실행하다 찾은 버그: 수동 배치가 통째로 막혀 있었다

`consolidate --all`이 Job을 예약하고 인수(trigger `cycle` → `manual`)도 정상 작동했는데 워커가 집어가지 않았다. 추출은 비어 있고 정제는 켜져 있고 rate gate도 열려 있었다.

원인: Job 선택이 `ORDER BY created_at LIMIT 1`로 **한 건만 뽑은 뒤** 적격성을 검사하고, 거절되면 그 자리에서 레인 전체가 `return null`이었다. 가장 오래된 게 `cycle` Job인데 `consolidation.auto=false`라 거절되어, 뒤에 있는 manual Job에 영원히 도달하지 못했다. **오늘 만든 기능이 오늘 만든 플래그 때문에 동작하지 않았다.**

적격성 검사를 `WHERE` 절로 옮기고 manual을 먼저 정렬하도록 고쳤다(`5a636c6`). 회귀 테스트를 넣었다(202+27 통과). 기존 테스트는 "같은 주제에 manual"만 검증했고 실제 상황인 "다른 주제의 더 오래된 cycle Job이 앞을 막음"은 없었다. **로컬 검증으로는 나오지 않았고 끝까지 돌려서 나왔다.**

### 통합 판정 결과

```
Job 74874d3c · completed · trigger=manual
model     : backup-daily --contradicts--> backup-policy
validate  : passed=1 rejected=0
publish   : published=1 · 페이지 Version 4 → 5
```

두 결정은 "백업을 매일 1회 수행한다"와 "백업은 현재 고려하지 않고 추후 검토한다"였다. 모델은 `supersedes`가 아니라 **`contradicts`**를 골랐다. 두 원문의 시각이 전부 `recovered`(복구 추정)라 어느 쪽이 나중인지 알 수 없기 때문이다. **모르는 순서를 지어내지 않았다.** `consolidate plan`이 넘긴 입력의 `time`도 전부 `null`이었고, 이는 버그가 아니라 `recorded` 시각만 신뢰한다는 설계가 그대로 드러난 것이다.

### 배치를 실제로 돌려서 찾은 결함 4개

2026-09-17. 적격 묶음 13개로 `consolidate --all`을 돌렸다. 6개 주제 중 3개가 관계 0개로 끝났는데 **내용을 열어보니 모두 정답이었다** — `ai-services/search-implementation` 7개는 임베딩 배제 결정·BM25 파라미터·한국어 처리처럼 같은 대상의 다른 면이고, `curation/curation-harness` 17개는 게이트 규칙 하나하나가 병렬로 참이다. 억지로 이었으면 그게 오류다.

같은 배치에서 네 가지를 찾았다.

1. **AI 해석이 현재 유효로 올라갔다.** 프롬프트는 "assistant proposal = ai_inference/proposed"라고 적어두고 서버는 아무것도 막지 않았다. 모델의 해석이 사용자 결정과 같은 층에 `current`로 앉았다. 아침에 고친 `DECISION_AUTHORITY_MISMATCH`의 정반대다 — 그건 강제하는데 안 적혀 있었고, 이건 적혀 있는데 강제하지 않았다. **조용한 쪽이 더 나쁘다.** 거부가 아니라 `proposed`로 강등한다(`a092e8c`).
2. **재실행이 자기 자신과 충돌했다.** publish 멱등 키가 `(Job ID, attempt)`인데 `attempt`는 오류 후 재시작에서만 오른다. 새 주장으로 `rerun_requested` 재실행하면 방금 성공한 실행과 같은 키를 다시 써서 `publications` unique 인덱스에 걸려 죽는다. Job 2개가 한 시간 동안 60초마다 무한 재시도했다. 키를 **gather 입력 해시** 기준으로 바꿨다 — 같은 입력은 한 번, 바뀐 입력은 다시. `attempt`를 올리는 건 `MAX_JOB_RESTARTS=3`에 걸려 정상 재실행을 영구 실패시킨다(`b2bdf55`).
3. **그 원인이 보이지 않았다.** catch가 `e.name`을 기록하는데 pg 오류의 `name`은 문자열 `"error"`다. DB 오류가 코드 없이 남고 아무도 원인을 모른다. SQLSTATE를 싣고 메시지를 로그에 남긴다.
4. **위키가 자기 출력을 다시 먹는다.** 제안된 관계의 근거 인용이 에이전트 자신의 답변과 도구 출력이었다. `review conflicts`로 화면에 뿌린 위키 내용을 Collector가 수집하고 추출이 주장으로 뽑아 통합이 원본과 이으려 했다. 역할 기반 강등은 권한만 낮출 뿐 순환 자체를 막지 못한다. **미해결**이며 별도 설계가 필요하다.

### 남은 것

- **세션 간 대체 미검증.** 요약본이 아닌 두 세션의 원문으로 다시 봐야 한다.
- **사람이 충돌을 해소할 경로가 없다.** 방금 올라온 `contradicts`를 지금은 아무것도 할 수 없다. `claim retire`·`claim assert`·`relation add`·`review conflicts`가 다음 작업이다.
- `consolidation.auto`는 `false`로 두었다. 배치 모드 선언 전까지 자동 Job은 생성만 되고 실행되지 않는다.

## 통합(Consolidation) 구현·배포 · Knowledge 리니지 패널 구현·배포

2026-09-15. 아래 설계 기록의 방향대로 순서대로 구현해 배포했다: 관계 지연·대기함(`consolidation_inbox`) → `relation reject`·거절 기억(`claim_relation_rejections`) → Job과 네 Step(`consolidation_jobs`) → Knowledge 화면(구조화된 현재 주장 목록·리니지 패널). 커밋 `3de16fb`·`4914573`·`1895483`·`5c39d11`·`1e4ad75`. GitHub Actions `34878920175`·`34880213433`에서 각각 성공적으로 배포했다.

- 로컬 검증: 합성 자료·mock 모델 응답으로 gather→model→validate→publish 전체 경로(관계 통과·거절 둘 다), 사이클 완료 자동 트리거, 열린 Job에 재요청이 오면 완료 시 바로 재실행하는 `rerun_requested` 롤오버, `relation reject`의 정정 Version 발행을 확인했다. 209 → 215개 테스트 통과, typecheck·build 통과.
- 실행 중 발견해 함께 고친 버그: pick 단계가 gather·validate·publish(모델을 안 부르는 Step)까지 모델 호출 rate gate에 걸어 그다음 Step을 영영 못 집어가던 문제. `rerun_requested` 컬럼이 있지만 아무도 쓰지 않던 문제.
- 운영 검증은 아직이다. 실제 세션 자료로 자동 트리거가 발동해 관계를 만들거나 거절하는 모습, 웹 Knowledge 화면의 리니지 패널·"통합 대기" 배지 표시는 배포 후 실사용에서 확인해야 한다. `docs/assets/wiki-l1-l3-curation.svg`의 점선 테두리·"설계·미구현" 라벨은 2026-09-17에 실선으로 바꿨다(아래 하네스 기록). 실선은 구현·배포를 뜻하며 운영 검증을 뜻하지 않는다.

## 통합(Consolidation) 설계 · Knowledge 리니지 패널 설계 · 그림 L1–L5 한 장 → L1–L3·L4–L5 두 장 · 설계 단계 · 미구현

2026-09-15. 같은 날 앞선 두 차례 설계 대화(Knowledge 페이지의 현재 주장·리니지 UX, Job/Step 모델의 Consolidation 파이프라인)를 하나의 설계로 합쳐 `l2-l3-memory.md`에 [통합 · Consolidation](l2-l3-memory.md#통합--consolidation--설계--미구현) 절로 적고 그림으로 그렸다. **설계 단계다. 코드·마이그레이션·배포·검증은 없다.** 사용자가 승인한 것은 방향 세 가지(자동 반영, cycle 완료 시 주제별 자동 트리거 + 수동 `consolidate`, 관계만 실패한 반영의 대기함 지연)이며 구현 착수는 아직 승인하지 않았다. 사용자는 그림을 보고 추가 피드백을 주기로 했다.

- 설계 요지: 추출은 청크마다 주장을 만들고, 통합은 주제마다 기존 주장 사이의 관계만 정한다. Consolidation Job은 `gather → model → validate → publish` 네 Step이며 Step마다 status·attempts·error·retryAt를 따로 기록해 실패한 Step부터 재시도한다. 모델 호출은 주제당 1회, 통합할 것이 없으면 0회다. 추출 publish의 `CLAIM_TARGET_VERSION_CHANGED`·`CLAIM_TARGET_ALREADY_RETIRED`는 추출을 버리지 않고 주장을 반영한 뒤 관계를 대기함에 넘긴다. 자동 반영을 되돌리는 `relation reject`(정정 Version + 거절 기억)가 자동 반영보다 먼저 필요하다. Knowledge 화면은 기존 Wiki Page 스냅샷을 구조로 그려 current 주장만 (subject, scope)별로 나열하고, 클릭한 주장의 리니지 패널이 supersedes·retracts를 앞뒤로 따라간다. 열린 Job이 있는 주제는 "통합 대기"다.
- 설계에서 내가 정한 것(사용자 미확인): 지연 대상 코드를 위 둘로 한정(`CURATION_CONTEXT_CHANGED`는 유지), 통합 관계는 새 Revision 없이 기존 고정 Version 사이에 consolidation publication으로 저장, reject의 정정 Version은 상태가 바뀐 대상 주장(contradicts는 양쪽)에만 발행, 관계 근거는 출발 주장의 기존 근거 ID 중 선택, 수동 `consolidate`는 자동 정제 중지 중에도 그 1회 실행, publish의 Version 변경은 같은 주장이면 재대상·아니면 gather부터 최대 3회, 주장 상태 필드의 자동 승격 없음. `AGENTS.md`의 정제 큐 원칙에 관계 지연 한 문장을 더했다. `l2-l3-memory.md`의 "관계를 버려 통과시키지 않는다"는 문장은 그대로 두고 지연 규칙을 이어 붙였다.
- 그림: 사용자가 "스타일만 비슷하게 하고 완전히 새로 그린다"고 했고 최종 범위를 "L1~L3 지식 정제 한 장 + L4~L5 검색 한 장, 아키텍처 포함 3장"으로 정했다. `wiki-l1-l5.svg`(1680×3100, 네 띠)를 지우고 `wiki-l1-l3-curation.svg`(1760×2450)와 `wiki-l4-l5-query.svg`(1760×1020)를 새로 그렸다. 옛 그림에서 L3가 두 번(01 안의 참고 루프 세 장, 02의 Decision·페이지) 설명되던 것을 "통합 전 주장 → 통합 → 통합 후 페이지"의 한 줄거리로 바꿨다. 옛 01의 두 세션 카드 두 장은 L1 카드 하나로, L3 참고 루프의 세 카드(L3 읽기·BM25·규칙 재정렬)는 카드 하나로 줄였다. 옛 02의 Decision History·현재 상태 페이지 두 장은 04의 Knowledge 페이지 카드 하나와 리니지 패널로 대체했다. 옛 04의 Version 1·2·3 비교 기준 상자는 문서의 검토 절에 이미 있어 그림에서 뺐다. 옛 03의 조회는 L4–L5 한 장에 사용자 질문 → 에이전트 → 3단계 → 인용 답변의 줄거리로 다시 그렸다. 설계·미구현 부분은 같은 색에 점선 테두리이며 범례 한 항목으로 표시한다(`DESIGN.md`에 규칙 추가). `architecture.md`는 L1–L5와 지식 모델 절에 정제 그림, L4 · Query / L5 · Answers 절에 조회 그림을 삽입한다.

검증: 생성기 2회 재실행의 SHA-256 일치(CI `Check diagrams`와 같은 명령)·SVG 3개 XML·`architecture.md`·`l2-l3-memory.md`·`DESIGN.md`·`client-and-api.md`·`README.md`·`AGENTS.md`의 상대 링크와 GitHub 방식 앵커, 두 새 그림의 PNG 렌더링(Noto Sans KR)에서 겹침·잘림을 눈으로 확인했다. 이번에는 텍스트 폭도 같은 글꼴로 재서 상자 밖으로 나가는 글자와 겹치는 라벨을 스크립트로 검사했고(첫 렌더에서 라벨 두 개 이동), 문제 0으로 끝냈다. 문서·그림 변경이며 앱 코드·배포·정제 상태·데이터는 바꾸지 않았다.

## 그림 6장 → 2장 · 아키텍처 한 장 · L1–L5 한 장 · 목록형 내용은 표로 이동

2026-09-15. 사용자가 "아키텍처는 한 장, L1–L5의 흐름은 최소 1장·최대 2장, 전체 3장이 상한이며 가능하면 2장 안"으로 고정했다. 앞선 두 차례 정비(화살표 수정, L2·L3 그림 5장 → 1장 통합)는 장수를 6장으로 남겼으므로 이번에는 내용을 갈라 **`wiki-architecture.svg`(아키텍처) · `wiki-l1-l5.svg`(L1–L5 흐름) 두 장**으로 줄였다. 기준은 "상자와 화살표가 관계·흐름을 보여주는가, 아니면 사실 목록인가"다. 목록은 문서의 표로 옮기고 그림에서는 지웠다.

- 아키텍처 한 장은 기존 `wiki-deployment.svg`의 내용을 그대로 이름만 바꿨다(제목 "아키텍처 · 단일 VM · K3s"). `wiki-operations.svg`의 다섯 줄(인프라·앱 배포·오류 로그·비용·별도 수집)은 각각 한 방향 사슬이라 그림이 필요 없었다. 넷은 `architecture.md` 배포와 운영 절의 표(경로·흐름·유지/구분)로 옮기고, 다섯째 별도 수집은 아키텍처 그림에 이미 있어서 표에서 뺐다. 호스트 로그 상자는 `DESIGN.md`의 기존 규칙대로 아키텍처 그림에 넣지 않았다.
- L1–L5 한 장(1680×3100)은 네 띠다. 01 두 세션의 L1 증분 → Worker 파이프라인(청킹·입력 조립·AI 판단·서버 검증)과 L3 참고 루프(BM25·규칙 재정렬 → 입력 조립), 그리고 새로 그린 검증 실패 → AI 재시도 점선 루프와 Retry 카드. 02 L3 그룹의 Decision A·B·C·supersedes → Wiki Page 변경 이력·현재 상태(옛 `wiki-knowledge-model.svg`의 L3 부분). 03 L5 에이전트 ↔ L4의 후보 → Claim·관계 → 원문 구간 단계 카드, 작은 L1 카드, 조회 이력(옛 `wiki-query.svg`). 04 Skill → CLI 비교 → 사용자 확인 → CLI 확정과 Version 1·2·3의 비교 기준(옛 통합 그림의 04). 서버 검증 → L3 반영 선과 L3 → 읽기 카드의 참고 조회 선을 다른 x에 두어 교차가 없고, L3 그룹 → L4 Claim 카드는 세로 한 줄로 이었다.
- 그림에서 표로 옮긴 것: 변경 의도 다섯 경우(옛 01의 두 번째 띠 — `l2-l3-memory.md`의 주장과 관계·에이전트 간 지식 통합 표와 완전히 겹쳤다), L4의 세 질문 카드(아키텍처의 질문 목적 표와 겹쳤다), 옛 02 실험 다섯 단계와 선택 기준 세 가지(`l2-l3-memory.md` 새 절 "방법을 고르는 실험"의 표 두 개), 옛 03 재생성 네 단계와 "유지하는 것"(같은 문서 "원문은 그대로 · 기억은 다시 만들기" 문단), `wiki-reprocessing.svg`의 Retry/Reprocess/Reassemble 세 열(아키텍처 재작업 표에 "결과" 열을 추가). 각 재작업이 그림의 어디로 다시 들어가는지는 아키텍처 본문 한 문장으로 남겼다.
- 그림에서 아예 뺀 것: 옛 01 아래의 주의 문장 세 줄 중 "임베딩·리랭커는 후보 검색·정렬, 유효성은 상태·범위·대체 관계"는 03의 하단 바 한 줄과 본문에 이미 있어 지웠고, 옛 재작업 그림의 "분석 정정 ≠ 사용자 결정 변경" 주석 상자는 본문 문장으로 바꿨다. L3 A/B 상자가 두 그림에 중복되던 것은 하나로 합쳤다. 내용을 잃은 항목은 없다.
- 문서: `architecture.md`는 그림 5장 → 2장(전체 구성·L1–L5와 지식 모델), `l2-l3-memory.md`는 L1–L5 한 장을 위에 한 번 삽입하고 옛 통합 그림 절을 "정제 흐름 · 실험 · 재생성" 절로 바꿨다. `DESIGN.md`의 Wiki 그림 절은 두 장 기준으로 다시 썼고 "두 장만 둔다"는 규칙과 점선의 뜻(정제 색 점선 = 재시도, 회색 점선 = 기록·기준)을 추가했다. 아카이브 폴더의 옛 SVG·문서는 건드리지 않았다.

검증: 생성기 2회 재실행의 SHA-256 일치(CI `Check diagrams`와 같은 명령)·SVG 2개 XML·`architecture.md`·`l2-l3-memory.md`·`DESIGN.md`·`client-and-api.md`의 상대 링크와 GitHub 방식 앵커, 두 그림의 PNG 렌더링(Noto Sans KR)에서 겹침·잘림을 확인했다. 첫 렌더에서 조회 이력 카드의 둘째 줄이 카드 하단에 걸쳐 카드 높이를 130으로 늘렸다. L1–L5 한 장은 세로로 길지만 글자 크기는 기존 그림과 같고 띠마다 카드 수가 4~7개여서 각 띠는 이전 그림들과 같은 밀도로 읽힌다. 문서·그림 변경이며 앱 배포·정제 상태·데이터는 바꾸지 않았다.

## 아키텍처 그림 5장 점검 · 배포도 Worker 원문 연결 추가 · 문서 변경

2026-09-15. 사용자가 "architecture.md만 주력으로 본다, 항상 여기를 다듬어달라"고 해서 그 문서의 그림 5장을 앞선 L2·L3 정비와 같은 기준으로 다시 봤다. 상자 글과 화살표가 실제 동작과 맞는지 코드로 확인하고, PNG로 렌더링해 겹침·잘림을 눈으로 봤다.

- 배포도(`wiki-deployment.svg`)에서 실제 흐름과 다른 부분 두 곳을 고쳤다. 첫째, Worker가 Object Storage와 직접 주고받는 선이 없었다. 코드상 Worker가 올라온 임시 파일을 검증해 불변 L1로 기록하고(`ingest.ts`), 정제할 때도 그 원문 텍스트를 직접 읽는다(`curation-batch.ts`). 이제 Worker ↔ Object Storage 양방향 선("원문 검증·등록 · 텍스트 읽기")을 넣고, API 상자의 "L1 확정"은 "수신 검증 조율"로, API ↔ Object Storage 점선은 "업로드 허가 · PAR 발급"으로 바꿨다. Worker 상자에 "수신 검증 · 불변 L1 등록" 줄을 추가했다. 둘째, "VM 마운트" 라벨이 자기 선(Block Volume → PVC)이 아니라 옆의 DB ↔ PV 세로선에 붙어 있어 라벨을 Block Volume 상자 안으로 옮겼다.
- 배포도 배치를 정리했다. cert-manager를 gateway 바로 아래로 옮겨 그림 전체를 가로지르던 TLS Secret 점선(다른 선과 교차)을 짧은 세로선 하나로 줄였고, K3s 제어 상자는 VM 하단의 한 줄 띠로 바꿨다. 새 선을 넣으면서 교차가 생기지 않도록 AI Provider·인증서 발급 기관 위치를 조정했다. 캔버스는 1280 → 1400 높이다.
- 조회 그림(`wiki-query.svg`)에서 원문(L1)에서 곧장 에이전트(L5)로 돌아가는 화살표를 고쳤다. 에이전트는 Object Storage를 직접 읽지 않고 L4(API `query source`)가 원문 구간을 읽어 돌려주므로, L4 ↔ L1을 양방향으로 만들고 "선택한 근거 반환" 루프가 L4에서 출발하게 했다. 중복이던 짧은 L4 → L5 화살표는 지웠고, 조회 이력 상자에 L4에서 오는 점선("조회 기록")과 범례를 추가했다.
- 지식 모델 그림(`wiki-knowledge-model.svg`)의 L2 상자가 "기존 결정과 비교"라고 쓰면서 L3에서 읽어오는 선이 없어 L3 → L2 "기존 주장 참고" 조회선을 추가했다. 재작업 그림(`wiki-reprocessing.svg`)은 "분석 정정 ≠ 사용자 결정 변경" 주석으로 가는 선이 다른 그림에서 "대체 관계"를 뜻하는 보라색이어서 회색 점선으로 바꾸고 범례를 달았다. 운영 그림(`wiki-operations.svg`)은 제목 "사용자 작업과 백그라운드 처리 분리"가 다섯 줄 내용(인프라·배포·오류 로그·비용·별도 수집)과 맞지 않아 제목·alt 텍스트를 내용에 맞췄다.
- 다섯 그림은 합치지 않고 따로 뒀다. 배포 구성·지식 모델·재작업·조회·운영은 문서의 서로 다른 절에 각자의 표와 붙어 있고 공유하는 예시 상자도 없어, 한 장으로 묶으면 첫 그림이 더 무거워질 뿐이다.
- 문서 본문의 작은 수정: 직접 업로드 절에 "Worker의 검증·불변 L1 등록"과 정제 시 Object Storage 직접 읽기를 명시, K3s 책임 절의 "아래 배포 규칙"을 실제 절로 링크, 배포와 운영 절에서 Collector 활성 범위·자동 정제 상태처럼 바뀌는 운영 상태 문장을 빼고 운영 현황으로만 가리키게 했다(그 문장은 `AGENTS.md`와 이 문서의 현재 상태 표가 서로 달라 아키텍처 문서에 둘 수 없었다). 오탈자 하나("Code은")와 빈 줄을 정리했고, `l2-l3-memory.md`가 아키텍처의 존재하지 않는 앵커(`#l4--query`)를 가리키던 링크를 고쳤다. 본문의 자원 수치(requests/limits·시스템 예약 400m·1,280Mi)·조회 한도(12단계·64,000자·문서 2,000개)·`pg_trgm`은 코드와 대조해 그대로 맞았다.

검증: 생성기 재실행 일치(CI `Check diagrams`와 같은 명령)·SVG 5개 XML·`architecture.md`·`l2-l3-memory.md` 상대 링크와 앵커, 변경 그림 전부의 PNG 렌더링에서 겹침·잘림을 확인했다. 문서·그림 변경이며 앱 배포·정제 상태·데이터는 바꾸지 않았다.

## 그림 연결 수정 · L2·L3 그림 한 장 통합 · 문서 변경

2026-09-14. 사용자가 `wiki-knowledge-model.svg`의 화살표 오류를 눈으로 발견했다. 대체된 Decision A는 B의 supersedes 화살표만 받고 Wiki Page로 이어지지 않았고, B·C에서 내려온 화살표는 두 페이지 상자 사이의 빈칸에 닿았다. Decision History의 내용(NVIDIA → 호출 지연 → Alibaba)은 A에서 오는데 그림은 A를 막다른 카드로 보여줬다. 이제 A와 B는 Decision History로, B와 C는 현재 상태와 설명으로 각각 곧게 내려가며 두 페이지 상자의 좌우 위치를 출처에 맞게 바꿨다. supersedes 라벨은 A·B 사이 화살표에 붙이고 범례를 추가했으며 요청·응답인 L4 ↔ L5는 양방향으로 고쳤다. 정제 흐름 그림에서 관련 후보 화살표가 AI 카드로 가던 것은 입력 조립 카드로 고쳤고 `wiki-query.svg`에 범례를 추가했다. 그 밖의 배포·운영·재작업 그림은 상자 내용과 화살표 방향이 일치했다.

사용자 요청으로 아키텍처 문서 밖의 그림 `wiki-curation.svg`·`wiki-decision-history.svg`·`wiki-curation-evaluation.svg`·`wiki-curation-rebuild.svg`·`wiki-review.svg`를 `wiki-l2-l3-memory.svg` 한 장(01–04, 1680×3960)으로 합쳤다. 정제 흐름과 결정 이력은 같은 NVIDIA → Alibaba 예시를 공유하므로 01 하나로 묶고 중복된 L3 A/B 상자를 하나로 줄였다. 어느 문서에도 삽입되지 않던 `wiki-layers.svg`는 `wiki-knowledge-model.svg`와 내용이 겹쳐 제거했다. 여섯 그림의 생성 코드와 파일을 지웠고 `l2-l3-memory.md`는 한 장을 한 번 삽입하며 검토 절은 그림의 04를 가리킨다. 현재 SVG는 아키텍처 5개와 통합 그림 1개다.

검증: 생성기 재실행 일치(CI `Check diagrams`와 같은 명령)·XML·문서 상대 링크와 PNG 렌더링의 겹침·잘림을 확인했다. 문서·그림 변경이며 앱 배포·정제 상태·데이터는 바꾸지 않았다.

## 지식 페이지 정렬 수정 · 미배포

2026-09-14. 사용자가 "인프라" Wiki Page를 열어보니 비슷한 주장이 시간순이 아니라 뒤섞여 있다고 지적했다("채팅 타임스탬프가 아니라 세션 업로드 타임스탬프 같다"). Fable과 함께 원인을 진단했다: `apps/agent-wiki-api/src/wiki-pages.ts`가 주장을 실제 대화 시각(`evidence_times`)이 아니라 **그 주장이 DB에 발행된 시각**(`a.created_at`)으로 정렬하고 있었다. 실제 프로덕션 데이터로 확인한 결과, 같은 시간대(2026-09-11 22:45~46)에 오간 대화 내용이 발행 시각 차이 때문에 하루 넘게 떨어진 위치("2026-09-13 20:23"과 "2026-09-14 05:44")에 표시되고 있었다.

- `wiki-pages.ts`의 claims 조회 쿼리를 고쳐 각 주장의 가장 이른 근거 시각(`first_evidence_at`)과 그 시각의 종류(`first_evidence_kind`: `recorded`=실제 기록·`recovered`=압축 복구)를 계산하고, 그 값으로 정렬하도록 바꿨다. 같은 시각(주로 컴팩션 복구 묶음)으로 묶인 주장들은 원문의 소스 생성 시각·줄 번호로 2차 정렬해 대화에 등장한 순서를 최대한 보존한다. 두 필드는 웹이 나중에 쓸 수 있도록 스냅샷에도 남긴다.
- `assemblyVersion`을 `topic-sections-2`→`topic-sections-3`으로 올려 다음 `reassemble` 때 모든 Wiki Page가 새 Version으로 다시 만들어지게 했다.
- 전체 212개 주장 중 74개(35%)는 Codex 컴팩션이 원래 시각을 지운 "복구 기록"이라 시각 자체가 없다 — Collector를 다시 만들거나 원문을 재수집해도 이 부분은 복구되지 않는다는 것을 Fable이 Collector 소스 코드로 직접 확인했다. AI 호출은 0회.
- 검증: 전체 DB 테스트(179+26건) 통과, 타입 검사 통과, 프로덕션 DB에 읽기 전용 쿼리로 새 정렬이 실제로 올바른 순서를 만드는지 직접 확인(위 예시).
- 아직 미배포. 배포 후 `agent-wiki reassemble` 실행이 필요하다.

## 모델별 파라미터 분리 · 호출 제한 확장 · Fable 진단 · 배포 완료 · 설정 행 수동 이관

2026-09-14. 배포된 할당량 수정 이후 2번 모델(`deepseek-v4-flash-0731`)로 정제를 재개했더니 "생각보다 엄청 오래 걸린다"는 관찰이 나왔다. 최근 7일 지표를 보니 1번(`deepseek-v4-flash`)은 평균 69초·p95 145초였는데 2번은 평균 269초(성공한 호출만도 약 220초)·p95 330초로 **고정 호출 제한(330초)에 절반이 그대로 걸려 `AI_TIMEOUT`으로 잘렸다**(12분 사이 5건). 두 모델 설정(추론 high, thinking_budget 무제한)은 동일했으므로 설정 회귀가 아니라 모델 자체가 훨씬 오래 생각하는 것으로 보인다.

Fable에게 진단·실험 설계를 맡겼다: 가장 유력한 원인은 thinking_budget 상한이 없어 2번 모델이 훨씬 오래 추론하는 것(서빙 속도 차이·전환 직후 동시 폭주 가능성도 있으나 완료된 실행의 추론 토큰 수를 DB에서 조회하면 호출 없이 판별 가능). 타임아웃을 10분으로 늘리는 안은 비권장(타임아웃 나도 제공자는 토큰을 이미 소비해 쿼타만 태우고 결과는 없음 — 호출량 절감이라는 1순위와 상충)했지만, 사용자는 "돈이라 늦게라도 되는게 중요하다"며 **완료 우선**을 확정 지시했다.

- **모델 1·모델 2 완전 분리 설정**으로 재설계했다. 지금까지 `reasoning`·`enable_thinking`·`thinking_budget`·`max_completion_tokens`·`maxTokens`·`maxInputTokens`·`maxInputChars`는 두 모델이 공유하는 한 벌이었다(모델 이름만 `model`/`fallbackModel`로 갈렸다). 이제 `primary`(1번, 필수)·`fallback`(2번, `null`이면 없음, 최대 1개까지)이 각자 이 필드들을 독립적으로 가진다. `requestsPerMinute`·`concurrency`·`retryDelaySeconds`·`dailyCalls`·`baseUrl`·API 키는 그대로 공유한다.
- **모델 호출 제한(`timeoutSeconds`)을 고정 330초에서 슬롯별 60~900초 설정값으로 바꿨다.** 기본값은 그대로 330초라 기존 동작은 안 바뀌고, 필요한 모델만 늘릴 수 있다(예: 2번 모델을 600~900초로). 작업 임대 시간은 `timeoutSeconds`+120초와 420초 중 큰 값으로 자동 계산해 항상 호출 제한보다 길게 유지한다(수동 조정 불필요). HTTP 연결의 유휴 한도도 슬롯별 타임아웃에 맞춰 같이 늘어난다.
- 웹 설정 화면을 좌우 2단으로 바꿨다: 왼쪽 "모델 1", 오른쪽 "모델 2"(비어 있으면 추가/제거 버튼)에 각자 model·timeoutSeconds·maxInputTokens·max_tokens 또는 max_completion_tokens·enable_thinking·reasoning_effort·thinking_budget을 따로 입력한다. 공통 항목(Endpoint·API key·requestsPerMinute·concurrency·retryDelaySeconds·dailyCalls)은 위쪽에 한 번만 둔다.
- CLI `ai update`의 설정 JSON도 `{"primary":{...}}`·`{"fallback":{...}|null}` 형태로 바뀌었다. 슬롯 안의 일부 필드만 보내도 기존 슬롯 값에 병합되므로(예: `{"primary":{"reasoning":"high"}}`) 슬롯 전체를 다시 쓸 필요는 없다.
- 개발 모드라 하위 호환 없이 스키마를 바로 바꿨다(Workspace 1개, 설정 1행).
- 검증: 새 단위 테스트(모델별 timeoutSeconds 저장·경계값 60/900 거부, 폴백 슬롯 검증·같은 모델 거부·`AI_FALLBACK_REASONING_NOT_SUPPORTED`, 폴백 전환 시 새 타임아웃 반영)와 전체 DB 테스트(179+26건), 타입 검사, 웹 빌드 모두 통과. **웹 새 2단 레이아웃은 브라우저에서 직접 클릭해 확인하지 못했다** — 실제 로그인 세션을 로컬에 만드는 절차가 없어 코드 리뷰·빌드 통과로만 검증했으니 배포 후 화면을 한 번 눈으로 확인하는 게 좋다.
- 배포·확인 완료: `3177ad2`의 [CI·K3s 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34834972571)가 test·publish·deploy 모두 성공, `/readyz` ready. 배포 직후 `GET /ai-settings`가 `INVALID_INPUT`으로 실패했다 — DB에 남아 있던 기존 설정 1행이 옛 평면 구조(`model`·`fallbackModel`·`reasoning`이 최상위)라 새 `.strict()` 스키마가 파싱을 거부했다. 사용자 승인을 받아 그 1행만 값 변경 없이 새 `primary`/`fallback` 구조로 직접 UPDATE했다(Version 64·`encrypted_key` 그대로, 두 슬롯 모두 기존 model·reasoning·maxInputTokens 등 동일 값, `timeoutSeconds`만 새로 기본값 330초로 채워짐). 이후 `ai show`·`GET /refinements`의 `progress.control` 모두 정상 응답 확인.
- 실제 `timeoutSeconds` 값(예: 2번 모델을 더 길게)을 얼마로 둘지는 아직 사용자가 정하지 않았다 — 현재 두 슬롯 다 기본값 330초로 남아 있다.

## 할당량 소진 오분류 수정 · 모델 계열 인식 확장 · 배치 API 기각 · 시간 표시 통일 · 미배포

2026-09-14. 재개 후 실제로 1번 모델(`deepseek-v4-flash`)의 무료 할당량이 소진됐는데 안전 중지도 2번 모델 전환도 걸리지 않고 작업 3개가 `AI_HTTP_403` 확인 필요로만 남았다. 사용자가 정제를 중지한 뒤 원인을 직접 curl로 확인했다: Alibaba 호환 모드가 소진을 `AllocationQuota.FreeTierOnly`가 아니라 `insufficient_quota`(코드·타입 모두)로 반환하고 있었다. 판정 코드가 전자만 알아봐서 후자를 일반 403으로 떨어뜨렸다.

- 할당량 소진 판정에 `insufficient_quota`(code 또는 type)를 추가했다. 403만 소진으로 분류하며 429는 여전히 재시도 대상으로 남긴다(같은 코드라도 429는 속도 제한이지 소진이 아니다). 어떤 403·429든 미분류 코드는 실행 진단과 실패 로그에 `code`·`type`만(64자 이내 허용 문자만, 본문·메시지는 제외) 남겨 다음 미스매치를 curl 없이 바로 볼 수 있게 했다.
- 별도로, 2번 모델에 `deepseek-v4.1-flash`를 넣고 테스트하면 `AI_REASONING_NOT_SUPPORTED`가 났다. 두 모델(`deepseek-v4-flash-0731`, `deepseek-v4.1-flash`) 다 실제 존재하고 호출도 되는 걸 curl로 확인한 뒤, 모델 계열 인식 범위를 `v4.N` 마이너 버전까지 넓혔다. 2번 모델이 인식 범위 밖이라 거부될 때는 `AI_FALLBACK_REASONING_NOT_SUPPORTED`로 구분해 어느 모델이 문제인지 알 수 있게 했다.
- 웹 UI의 날짜·시간 표시(`2026년 9월 14일 오후 05:39`처럼 12시간제가 섞여 있던 것)를 `26. 09. 14. 14:51` 형식으로 통일했다. 공유 컴포넌트 하나로 합쳐 14개 표시 위치 모두 같은 형식을 쓴다.
- Batch API 비용 절감 요청은 조사 후 기각했다. Alibaba 동기 Batch Chat은 베이징 리전 전용이고 계정은 싱가포르(ap-southeast-1) 워크스페이스만 쓴다. 실제로 공개 배치 호스트에 계정 키로 호출하면 401이 났다. 비동기 파일 배치는 완료까지 24시간~2주가 걸려 지금 구조(7분 임대·330초 호출)와 맞지 않는다. 사용자 확인: "베이징만 되냐? 그럼 걍 기각". 코드 변경 없음.
- 검증: 새 단위 테스트(할당량 판정 9개 사례, 비-Alibaba 호스트 본문 미읽음, 모델 계열 긍정·부정 8개, 폴백 전용 오류 코드)와 타입 검사 통과. DB 전체 테스트·빌드는 배포 전 별도 확인.
- 배포·확인 완료: `7c972db`의 [CI·K3s 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34827203321)가 test·publish·deploy 모두 성공, `/readyz` ready. 설정은 배포 전후 **OFF·Version 61**로 변경 없음을 확인했다. `deepseek-v4.1-flash`를 2번 모델로 지정해 `ai test --fallback`을 실행하니 성공했다(3.4초, 추론 토큰 31 포함 — 추론 필드도 실제로 받아들이는 걸 확인, B의 검증 한계 해소). 실패 작업 3개 재시도와 정제 재개는 사용자 명령을 기다린다.

## 재개 후 첫 관찰 · 맥락 예산 확대 · 추정기 전환 · 2번 모델 · 배포 완료

2026-09-14. 사용자가 `ai resume`(Version 57)한 뒤 실패 작업 3개를 `POST /refinements/<id>/retry`로 다시 돌렸다. 세 실행 모두 `remote-curation-14`에서 첫 시도로 완료됐고 인용 검증 28/28·28/28·30/30, 스키마 오류 0이었다. 이후 자동 진행으로 청크 36/142까지 처리한 시점에 새 실패 `CLAIM_REPLACEMENT_NOT_CURRENT` 1건이 났고 사용자가 개선 후 재개하기로 중지했다(Version 58). **아래 변경은 로컬 검증 후 사용자 지시로 배포했다.** `d216cf3`의 [CI·K3s 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34818686294)가 test·publish·deploy 모두 성공했고 `/readyz`는 ready다. 배포 후 설정은 **OFF·Version 58·`maxInputTokens` 30,000·`fallbackModel` null·`fallbackActive` false**로 변경 없음을 확인했다. 재개 전 사용자가 `maxInputTokens` 16,000과 `fallbackModel`을 저장하고 재개한다. 로컬 Client 0.7.5와 Codex·Claude Skill을 갱신했고 Collector 설정은 그대로다.

### 관찰한 문제

| 관찰 | 수치 | 원인 |
| --- | --- | --- |
| 참고 지식이 거의 안 들어감 | 25개 실행 모두 후보 24개 중 **1~3개 선택, 21~23개 예산 탈락** | 1,800바이트 예산·한국어 글자당 3바이트·후보 본문 600자 |
| 같은 주장을 새 문서로 재생성 | 문서 112개(전부 Version 1), 제목 겹침 86쌍, 예: 임베딩 보류 문서 2개·제품 분리 문서 3개 | 모델이 기존 주장을 보지 못해 정확한 문장 재사용·통합이 일어나지 않음 |
| 청크당 변경 수가 상한에 닿음 | 재시도 3건은 12·12·11개, 최근 25건 중앙값 4·최대 12 | "이거 모니터링 계획도 있어야겟다" 같은 잡담을 별도 문서로 추출 |
| 질문을 결정으로 기록 | 표본 6개 중 1개(`user_decision current`의 근거가 사용자 질문) | 유형 판정 지침 부족 |
| 새 실패 코드 | `CLAIM_REPLACEMENT_NOT_CURRENT` 1건, 재시도 불가로 종결 | 미확인 주장이 supersedes를 시도했고 발행 단계에서만 거부 |
| 입력 추정 과대 | 실제 `prompt_tokens`가 바이트 추정치의 **0.30**(23개 실행 중앙값) | DeepSeek는 UTF-8 바이트 보수 추정. 30K 예산에 실제 약 7.5K 토큰만 전송 |

표본 6개 Claim의 인용 위치는 모두 정확했다. 문제는 인용이 아니라 통합·유형·분량이다. `remote-curation-14` 완료 13건 평균은 입력 6,554·출력 5,374·추론 3,798(출력의 71%)이다.

### 개발한 변경 · `remote-curation-15`

- 참고 지식 예산을 입력 한도의 15%(1,800~4,500바이트)로 바꿨다. 운영 30,000이면 4,500, 테스트 기본 8,000이면 이전과 같은 1,800이다. 후보 본문은 300자, 최대 8개이며 참고 지식의 근거 ID는 모델에 보내지 않는다(모델이 인용할 수 없는 값이라 예산만 차지했다). 원문 예산은 그만큼 줄어 새 계획의 청크가 다소 늘 수 있다.
- 지침에 "12개는 상한이지 목표가 아니며 보통 0~5개", "한 주제의 주장은 한 변경에 anchor로 묶기", "할 일·의도·지나가는 질문은 결정·발견이 없으면 생략, 질문은 user_decision이 아님", "supersedes/retracts는 current 주장만"을 추가하고 중복 문장을 줄여 지침은 4,104→4,302바이트다.
- `CLAIM_REPLACEMENT_NOT_CURRENT`를 Worker 발행 전 검사와 출력 재생성 목록에 넣어 피드백과 함께 다시 생성한다.
- 실행 진단에 `published.changes/consolidated/relations`를 남겨 청크가 기존 문서에 합쳐진 비율(통합률)을 이후 측정한다. `consolidated`는 기존 문서의 새 Version으로 반영된 변경 수다.
- 배포 후 비교 기준: 참고 지식 선택 수(1~3 → 목표 4 이상), 청크당 변경 중앙값(4 → 감소), 새 문서 대비 통합 비율, 출력 토큰·추론 비율, 제목 겹침 쌍 증가 속도.

### Claude 수집 활성화

2026-09-14. 사용자가 Claude Code로 개발을 옮기며 이 저장소 범위의 Claude 세션 수집을 지시했다. `agent-wiki collector enable --client claude`로 `~/.claude/projects` root를 추가·활성화했고 프로젝트 범위는 기존 `agent-wiki` 저장소 하나다. 즉시 실행한 수집에서 감시 파일 4→11개, Claude 세션 7개가 모두 업로드 완료(대기·오류 0)됐고 Raw Sources에 `Agent Wiki · claude · <세션>`으로 보인다. 원문은 Codex와 같은 기록 형식(`provenance.client=claude`, 역할·시각·마스킹)으로 변환됐다. 가장 큰 세션은 15,266행이며 정제 재개 후 청킹 대상이다. 작은 세션들은 슬래시 명령 결과만 담고 있어 정제에서 `changes:[]`가 기대된다.

### 2번 모델 자동 이어가기

사용자 요청(2026-09-14): 1번 모델 `deepseek-v4-flash`의 무료 할당량(약 100K 남음)이 소진되면 손으로 바꾸지 않고 2번 모델 `deepseek-v4-flash-0731`(1M)로 이어가고, 그 사이 사용자가 2번을 1번으로 올리고 새 2번을 지정하면 끊김 없이 계속되게 한다. 2번 모델은 비워둘 수 있다.

- 설정 `fallbackModel`(nullable)을 추가했다. 같은 Endpoint·키에서만 동작하며 1번과 같으면 `AI_FALLBACK_SAME_MODEL`이다. 웹 설정 화면에 `fallback model` 입력·표시, 2번 모델 Hello 버튼, CLI `ai test --fallback`을 추가했다. `ai show`에 `fallbackActive`·`activeModel`이 나온다.
- Worker·Reprocess는 1번 모델 호출이 `AI_FREE_QUOTA_EXHAUSTED`이면 그 실행 안에서 2번 모델로 한 번 더 호출한다(호출 간격 준수, `httpRequests` +1). Workspace `ai_settings.fallback_active_since`에 기록해 이후 실행은 2번으로 시작한다. 설정 Version은 바꾸지 않아 진행 중 작업이 끊기지 않는다. 실행 이력 `settings.model`·`fallbackFrom`과 진단 `fallback{from,to,reason,at}`으로 모델별 통계가 분리된다.
- `model` 또는 `fallbackModel`을 바꿔 저장하면 `fallback_active_since`가 지워져 1번부터 다시 쓴다. 2번도 소진되거나 2번이 없으면 기존 안전 중지(`enabled=false`·중지 이유)가 그대로다. 무료 할당량 이외의 오류는 모델을 바꾸지 않는다.
- AGENTS.md·Skill·설계 문서의 "자동 모델 전환 없음" 규칙을 "사용자가 지정한 2번 모델로의 전환만 자동"으로 고쳤다. Client 0.7.5.
- 검증: Worker 통합 검사(1번 소진 → 2번 완료, 다음 작업은 2번으로 시작, 승격 저장 후 해제, 2번 부재 시 중지)와 설정 API 검사(동일 모델 거부, 표시, 2번 없는 Hello 거부)를 추가했다. 첫 배포 직후 사용자의 웹 "2번 모델 테스트"가 `AI_FALLBACK_SAME_MODEL`로 실패했다. 전환한 설정 객체에 `fallbackModel`이 남아 호출 직전 검증이 두 모델을 같다고 본 버그였고, 주입 모델을 쓰는 테스트는 그 검증을 지나쳐 잡지 못했다. `bdf3391`에서 전환 설정의 `fallbackModel`을 null로 두고 검증 단계 테스트를 추가해 [재배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34819312237)했다. 재배포 후 CLI `ai test --fallback`으로 운영 2번 모델 Hello가 성공했다(2.2초·입력 93·출력 22). 이 Hello 1회가 유일한 추가 모델 호출이다. 스키마는 `fallback_active_since` 열 추가만이며 배포 시 migration Job이 적용한다.

### 조각 크기 · 추정기 전환

사용자 질문(성공 실행의 입력이 모두 10K 미만, 32K까지 같은 단가)에 대한 판단: 조각을 키우는 것이 유리하되 한 번에 3~4배가 아니라 약 2배로 한 단계씩 올린다. 호출마다 반복되는 지침·주제·참고 맥락(현재 입력의 25~30%)이 줄고, 출력·추론은 입력에 비례해 늘지 않으며, 한 세션의 A→B→C 변화가 같은 조각에 들어갈 확률이 오른다. 3~4배로 바로 가면 호출 시간 p95 178초가 330초 제한을 넘어 재시도 비용이 커지고 12개 변경 상한과 긴 입력 누락 위험이 있다.

- Alibaba DeepSeek도 Qwen과 같은 `o200k_base`·10% 여유 추정을 쓴다(계수기 `o200k-estimate-margin10-1`). 합성 자료에서 바이트의 33%로 운영 관찰 30%와 일치한다. 참고 지식 예산·재시도 피드백 예산도 같은 계수기로 잰다. 다른 엔드포인트는 바이트 추정을 유지한다.
- 이제 `maxInputTokens`가 실제 토큰 의미다. **배포 시 사용자가 30,000 → 16,000으로 바꾸면** 실제 입력이 약 13~14K로 지금의 2배가 된다. 설정 변경은 사용자 명령이며 여기서 실행하지 않았다. 이후 p95·타임아웃·상한 도달·누락을 보고 24K → 30K로 올린다.
- 기존 작업의 청크 계획은 유지되고 새로 계획하는 청크부터 적용된다. 참고 지식의 근거 추가만으로 Version이 오를 때 `CURATION_CONTEXT_CHANGED` 재생성이 늘어날 수 있는데, 현재 운영 이력에는 0건이라 설계(모든 Version 변경은 맥락 재비교)를 유지한다.

## 재개 전 점검 · 조회 회귀 사례 · 모듈 분리 · 로컬 DB 검증

2026-09-14. 사용자가 네 항목(재개 전 점검, L4 실패 사례 수집, `knowledge.ts` 분리, 로컬 DB 검증 스크립트)의 구현·검증·배포를 요청했다. **정제는 OFF·Version 56을 유지했고 enable·retry·reprocess·reassemble·초기화는 실행하지 않았다.** 재개는 이후 사용자 명령이다.

### 실패 작업 3개의 원인 · 읽기 전용

운영 `GET /refinements`·`/refinement-sessions`로 확인했다. 세션 3개가 각각 실패 1개로 `attention` 상태이며 모두 프롬프트 `remote-curation-13`·generation 1·attempt 1 실행이다. 당시 `retryable=false`로 남았다.

| 작업 | 세션 | 청크 | 오류 | 진단 |
| --- | --- | --- | --- | --- |
| `445ccfff` | `01a0963a` | 0 / 5 | `AI_INVALID_OUTPUT` | `claims[].type`에 허용되지 않는 값 2개(권한 종류와 상태 혼동) |
| `349368bd` | `01a094be` | 8 / 9, 0~7 완료 | `AI_INVALID_OUTPUT` | `claims[]`에 허용되지 않는 키 2개(Claim 안의 `relations`) |
| `928dec4d` | `01a092a5` | 2, 1 완료 | `CLAIM_RELATION_TARGET_INVALID` | 발행 단계에서 같은 변경에 없는 관계 출발 anchor |

세 원인은 이미 배포된 `remote-curation-14`가 다룬다. 두 오류 코드를 출력 재생성 목록에 넣고 필드 경로·코드를 다음 입력에 전달하며 관계 출발점을 저장 전에 검사한다. 그러나 실패 작업 자체는 `failed`로 남아 있어 재개만으로는 다시 실행되지 않는다. 재개 절차는 다음 순서다. (1) 사용자 `ai resume`. (2) 실패 작업 3개에 `POST /refinements/<job-id>/retry`(기본, 새 모델 응답)를 실행한다. `reuseOutput=true`는 저장된 출력이 잘못된 경우라 쓰지 않는다. 성공 청크 0~7과 1은 `chunk_results`에 남아 되감지 않는다. (3) 첫 실행 결과 Claim 5~10개를 원문 근거와 비교해 검토한다. 이번에는 (1)~(3)을 수행하지 않았다.

이 밖에 완료 0·대기 417·미계획 400·청크 10/142이고 최신 세션은 `waiting_inputs=true`로 새 수집분 507개 기록이 다음 묶음을 기다린다. 7일 모델 통계는 시도 27·완료 16·실패 11·평균 97.8초·p95 178초다.

### L4 실제 실패 사례

운영 current 조회 8개를 읽기 전용으로 실행해 잘못된 후보 패턴 3종을 확인했다. 원문·Claim 본문은 저장소에 넣지 않고 합성 유사 자료로 [조회 평가 회귀 사례](../experiments/query/README.md#운영에서-관찰한-회귀-사례)에 기록했다.

- `K3s 전환 이유`, `출력 상한 max_completion_tokens`, `Wiki Page Claim 분리`는 핵심 대상(K3s·max_completion_tokens·Claim)을 단독으로 조회하면 `not_found_with_unprocessed_inputs`인데, 일반 단어("전환", "상한", "분리")와 함께 조회하면 그 단어만 맞는 문서가 `found`를 채웠다. `wiki`는 `agent-wiki`의 부분 문자열로 맞았다.
- 원인은 순위 오류가 아니라 응답이 "핵심 단어는 어디에도 없다"를 알리지 않는 것이다. 순위는 바꾸지 않고 `GET /query`·`/context`에 `unmatchedTerms`를 추가했다. 어떤 문서에도 없는 검색어 그룹의 대표형을 반환하며 조회 이력 메타데이터에는 개수만 남긴다. Skill·계약 문서에 `found`와 구분해 읽는 규칙을 적었다.
- 포함 범위 우선 규칙의 반대 급부(r04)도 기록했다. 희귀한 한 단어 문서가 흔한 두 단어 문서보다 뒤로 밀리며 Recall@3는 통과한다. IDF 가중 포함 범위가 후보 해법이나 기존 회귀 사례와 함께 비교한 뒤 결정한다.
- 기존 10문항은 두 정책 모두 10/10, 회귀 4건은 기록대로 실패(knownFailing)이며 `tests/query-ranking.test.ts`가 이 결과를 고정한다.

### `knowledge.ts` 분리

1,443행의 `knowledge.ts`를 동작 변경 없이 여섯 모듈로 나눴다. `publication-schema.ts`(입력 스키마·정규 직렬화·409), `knowledge-publish.ts`(consolidate·coalesce·publish), `article-detail.ts`(detail·search), `knowledge-context.ts`(Context 조립), `knowledge-excerpt.ts`(발췌), `source-records.ts`(원문 라우트)다. `knowledge.ts`는 라우트 연결과 `publish`·`changeInput`·`MAX_PUBLICATION_CHANGES`·`excerpt` 재수출만 남겨 Worker·automation·테스트 14곳의 import 경로를 바꾸지 않았다. 분리 전후 라우트 24개가 같다.

### 로컬 DB 검증

`scripts/test-local-db.sh`는 CI와 같은 `postgres:17.9-bookworm`·역할·포트 55432로 Codex와 공유하는 `wiki-test-postgres` 컨테이너를 기동·재사용하고 기존 `scripts/test-local.sh`(migrate + test)를 호출한 뒤 컨테이너를 정지한다. 삭제는 `--down`이다. 리팩터링 전 기준선 197개, 분리 후 197개, `unmatchedTerms`·회귀 검사 추가 후 **199개**(API·Worker·순수 173, Client 26)가 로컬에서 통과했다. 타입 검사도 통과했다. 운영 DB·모델은 호출하지 않았다.

배포: `512ca65`의 [CI·K3s 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34810055958)가 test·publish(api·web·worker)·deploy 모두 성공했다. `/readyz`는 ready다. 운영 조회 `K3s 전환 이유`는 `status=found`·`unmatchedTerms=["k3s"]`·후보 3개, `Alibaba` 단독은 `not_found_with_unprocessed_inputs`·`unmatchedTerms=["alibaba"]`를 반환해 Alibaba 전환 원문이 아직 지식에 없음을 확인했다. 배포 전후 정제 설정은 **OFF·Version 56**으로 같다. 로컬 Client는 fnm Node v26 전역 경로에 0.7.4로 갱신하고 Codex·Claude Skill을 재설치했으며 Collector 설정(Codex만·Claude 비활성·10분)은 그대로다.

## L4·L5 단계적 조회 · 배포 완료

2026-09-14. 사용자가 조회 개발·평가셋·배포를 승인했다. 작업 전 정제는 **OFF·Version 56**이며 시작·중지는 수행하지 않는다. L1·Claim·페이지·기존 실패 작업은 유지한다.

- L4에 필드별 BM25 후보 순위, current/history/overview 목적, 짧은 후보 → 고정 Claim·관계 → 원문 구간의 조회 API를 추가했다. 기존 Context 조회도 같은 후보 순위를 사용한다.
- Client 0.7.3의 query search/claim/source/trace와 Skill에 제한된 추가 검색·근거 확인·종료 조건을 추가했다. 조회는 모델·정제·검토 확정을 실행하지 않는다.
- traceId로 성공 조회 메타데이터를 연결하고 한도·격리를 적용했다. 실패는 같은 ID의 구조화 로그로 남긴다. 질문·원문·추론은 저장하지 않으며 L5 토큰은 미확인으로 반환한다.
- [합성 10문항](../experiments/query/README.md)의 후보 Recall@3는 기존/BM25 모두 1.0, 문항 10/10 통과다. 동률이며 품질 향상을 입증한 결과가 아니다. 질문→검색어 변환과 최종 답변 품질은 평가하지 않았다.
- 로컬 타입·빌드·순수 순위·CLI 검사를 통과했다. 기존 GitHub CI PostgreSQL 서비스에서 **197개** 검사(API·Worker·순수 검사 171, Client 26)와 인프라·빌드·그림 검사를 통과했다. 로컬 DB·별도 모델은 기동하지 않았다.
- 기존 한국어 회귀 사례에서 제목 한 단어가 결정문보다 앞서는 문제가 드러나 검색어 포함 범위를 먼저 비교하고 BM25를 적용하도록 수정했다. 같은 검사에서 기존 문서 전체 대체 규칙과 문자 그대로의 설정 이름도 보존했다. 테스트 자료의 UUID/text 명시적 캐스팅 오류도 수정했다. 기대 결과는 바꾸지 않았다.
- 사람이 읽을 설명과 조회 왕복 그림은 [아키텍처 L4·L5](architecture.md#l4--query--l5--answers), 에이전트 상세 명령은 Client 계약·Skill에 둔다.

배포: `dde32b8`의 [CI·K3s 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34791400095)가 성공했다. API·Web·Worker의 같은 이미지와 Ready를 확인했다. Client 0.7.3과 Codex·Claude 조회 Skill을 설치했다.

운영 확인: current 후보 8개, history 후보 5개, overview 페이지 1개를 반환했다. 대표 trace에서 검색 → 고정 Claim → 원문 2구간의 **4단계·JSON 6,412자**를 확인했다. 조회 목록과 단계별 선택 근거가 연결되고 서버 모델 호출은 **0회**, L5 토큰은 미확인이다. 이 수치는 조회 기능 확인이며 최종 답변 정확도 점수가 아니다.

배포·조회 전후 **OFF·Version 56**, 원문 **413개**·Claim **153개**·Claim Revision **55개**·실행 **31개**·실제 모델 호출 **27회**와 기존 페이지 Version이 같다. 정제 재개·실패 작업 재시도·재분석·재조립·초기화는 실행하지 않았다. Collector는 기존 범위를 유지한다.

후속 품질 관찰: 운영 지식에는 아직 과거 NVIDIA 선택이 남아 있고 최신 Alibaba 전환의 정제가 미반영되어 있다. `hasUnprocessedInputs=true`를 확인했으며 이를 최신 결정으로 답하지 않는다. 표본 Claim의 첫 근거는 질문이었고 두 번째 근거에서 임베딩 보류 결정은 확인했다. 같은 Claim에 포함된 로컬 실행 성능 판단은 선택된 두 근거만으로 충분히 확인하지 못했다. 정확한 원문 위치와 Claim 전체의 의미적 뒷받침은 별개다. 조회 기능 성공을 정제 품질 성공으로 간주하지 않으며 해당 과잉 해석은 향후 사용자 재개 후 L2·L3 검토 대상으로 둔다. 원문과 참조 ID는 Git 밖 `.runtime/query-live-*`에만 보존했다.


## 증분 개선·선택 재작업 · 배포 완료

2026-09-14. 사용자 승인 범위는 구현·검증·배포다. **정제 시작·중지는 사용자 명령이며 현재 OFF·Version 56을 유지한다.** 기존 원문·Claim·페이지·성공 처리 위치를 초기화하지 않는다.

- `remote-curation-14`: 출력 필드 오류 피드백·사전 관계 검증, 같은 출력 오류 3회 연속 후 확인 필요. Claim 문장만 출력하고 서버가 content를 조립해 중복 출력을 줄인다.
- Alibaba 무료 할당량 소진 403을 별도 식별해 현재 설정 Version만 안전 중지한다. 모델·키 자동 교체·재개는 없다. 이미 전송한 요청은 완료될 수 있다.
- 성공 범위의 재작업은 고정 원문과 변경 후보·이전 Claim을 보존한다. 에이전트 비교와 사용자 확인 후 Version을 지정해 정정한다. 원래 처리 장부를 되감지 않는다. 재조립은 AI 없이 제목별 묶음·근거 시각을 페이지 새 Version에 반영한다.
- 웹 AI Endpoint·편집·Hello, 설정 저장 시 enabled 고정, 편집 시작 Version 유지. 중복 자동정제 바와 7일 추이 표를 없애고 카드·반복 오류 목록으로 통합한다.
- 사람의 주 진입점은 architecture.md와 그림이다. 상세 계약·CLI Skill은 다음 Codex/Claude가 구현 상태와 승인 경계를 이어받도록 갱신했다.
- 검증: 기존 GitHub CI PostgreSQL 서비스에서 DB 통합 검사를 포함한 **190개** 검사(API·Worker 164, Client 26), 타입 검사·Web/API/Worker 빌드·인프라 검사를 통과했다. 로컬 DB를 새로 기동하지 않았다. 재작업 후보 생성·멱등 반영·Version 충돌·쿼타 중지·반복 오류 제한은 합성 모델로 검증했다.

배포: `7acfdaf`의 [CI·K3s 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34785353699)가 성공했다. API·Web·Worker가 같은 이미지로 Ready이며 PostgreSQL도 Ready다. Client 0.7.2와 Codex·Claude 조회 Skill을 설치했고 Claude Collector 비활성은 유지했다.

운영 검증: 설정은 배포 전후 **OFF·Version 56**, Claim **153개**·Claim Revision **55개**·실행 이력 **31개**·실제 모델 호출 **27회**가 같다. Collector가 계속 수집해 L1은 401→404개로 증가했다. 기존 실패 작업 3개도 보존했으며 재큐잉하거나 정제를 재개하지 않았다.

`reassemble`은 운영 AI 호출 **0회**, 처리 위치 되감기 없이 기존 4개 페이지에 제목별 묶음과 근거 시각을 반영했다. 페이지 Version은 제품 6→7, AI 정제 3→4, 인프라 9→10, 지식 설계 7→8이다. 기존 Claim의 의미·현재 결정·검토 상태를 자동 수정한 것은 아니다. Edge에서 근거의 기록/복구 시각, Endpoint와 고급 설정 편집·취소, 단일 자동정제 카드와 탭 순서를 확인했다. 운영 저장·Hello·재개 버튼은 실행하지 않았다.

다음 에이전트: 사용자 재개 명령 전까지 OFF를 유지한다. 재개 시 기존 실패 3개는 보존된 성공 위치에서 별도 재시도가 필요하다. 운영 `reprocess plan` 읽기 전용 조회는 성공했고 원문 본문 없이 고정 범위·영향 Claim·fingerprint를 반환했다. 재작업 요청은 0개이며 후보 생성·적용은 실행하지 않았다. 의미 연결과 현재 결정의 정확성은 다음 정제 결과를 근거와 비교해 검토한다.

### 토큰 기준선과 작은 추론 비교

사용자 재개 Version 55의 완료된 13회 관찰: 입력 92,563 · 출력 125,290 · 입력 중 캐시 5,632 · 출력 중 추론 82,177. 실패 3회의 입력+출력은 49,962다. 성공 건만 합산하면 실패 비용을 놓친다. 이 수치는 당시 실행 묶음이며 제공자 전체 쿼타 사용량과 같지 않다.

[DeepSeek 합성 비교](../experiments/curation/deepseek-efficiency/README.md)는 운영 정제와 독립된 최대 4회 탐색이다. 기대 결과는 호출 전에 고정하며 운영 모델·추론 설정은 변경하지 않는다. 실제 입력 30K 품질과 Worker 발행 검증은 별도로 본다.

실행 결과는 4회 모두 HTTP 200·JSON·인용 검사를 통과했다. 고정한 6개 기대 결과와 완전히 일치한 사례는 추론 OFF 3개, high 5개다. 입력 **2,212**·출력 **3,672**, 합계 **5,884** 토큰을 사용했다. 캐시 입력 **1,024**와 보고된 추론 출력 **2,138**은 각각 입력·출력에 포함된다. high는 더 많은 출력과 시간이 필요했지만 이번 작은 사례에서 판단 오류가 적어 기존 high를 유지한다. 일반 정확도로 확대 해석하지 않는다. 실험 입력·기대 결과·집계는 파일로 보존하며 운영 원문·추론 본문은 저장소에 넣지 않았다.

## 이전 단계 · Curation 화면·출력 오류 분석

2026-09-14. **사용자 요청으로 수정·로컬 검증까지만 수행한다. 푸시·배포·운영 큐 재시도·설정 변경은 하지 않는다.**

- 화면: 최근 7일 모델 통계·일별 표 제거, 반복 오류 상위 10개 유지. 상단 자동 정제 상태 바는 제거하고 미반영·확인 필요·다음 시도를 자동 정제 카드로 통합했다. 활성 Play는 초록, 중지 Pause는 주황이다.
- 운영 응답 3건을 파일로 읽어 원인을 확인했다. `type=proposed`(권한 종류와 상태 혼동), 새 Claim에 없는 관계 출발 anchor, Claim 내부의 `relations` 필드(변경의 `claimRelations`가 올바른 위치)다. HTTP 200 이후 검증·반영에서 실패했으며 `AI_INVALID_OUTPUT`·`CLAIM_RELATION_TARGET_INVALID`가 재생성 목록에서 빠져 있어 세션이 확인 필요 상태에 머물렀다.
- 로컬 `remote-curation-14`: 두 오류를 기존 출력 재생성 경로에 포함하고 오류 필드 경로·코드를 다음 입력에 전달한다. 관계 출발점을 스키마에서 미리 검사하고 프롬프트에 type/state와 관계 필드 위치를 명시했다. 원문·검증 기준·성공 청크·페이지를 보존하고 잘못된 출력을 임의 수정하지 않는다.
- 05:43 KST 읽기 전용 확인: 설정은 enabled=true·Version 55이지만 진행 0·실패 작업 3으로 각 세션이 막힌 상태였다. 활성 설정과 실제 작업 진행을 구분한다. 향후 배포 후에는 이 3개 실패 작업만 보존된 위치에서 재시도해야 한다. 이번에는 재큐잉하지 않았다.
- 검증: 실제 실패 응답 재생에서 잘못된 type 2개와 관계 출발 anchor 2개를 재현했다. 수정 후 관계도 저장 전에 필드 경로와 함께 거부한다. 합성 회귀·근거 참조 검사 5개·타입 검사·프로덕션 빌드를 통과했다. 새 모델 호출 0회, 로컬 DB 기동 0회. DB 통합 검사·운영 적용은 이번 범위 밖이다.

## Claim·Wiki Page 분리 · 배포 완료

2026-09-14. 사용자 최종 요청으로 아래 변경의 구현·배포와 L2·L3 초기화를 완료했다. 앞선 배포 보류 요청을 대체하며, 자동 정제 재개는 포함하지 않는다.

- L3 내부의 **Claim**은 근거·상태·적용 범위의 단위, **Decision**은 사용자 결정 Claim이다. 주제별 **Wiki Page**가 여러 Claim의 설명과 **Decision History**를 모은다. 세션 수와 페이지 수는 독립적이다. 페이지는 현재·검토 의견·과거 주장을 나누며, 명시적 대체·철회·충돌 관계를 연결한다. 시간만으로 새 결정을 채택하지 않는다.
- Worker `remote-curation-13`은 기존 주제 키를 참고하고 근거가 있는 설명·이유·제약을 추출한다. 주제가 누락된 응답은 검증 실패로 재시도한다. 같은 주제의 페이지를 트랜잭션 안에서 조립하고 내용이 바뀔 때만 불변 Version을 저장한다. 추가 페이지 작성 모델 호출은 없다. 주제 선택과 의미 연결의 정확성은 재개 후 실제 자료로 평가해야 한다.
- 인용은 `recordId` 선택 → 서버의 정확한 원문·위치 복원으로 바꿨다. 원문 불일치 검사를 풀지 않는다. 존재하지 않는 기록·제외 범위·역할·주장 관계 검증을 유지한다. 문자열 재작성 오류를 줄이는 방식이며 주장과 근거의 의미 일치를 보장하는 것은 아니다.
- OCI 원문 읽기는 인증 실패 때 principal을 갱신해 한 번만 다시 읽는다. 반복 실패는 `SOURCE_AUTH_FAILED`로 구분한다. 쓰기를 자동 반복하지 않는다. 기존 입력 전체 예산·출력 상한 생략·12개 결과 계약 수정은 유지한다.
- Knowledge 기본 목록은 Wiki Page, 근거 링크는 고정 Claim Version으로 연결한다. CLI `pages`·`page`를 추가하고 `search`의 암묵적 프로젝트 태그 필터를 제거했다. 페이지 자동 조립을 검토 완료로 취급하지 않으며 검토 확정은 기존 Claim 검토 계약을 따른다.
- 웹 중지·재개, 탭 **Curation → 수집 상태 → Raw Sources**, `세션·문서` → `세션`을 포함한다. 통합 개념 그림은 `wiki-knowledge-model.svg`, 전체 L1–L5 그림은 `wiki-layers.svg`다. 기존 별도 lineage/navigation 그림은 통합했다.

검증: 로컬 임시 PostgreSQL은 새 테이블·RLS·발행 트랜잭션 테스트에만 사용하고 종료한다. 실험 결과는 파일에 저장한다. Alibaba Flash 실제 호출 **1회**의 합성 사례에서 기록 참조·JSON 검증과 명시적인 A→B 대체 관계를 확인했다. 입력 **1,067**, 출력 **4,505**(추론 **3,835** 포함), 캐시 입력 **0**, **40.3초**였다. 해당 합성 응답은 추가 호출 없이 Worker → 발행 → Wiki Page까지 재생 검증했다. 실제 세션 전체의 품질 평가나 운영 Worker 실행은 아니다. 전체 검사 **180개**(API·Worker 154, Client 26), 타입 검사·빌드, 데스크톱의 페이지 목록·Version 전환·탭 순서·정제 버튼 저장 유지 검사를 통과했다. SVG XML·문서 링크·통합 그림 실제 렌더도 확인했다.

초기화 방침: 기존 짧은 Claim 40개는 새 주제·기록 참조 계약으로 다시 처리한다. 배포 후 L2·L3만 초기화하며 L1·Collector 수신 위치·모델 호출 이력은 보존한다. 실행 전후 파일 스냅샷으로 확인하고 정제는 `enabled=false`로 유지한다.

배포·운영 확인(2026-09-14 05:10 KST): `7f002c8`의 [CI·K3s 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34779616893)가 성공했다. Migration Job 완료, API·Web·Worker의 같은 이미지와 Ready, PostgreSQL Ready를 확인했다. 실제 Object Storage 원문 읽기와 저장 해시 일치도 확인했다. 운영 Edge에서 새 탭 순서·`3 세션` 표시·재개 버튼·정제 OFF를 확인했다. 운영 버튼으로 재개하지 않았다.

CLI 초기화 결과: 기존 Claim 문서 **40개 제거**, 원문 **387개·11,935개 기록**, 호출 이력 **18개** 유지, 작업 **387개 대기**·새 generation, Wiki Page **0개**다. 초기화 직전 원문 387개의 해시·행 수와 초기화 이후 값이 모두 같고, 기기 수신 위치 3개의 byte/record cursor가 후퇴하지 않았으며 실행 ID·상태·토큰이 모두 유지됐다. 정제 설정 **Version 54·enabled=false**도 유지한다. 초기 스냅샷 382개에서 387개가 된 것은 작업 중 Collector의 새 수집분이다. 비공개 파일은 `before-claims-pages-reset`, `before-reset-final`, `after-claims-pages-reset`, `after-reset-integrity`, `reset-verification`으로 보존한다. Client와 Codex·Claude Skill 설치도 갱신했으며 Claude 수집을 활성화하지 않았다. 테스트용 로컬 PostgreSQL·API·웹 서버는 종료했다.

## 다음 작업의 경계

- 현재는 사용자 중지 OFF·Version 56이다. 증분 개선 배포를 완료했으며 사용자 명령 전까지 정제 설정·재시도 큐를 변경하지 않는다. Codex는 Agent Wiki 프로젝트만 10분마다 수집하며 Claude는 전체 비활성이다.
- Client 키 하나로 통합한 상태다. 브라우저 승인 기반 최초 연결·토큰 만료/갱신·계정 전체 Workspace 접근은 미구현이다.
- 실제 세션의 정제·검색·검토 품질은 정제 재개 후 확인한다. 사용자 승인 없는 검토 확정은 하지 않는다. 임베딩·별도 그래프 DB·추가 AI 비교 단계는 후속 후보다.

## 중지 후 품질 점검

2026-09-14. 사용자 중지 후 CLI로 `enabled=false`, Version 54를 확인했다. 읽기 전용 `paused-quality-review` 파일에 L1 375개·11,682개 기록, 실행 18개, 지식 40개와 근거·관계·설정을 보존했다. Docker·로컬 DB·추가 모델 호출은 사용하지 않았다. 이 점검 당시에는 코드·UI 수정의 배포 보류 요청을 유지했다.

- 지식 40개의 본문은 최소 11자·중앙값 42자·최대 193자다. Worker 지침이 새 Memory를 만들고 본문을 주장들의 연결로 제한하며, 기존 페이지 수정은 금지한다. 짧은 조각이 생긴 것은 이 계약의 결과다. 주제별 위키 페이지를 자동 작성·갱신하는 단계는 없다. 목표를 [주장과 위키 페이지](l2-l3-memory.md#주장과-위키-페이지)로 명확히 분리했다. 시간순 표시만으로 조립하지 않는다.
- 모델 호출 14회 중 완료 6회·실패 8회. 별도로 저장된 응답을 재사용한 반영 1회가 성공했다. 최초 입력 제한 2회·OCI 원문 읽기 준비 실패 1회는 모델 호출 전이다. 앞서 저장 스키마 불일치(12개 허용 대 10개 검증)는 수정 배포했고, 해당 응답은 재호출 없이 반영했다.
- `EVIDENCE_MISMATCH`는 5회·불일치 인용 8개다. 모델이 줄바꿈·이스케이프를 바꾸거나 중간 구절을 빼고 여러 발언을 이어 인용했다. 단순히 공백 검증을 풀어 해결할 수 없다. 현재는 인용 하나가 틀려도 전체 응답을 다시 생성한다. 아직 오류가 모두 해결됐다고 판단하지 않는다.
- 다음 인용 계약은 모델이 원문을 재작성하는 대신 입력에서 제공한 기록 식별자를 선택하고 서버가 원문·위치를 복원하는 방식을 우선 검증한다. 범위·역할·출처 검사는 유지하며, 인용 문자열 일치와 주장이 그 근거로 뒷받침되는지의 의미 검증을 구분한다. 기존 실패 응답을 파일로 재생해 검증하고 자동 정제를 켜거나 전체 재시도를 반복하지 않는다. 이 점검 이후 구현 결과는 위 Claim·Wiki Page 분리 항목을 따른다.

| 보고된 토큰 | 이번 시작 이후 14회 |
| --- | ---: |
| 입력 | 122,171 |
| 출력 | 174,455 |
| 캐시 입력 · 입력에 포함 | 12,288 |
| 추론 출력 · 출력에 포함 | 140,965 |

추론은 출력의 약 80.8%다. 우선 인용 실패로 같은 추론을 반복하는 비용을 줄인다. 추론을 끄거나 예산을 낮추는 판단은 오류 계약을 바로잡은 뒤 작은 품질 비교로 확인한다. 성공·실패를 합친 수치이며, 실패 응답이 나중에 저장 재시도로 회복될 수도 있으므로 실패 토큰 전체를 낭비로 단정하지 않는다. 제공자 계정 전체 잔량과 이 실행 묶음의 사용량은 다르다.

## 첫 정제 실행 · 입력 분할과 출력 상한

2026-09-14. 사용자 재개 요청으로 CLI `ai resume`을 실행했다(설정 Version 48). L1 365개·11,357개 기록·3개 세션을 대상으로 시작했고, 첫 실패를 보존한 뒤 수정 배포를 위해 중지했다(Version 49). 원문·지식·호출 이력은 초기화하지 않았다.

| 관찰 | 결과와 조치 |
| --- | --- |
| 입력 구성 | 2개 세션이 모델 호출 전에 `AI_INPUT_LIMIT`. 본문 예산에는 들어갔지만 역할·제외 행 메타데이터를 합친 요청은 추정 30,550으로 30,000 초과 |
| 입력 수정 | 직렬화한 전체 요청을 측정해 미처리 청크만 재분할. 실제 실패 자료 2개 모두 29,934로 통과(228행 → 221행, 남은 7행은 다음 청크). L1·완료 범위 유지 |
| 첫 모델 호출 | Alibaba Flash 1회·143.7초. 입력 9,123·출력 16,384(이 중 추론 13,083), 캐시 입력 0. 출력 잘림 `AI_OUTPUT_LIMIT`, 지식 반영 0 |
| 출력 설정 | 사용자 의견을 반영해 `max_completion_tokens=null`이면 출력 제한 필드를 모두 생략하도록 구현. 숫자는 CLI에서 설정, 웹은 `Provider default` 표시. Hello는 별도 작은 상한 유지 |
| 관찰 보존 | 비공개 `before-first-run`·`after-first-run`·`first-run-report` 저장. 같은 L1 목록, 실행 3개 중 실제 모델 호출 1개를 구분. 입력이 없는 실패·JSON null 참조도 캡처하도록 보완 |

입력 추정 26,435와 실제 공급자 입력 9,123은 다르다. 현재 DeepSeek는 UTF-8 바이트 기반 보수 추정이므로 30K 설정을 실제 30K 토큰으로 표현하지 않는다. 추론 13,083은 출력의 부분 집합이며 합산에 다시 더하지 않는다. 초기 실패로 아직 지식·검색 품질을 평가하지 못했다.

[Alibaba DeepSeek 문서](https://www.alibabacloud.com/help/en/model-studio/deepseek-api)는 V4 추론·답변 합산 최대 393,216과 실제 입력·출력 기준 과금을 명시한다. 출력 제한 생략은 무한 생성이나 무료 보장이 아니며 제공자 기본 한도·Worker 330초 제한은 유지한다. 서버의 32K 입력 설정과 출력 상한은 별개다.

구현·운영 적용: `c08deb6`의 [검증·K3s 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34777157878)가 성공했다. CLI로 출력 제한을 생략(Version 50), 실패 작업 3개를 재시도하고 다시 활성화했다(Version 51). 운영 Edge 설정 화면의 `Provider default` 표시를 확인했다. 재개 전 체크포인트 `before-second-run`은 L1 369개·11,452개 기록이며 추가 수집 4개 때문에 최초 기준선과 엄밀한 동일 입력 비교는 아니다. 합성 Worker·청킹·세션 간 동일 주장/동시 갱신/리니지 회귀를 포함한 전체 검사 172개·타입 검사·빌드와 실제 원문 읽기 전용 재생을 통과했다.

### 두 번째 실행 · 저장 계약 검증

출력 상한 생략 후 실제 응답 3개는 모두 `finish_reason=stop`으로 도착했다. 입력 초과·출력 잘림은 없었지만 아직 지식 반영은 0이며, 추가 비용을 반복하기 전에 Version 52로 중지했다.

| 호출 결과 | 입력 | 출력 | 캐시 입력 · 입력의 일부 | 추론 · 출력의 일부 |
| --- | ---: | ---: | ---: | ---: |
| 존재하지 않는 주장 참조 | 9,123 | 10,110 | 8,704 | 5,660 |
| 저장 단계 출력 검증 실패 | 10,158 | 15,300 | 512 | 12,142 |
| 인용 21개 중 2개 불일치 | 10,158 | 15,076 | 512 | 10,659 |
| 이번 3회 합계 | 29,439 | 40,486 | 9,728 | 28,461 |

- **서버 결함:** Worker·프롬프트는 12개 변경을 허용했으나 publication API가 10개로 제한했다. 인용 13개가 모두 일치한 응답의 지식 11개가 저장 단계에서 거부됐다. 공유 상수 12개로 통일하고, 실제 Worker에서 12개를 발행하는 회귀 사례로 수정 전 실패·수정 후 성공을 확인했다.
- **모델 결함:** 다른 응답은 반환하지 않은 `clientRef`를 관계 대상으로 사용했다. 원문 인용은 모두 일치했지만 참조는 거부했다. 대상 존재 확인 지침과 오류별 재생성을 보강하며 임의로 관계를 삭제해 통과시키지 않는다.
- **인용 결함:** PostgreSQL/Cytoscape 문장에서 중간 구절을 생략하거나, 번호 목록의 줄바꿈을 공백으로 바꾼 인용이었다. 원문과 대조했고 정확 일치 검증을 유지한다.
- **추가 호출 절약:** `/refinements/:id/retry`의 명시적 `reuseOutput:true`로 저장 단계에 남은 payload만 재반영한다. 기본 재시도는 출력 캐시를 비운다. 캐시가 없으면 재반영 요청을 거부하며, 재반영도 원문·권한·Version·멱등 발행 검증을 거친다. 합성 API → 실제 Worker 검사에서 모델 호출 없이 발행을 확인했다.
- **사후 분석:** 스키마 오류의 필드 경로·코드를 기록한다. 집계는 성공/실패·오류별로 구분하고, 수동 재시도에서 attempt가 초기화돼도 같은 작업·청크의 이전 실제 호출을 찾아 재시도 사용량에 포함한다. 실패 사용량과 재시도 사용량은 중첩 관점이며 더하지 않는다.

첫 시도 포함 현재 4회 호출은 입력 38,562·출력 56,870, 캐시 입력 9,728·추론 출력 41,544다. 재생성이 같은 입력 접두사를 재사용한 호출은 캐시 입력 8,704/9,123이었다. 이 한 건으로 일반 캐시 적중률이나 추론 OFF의 품질을 단정하지 않는다. `second-run-report`는 원문 목록이 같은 두 번째 전후 캡처에서 새 3회만 집계했다. 원문과 실패 이력을 유지하며 수정 후에는 검증된 응답부터 재사용한다.

개선 우선순위는 유효 응답의 저장 실패 제거 → 오류 출력 재생성 → 캐시 배치·추론량 측정 순서다. 현재 캐시 입력 비율은 두 번째 3회에서 33.0%, 추론은 출력의 70.3%다. 같은 입력을 다시 보낸 호출과 다른 세션의 첫 호출이 섞여 있으므로 일반 적중률이 아니다. 재시도에서 출력량이 줄었지만 비결정적 모델의 소수 응답이므로 출력 상한 생략의 절약 효과로 단정하지 않는다. `source.id` 같은 변동 필드가 본문 앞에 있어 공통 접두사 캐시를 끊는지는 후속 가설로 남긴다. 순서 변경 실험은 지식 반영이 정상화된 뒤 작은 사례로만 한다.

## 실제 원문 정제 평가 · 재개 전 준비

2026-09-14. [평가 계획과 실행 도구](../experiments/curation/production/README.md)를 준비했다. **아직 정제를 재개하거나 모델을 호출하지 않았다.** 사용자가 별도로 enable을 요청하면 CLI로 재개한다.

| 준비 | 실제 확인 |
| --- | --- |
| 원문 기준선 | Codex 3개 세션·11,287개 기록, 불변 L1 361개 ID/해시·처리 상태 저장 |
| 평가 기준 | 결정·변경 관계·현재/이유 조회 12개, 개선용 10개·확인용 2개. 실제 원문에서 사용자 근거 위치를 확인하고 질문·전달된 지침은 독립된 결정 근거에서 제외 |
| 실행 설정 | Alibaba `deepseek-v4-flash`, 추론 ON/high, 입력 30,000·출력 16,384, 20 RPM·동시 5, 설정 Version 47 |
| 결과 보존 | 읽기 전용 DB 스냅샷·L3 Version/검토/주장/관계·호출 출력/진단/선택 맥락 참조·검색 응답·SHA-256·평가표 |
| 비교 | 새 호출만 입력/출력·캐시/추론·재시도분 집계. 원문 추가/삭제/해시 변경 감지. 품질은 근거 검토 전 자동 점수화하지 않음 |
| 검증 | 실제 준비 캡처·후속 캡처·비교 성공, 원문 목록 동일·호출 0·지식 0·진행 0·활성 false. 합성 집계 검사 3개 통과 |

실제 자료는 Git 제외 `.runtime/curation-evaluation/`에 0700/0600으로 저장했다. `baseline-final.json`·`anchors-final.json`은 평가 기준선과 근거 검수, `ready-to-enable.json`은 최종 준비 확인이다. 원문 탐색용 사용자 문구는 비공개 selectors 파일로 분리하면서 모델 호출 전에 평가 정의를 확정했고, 이전 기준선의 해시와 원문 목록은 보존했다. `readiness-input-check.json`은 이후 추가 수집 4개를 실제로 감지해 동일 입력 비교를 거부했다. 최종 확인은 L1 365개·11,357개 기록·호출 0·지식 0·활성 false다. Git에는 합성 검사·기준·도구만 둔다. 원문 전체나 비밀·추론 본문을 결과 파일에 추가하지 않는다.

이번 캡처는 **평가할 원문 목록을 고정**하며 실제 Worker 큐를 제한하는 기능은 아니다. Collector는 계속 실행하므로 신규 증분이 있으면 동일 입력 비교가 아니라고 표시한다. 첫 실행은 운영 흐름의 관찰 기준선이며, 추후 엄밀한 재실험은 고정 실패 사례·선행 맥락의 격리 재생으로 좁힌다. 12개 기대 사례의 근거는 주 대화에서 확인했으므로 실제 서로 다른 세션의 통합 정확성을 검증 완료했다고 주장하지 않는다.

모델을 부르지 않은 입력 조사에서 보관 텍스트 약 44.0MB → 현재 정제 투영 약 39.5MB를 확인했다. 바이트는 공급자 토큰·비용이 아니다. DeepSeek의 보수 추정과 실제 입력 토큰 차이, 청크당 최대 12개 변화 제한의 누락 가능성을 첫 실행에서 본다. 사용자는 소액 비용·일시적 실패를 허용하며, 실제 사용량을 측정하기 전에 과도한 최적화를 하지 않는다.

추가 로직 점검: Sources 미반영 수는 원천 자료의 세션 묶음, Knowledge 수는 articles에서 별도로 집계한다. 세션당 한 지식을 강제하지 않는다. 동일 주장·대상·범위·종류·권한·상태의 정확한 일치만 기존 지식에 근거를 추가하며, 다른 주장이나 범위는 분리한다. 화면·정제 로직은 변경하지 않았다. 상태 계산 검사 4개도 통과했다. DB 통합 회귀 사례는 코드로 확인했으며 현재 로컬 테스트 DB가 없어 이번에 재실행하지 않았다. 실제 모델의 의미 통합 품질은 평가 전이다.

새 서비스·스케줄러·Worker 코드·운영 모델 설정·수집 범위는 변경하지 않았다. 이 준비 도구에는 resume/reset/model 호출 경로가 없다. 실제 품질·처리 속도·비용과 무료 쿼타 잔량은 아직 측정하지 않았다.

## Knowledge·Sources 메뉴 통합

2026-09-14. L1·L2를 Sources 메뉴로 합치고 Raw Sources·Curation·수집 상태를 한 화면의 탭으로 묶었다. 수집·반영 현황은 공통이며 호출·정제 진단은 Curation 탭에 둔다. 반영 이력은 Knowledge 탭으로 옮기고 독립 Curation·Audit 페이지를 제거했다. 현재 지식의 Version·근거 링크와 L1·L2·L3 데이터 계약은 유지한다.

- **구현:** 메뉴는 Knowledge → Sources → 설정. 탭별 페이지를 초기화하고 URL·브라우저 뒤로 가기로 검색·페이지를 복원한다. 원문 상세는 Sources로 돌아온다. 정제 현황 조회 실패가 원문 목록을 가리지 않도록 분리했다.
- **문서:** 아키텍처·디자인·작업 지침과 웹 탐색 SVG·생성기를 갱신했다.
- **검증·배포:** 타입 검사·전체 테스트 165개·빌드·SVG 재생성/XML/렌더링 통과. `5a9edba`의 [CI·K3s 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34771574652)가 성공했다. 운영 Edge에서 세 메뉴·Sources 탭 전환·업로드 2페이지·탭 변경 후 첫 페이지·뒤로 가기의 탭/페이지 복원을 확인했다. Knowledge의 지식 목록·반영 이력 탭과 빈 이력 상태도 확인했다. 현재 L3가 비어 있어 실제 Version 링크의 클릭 검증은 이번에 수행하지 않았다. 기존 독립 Curation·Audit 경로는 404다. 자동 정제 `false`를 재확인했으며 데이터 초기화·모델 호출은 없었다.

## 설정·Client 연결 통합

2026-09-14. 사이드바의 에이전트 연결을 **설정**으로 바꾸고 **AI 연결 · Client 연결** 탭으로 구성했다. AI 요약은 Curation에서 옮기고 중복 토큰 필드·내부 설정·CLI 안내를 제거했다. 사이드바 계정 이름·개인 위키 문구도 제거했다. 편집은 CLI에서 수행한다.

- **구현:** Client 0.7.1의 CLI·Collector·관리 명령은 `WIKI_TOKEN` 하나를 공유한다. 서버의 Workspace 인가 경계와 작업별 권한 검사는 유지한다. 브라우저 기반 최초 연결이나 계정 단위 토큰 갱신 구현을 뜻하지 않는다.
- **실제 설정:** 기존 Workspace에 `Agent Wiki Client · MacBook` 관리 키를 발급·설치하고 역할별 이전 키 3개를 폐기했다. 이전 키 모두 HTTP 401, 현재 연결 목록 1개와 새 키의 조회·AI 설정 조회를 확인했다. 새 키로 Collector를 실행해 실패 0건이며 마지막 업로드도 서버에서 완료(85개 기록·중복 0)됐음을 확인했다. 기기 식별자·수신 위치·Codex 프로젝트 제한·10분 주기·Claude 비활성은 유지한다.
- **AI:** 입력 한도 30,000을 저장·재조회했다. 출력 한도 16,384·DeepSeek Flash·추론 high·20 RPM·동시 5개·자동 정제 중지는 유지했다. 모델 호출은 하지 않았다.
- **검증·배포:** 전체 검사 165개·타입 검사·프로덕션 빌드·그림 검사 통과. 로컬 패키지 재설치와 Codex Skill 갱신 완료. `f6ea345`의 [CI·K3s 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34771103124)가 성공했다. 운영 Edge에서 설정 메뉴·AI 7개 필드(입력 30,000)·Client 1개·계정 푸터 제거와 탭 전환을 확인했다. 배포 후에도 자동 정제 `false`를 확인했다.

## OCI 기본 오류 알림

2026-09-14. **OCI Logging → Connector Hub → Monitoring 경보 → Notifications → Slack**을 유지한다. 알림용 Function·별도 서버·GitHub 예약 조회는 추가하지 않는다.

| 항목 | 확정한 구성 |
| --- | --- |
| 감지 | ERROR/FATAL(`severityNumber >= 17`), 5분 구간 오류 지표 > 0 |
| 평가 | 1분 간격·발동 대기 1분·로그 전달 지연 허용 5분 |
| 발송 | 오류 감지·경보 해제·RESET 상태 변경. 정기 반복 없음 |
| 서식 | `Agent Wiki` 제목, 굵은 상태·코드 서식의 평가 시각·오류 로그 링크 |
| 제한 | 확인한 경보·구독 API에는 해제·RESET만 끄는 옵션이 없음. 현재는 별도 필터를 두지 않음 |
| 확인 | 02:54 발동·03:08 RESET 모두 실제 Slack 카드 수신 |

경보 해제·RESET은 앱 복구 확인이 아니다. 비용 요약·앱 배포 Actions는 유지한다. 서식 변경은 `f828c6f`에 기록했으며 Terraform으로 기존 경보 1개만 수정했다. 앱 재배포·자원 추가·정제 재개는 없었다.

<details>
<summary>배포·종단 검증과 이전 JSON 현상</summary>

- **배포:** 기존 Connector·경보·SLACK 구독을 재사용하고 ACTIVE를 확인했다. 오류 조회 workflow를 비활성화하고 전용 `OCI_LOG_CONFIG` secret·비용 조회 계정의 로그 권한·오류 포맷 코드를 제거했다. `ONS_OPTIMIZED`와 단일 SLACK 구독을 유지한다.
- **로컬 검사:** Terraform 모의 검사 3개·비용 알림 검사 12개, 운영 그림 XML·렌더링을 통과했다. 서식만 수정한 이후에도 Terraform 모의 검사 3개를 통과했다.
- **최종 실제 경로:** 02:45:17 Worker stdout 합성 ERROR → 02:48:33 OCI Logging 전송 HTTP 200 → 02:49 오류 지표 1건 → 02:54:27 경보 발동 → 02:54:29 [발동 카드](https://hyune-c.slack.com/archives/C0C19NLR9PG/p1789322069229589) → 03:08:38 [RESET 카드](https://hyune-c.slack.com/archives/C0C19NLR9PG/p1789322918936799). Slack 웹에서 굵은 상태·코드 시각·링크와 빨강/녹색 경계를 확인했다. 시각은 한국 시각이며 카드 본문의 ISO 시각은 경보 평가 시각이다.
- **시험 실수:** 첫 02:39 합성 로그의 시각 형식이 수집기와 달라 제외됐다. 실제 앱과 같은 밀리초 UTC `YYYY-MM-DDTHH:mm:ss.SSSZ`로 수정한 위 시험만 OCI 경로를 통과했다. 합성 시험이며 실제 앱 장애가 아니다.
- **이전 JSON 현상:** 앞선 02:14 발동은 카드였으나 02:28 RESET은 경보 메타데이터 JSON이었다. 당시에도 `ONS_OPTIMIZED`·활성 SLACK 구독 1개·Monitoring 연결이 확인됐다. 이후 같은 경로의 한 번의 발동·RESET 주기는 정상 카드였지만, 이전 서비스 내부 원인은 확정하지 못했다. 서식 갱신이 근본 원인을 해결했다고 단정하지 않는다.
- **재발 시:** 해당 Slack 메시지 시각·경보 type·실제 경보 설정·구독 수를 함께 확인한다. 앱 원문 로그와 경보 메타데이터를 구분하며 발동 카드만으로 RESET 표시까지 검증됐다고 보지 않는다.

공식 문서는 [Slack 경보 카드](https://docs.oracle.com/en-us/iaas/Content/Monitoring/alarm-message-examples.htm)와 [제목·본문 동적 변수](https://docs.oracle.com/en-us/iaas/Content/Monitoring/Tasks/update-alarm-dynamic-variables.htm)를 지원한다고 설명한다. Email 전용 friendly formatting을 Slack 서식 미지원으로 해석하지 않는다. RESET이 원래 JSON이어야 한다는 공식 근거는 확인하지 못했다. 복구 알림 옵션은 OCI MCP의 `UpdateAlarmDetails`·`UpdateSubscriptionDetails`와 [알림 설정 문서](https://docs.oracle.com/en-us/iaas/Content/Monitoring/Tasks/create-edit-alarm-notification.htm)를 확인한 범위다.

</details>

## OCI MCP · 관리 도구

2026-09-14. 이 개발 세션에 `oracle_oci`의 클라이언트 목록·작업 목록·API 검색·명세 조회·API 호출 도구 5개가 노출됐다. 경보·구독 업데이트 명세 조회를 실제 실행했다. 이는 SDK 명세 조회이며 계정 인증·운영 자원 조회 성공을 검증한 것은 아니다. Wiki 조회 MCP나 원격 앱 컴포넌트의 배포와 구분한다.

<details>
<summary>이전 구현·배포 검증 기록 (당시 수치·명령)</summary>

이하의 수치·모델·UI·인프라·알림 방식은 각 작업 당시의 기록이다. 현재 기준은 위 요약과 설계 문서를 따른다.

## 연결 화면 안내 제거

2026-09-14. 에이전트 연결의 권한 발급 안내·Workspace ID·복사 버튼을 제거했다. 기존 연결 목록과 인증·인가 동작은 유지한다. 계정 단위 클라이언트 로그인·토큰 갱신 방식으로의 변경은 이번 범위에 포함하지 않는다. Web 타입 검사와 [CI·K3s 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34767825223)를 통과하고 운영 Edge에서 안내 박스 제거를 확인했다. 배포 코드 `51605ea`.

사용자와 정리한 연결 단위는 기기별 Agent Wiki Client 하나다. CLI·Collector·관리는 같은 계정 연결을 공유하고 Workspace는 작업 대상을 선택하는 단위다. 당시 표시된 세 항목은 초기 역할별 API 키였다. 위 최신 설정·Client 연결 통합에서 키 교체를 완료했다. 브라우저 승인 기반 최초 연결·자동 만료/갱신·계정 전체 Workspace 접근은 후속 구현이다.

## 로그인 직후 위키 진입

2026-09-14. 로그인 후 `/workspaces`에서 접근 가능한 첫 Workspace의 Knowledge로 바로 이동한다. 별도 목록 화면·공간 관리 링크를 제거하고 사이드바 Workspace 전환을 유지한다. 로그인 전·요청 실패·Workspace 없음은 공통 진입 화면에 표시한다. Web 타입 검사·프로덕션 빌드와 [CI·K3s 자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34767555123)를 통과했다. 운영 Edge의 기존 GitHub 로그인 세션으로 `/workspaces` 진입 → 개인 작업 Knowledge 자동 이동, 사이드바 Workspace 선택 메뉴 유지를 확인했다. GitHub OAuth 재로그인은 따로 실행하지 않았다. 배포 코드 `2a30e64`.

## 웹 안내 간소화

2026-09-14. 사용법 메뉴·페이지·진입 링크를 제거하고 로그인 설명을 한 줄로 줄였다. 소유자 안내 문구만 지우며 GitHub 소유자 인증 정책은 유지한다. Web 타입 검사·프로덕션 빌드와 [CI·K3s 자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34767201921)를 통과했다. 운영 Edge 화면에서 설명 한 줄·소유자 안내 제거를 확인했고 삭제한 `/guide` 주소의 HTTP 404를 확인했다. 배포 코드 `7b50189`.

클라이언트 연결 조사: 현재 키는 초기 구축 시 관리자 경로로 발급해 로컬 Git 제외 env에 저장했다. 웹은 키 메타데이터 조회만 제공하며 CLI 최초 브라우저 로그인·자동 토큰 전달은 아직 없다. 현재 API 키에는 자동 만료·갱신이 없다. 브라우저 승인 뒤 짧은 접근 토큰과 회전하는 갱신 토큰을 전달하고 기기별 연결 해제로 폐기하는 방안을 논의했으며, 이번 화면 수정에 인증 체계 변경은 포함하지 않았다.

## K3s 전환

2026-09-13~14. 기존 OCI A1 VM에서 **K3s 전환·CI/CD·운영 확인 완료**. `eb2699b`의 [전체 검증·이미지 게시·K3s 자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34764507371)가 성공했다. migration Job 완료 후 API/Web/Worker가 같은 이미지로 갱신됐고 HTTPS를 다시 확인했다.

- 런타임: K3s `v1.36.4+k3s1`, Traefik chart `41.5.0`, cert-manager `v1.21.2`. Web/API/Worker Deployment, PostgreSQL StatefulSet과 기존 데이터 경로의 local PV다. 별도 노드·관리형 LB·볼륨은 만들지 않았다. Terraform apply는 자원 추가/변경/삭제 0, 최종 plan도 변경 없음이다.
- 전환: 처음 로그 문법·Traefik chart 설정 오류에서 Compose로 두 번 복귀했다. 이후 사용자 지시에 따라 전체 중단을 허용하고 K3s에서 수정해 마쳤다. Compose 설정·이전 배포 스크립트·호스트 실행 서비스와 Caddy 인증서 의존성은 제거했다. DB는 한 번에 한 프로세스만 같은 디스크를 사용했다.
- 네트워크: OCI VCN과 겹치지 않게 Pod `10.52.0.0/16`, Service `10.53.0.0/16`을 사용한다. HTTPS API 경로는 Web보다 높은 우선순위로 선언했다. 외부 3000/3001/6443/10250 차단, 기존 443/DB 관리 5432 연결, Web→API 허용과 Web→DB/관리 API/인터넷 차단을 실제 확인했다.
- 인증·상태: HTTP→HTTPS, GitHub OAuth 시작 302, 인증된 CLI 조회, DB 인증서 검증 접속 성공. cert-manager ACME 발급 요청이 Ready이고 새 인증서를 발급했다. 원문 314건·지식 0에서 시작했으며 BYOK Version 46·자동 정제 false·Claude 비활성·Codex Agent Wiki 제한을 유지했다.
- 수집·로그: 실제 Collector 증분 56개 기록이 업로드·검증 완료되어 원문 3건을 추가했다. K3s CRI 로그를 기존 rsyslog가 JSON으로 풀어 기존 OCI 수집 파일에 기록한다. syslog 읽기 ACL을 새 로그에도 상속하며 `upload_completed` 기록·전송 응답 200·OCI Log Search의 같은 이벤트를 확인했다. 정제 재개나 모델 호출은 하지 않았다.
- 재기동: VM을 실제 재부팅해 기존 Block Volume 마운트·K3s·DB·앱·HTTPS 복구와 Docker 비활성 유지를 확인했다. 과거 컨테이너 DNAT 규칙은 영속 방화벽에서 제거하고 K3s가 부팅 때 재구성한다.
- 검증: 서버·클라이언트 165개, K3s 계약 7개·Terraform 모의 검사 3개·타입 검사·프로덕션 빌드·셸 문법·SVG XML/렌더 통과. 유휴 관측에서 노드 메모리 약 1.8GiB, CPU 약 0.27코어였다. 단일 노드 장애·OS/K3s 업데이트는 여전히 직접 관리한다.

## 후보 검색과 결정 리니지

2026-09-13. **구현·배포·운영 확인 완료**. 코드 `f93ea2d`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34761739541)가 성공했다.

- L2 후보: pg_trgm 유사도 순에서 Workspace 현재 주장 전체의 BM25 → 최대 24개 → 대상·범위·별칭·주제 다양성 재정렬 → 최대 6개/1,800바이트로 변경했다. 무관한 후보를 억지로 채우지 않으며 검색 정책·후보 점수·선택 이유·선택 Version을 실행 진단에 기록한다. 별도 검색 서버·임베딩은 추가하지 않았다.
- 리니지: 같은 청크에 처음 등장하는 A → B도 각각 저장하고 `clientRef`로 연결한다. 자기/미래/없는 참조는 원자적으로 거부한다. 기존 원문·과거 주장을 유지하고 정정 근거로 현재 상태를 계산한다. L4 관계 조회는 최대 8단계/40개이며 기본 현재 결정, history는 과거·변경 근거다. 시각만으로 대체하지 않는다.
- 정규화: 실제 응답에서 관찰한 중복된 과거 상태 표기는 역할·대상·범위가 일치하는 명시적인 관계가 있을 때만 관계에서 계산하도록 바꾼다. 원래 응답은 보존한다. 근거 없는 과거 상태 승격·검색 유사도만의 병합은 허용하지 않는다.
- 모델: 작은 합성 사례에서 OFF, ON 1,024, ON 4,096, ON high를 총 4회 비교했다. 입력 3,496 / 출력 10,088(보고된 추론 포함)토큰. 현재 추천은 단일 호출·ON high·thinking_budget 미지정이다. 두 좁은 예산 실행은 계약 실패/잘림이며 비교 한계를 [실험 기록](../experiments/curation/lineage/README.md)에 남겼다. 일반화된 품질 보장은 아니다.
- 검증: 서버·Worker 143개 + Client 24개 = 167개, 타입 검사·프로덕션 빌드 통과. 실제 모델의 저장 응답을 로컬 Worker에 재생했고, 네 결정의 현재/이력 조회와 불변 근거를 검증했다. SVG XML·링크·렌더 확인 완료.
- 남은 설계: 조건부 추가 AI 비교·단계별 모델 분리는 설계만 했다. 기본은 한 번의 호출이며 강제 이중 호출하지 않는다. 전체 실제 세션의 의미 품질·추출 완전성·검토 의견 누락은 자동 정제 재개 후 사후 검토 대상이다. 자동 정제 중지·Claude 비활성·Codex 프로젝트 제한은 유지한다.

운영 확인: 실제 CLI로 기존 Alibaba BYOK에 `enable_thinking=true`, `reasoning=high`, `thinking_budget=null`을 저장하고 다시 읽었다(Version 46). 입력 25K·전체 생성 상한 16,384·20 RPM·동시성 5·재시도 30초·기존 키는 유지했다. 자동 정제 `false`, 진행 작업 0, 원문 세션 Codex 3개다. 운영 원문 정제나 별도 Hello 호출은 하지 않았고 실험 4회와 구분한다. 다른 작업의 Slack 표시 수정은 이번 배포에 포함하지 않았다.

## 에이전트 관리·검토와 출처 통합

2026-09-13. **구현·배포·운영 확인 완료**. 코드 `c72aa58`의 [CI·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34758898152)가 성공했다.

- Collector: 공통 선별 형식 conversation-2, Codex/Claude 메시지·부모·도구 연결·컴팩션 출처 보존. 파생 요약은 사용자 결정이나 도구 확인으로 승격하지 않는다. 큰 Claude 첫 메시지는 스트리밍으로 프로젝트·세션 ID를 확인한다.
- 수집 제약: Claude 전체 비활성화. Codex Agent Wiki 프로젝트만·10분·기기/수신 위치 유지. 합성 Claude 자료의 실제 Collector→업로드 API→L1 확정 경로를 로컬에서 검증했다. 다른 프로젝트의 실제 Claude 기록은 업로드하지 않았다.
- L2/L3: Workspace 전체의 주제·범위 후보를 우선한다. 동일한 단일 주장은 근거를 합쳐 새 Version에 보존하고 동시 갱신 시 다시 비교한다. 클라이언트가 다르다는 이유로 지식을 나누지 않는다. 의미가 다른 주장의 무조건 병합은 하지 않는다.
- 검토: CLI 검토 대기·개념 비교·사용자 승인 후 확정. 최근 검토 스냅샷 기준, Version/해시 충돌 검사, 검토 이력 불변. 전용 의미 병합·분리 명령·임베딩·그래프 DB는 후속이다.
- 관리: Workspace `manage` 키, CLI 설정/Hello/중지/재개/관리 API. 웹은 읽기 전용 뷰어. Free 모드·모드별 키 프로필을 제거하고 BYOK만 남긴다. 기존 Alibaba 연결·중지 상태는 유지한다.
- 로컬 검증: API·Worker 합성 129개, Client 24개(총 153개)·타입 검사·프로덕션 빌드·SVG XML/링크/렌더 검사를 통과했다. 모델은 주입한 합성 응답으로만 검사했다. 실제 AI 호출·자동 정제 재개·유료 OCI 자원 추가는 하지 않았다. 검토 문서는 `l2-l3-memory.md`, 명령은 `client-and-api.md`, 그림은 `wiki-review.svg`에 통합했다.

운영 확인(2026-09-13 22:13 KST): Client 0.7.0과 Codex/Claude Skill을 로컬에 설치했다. 기기 식별자·수집 제한·10분 예약을 유지했다. 수집 실행은 기존 대기분 51건을 확정했고, 새 `conversation-2` 업로드 8건도 서버 `completed`를 확인했다. 수집 실패 0건, 원격 원문 세션은 Codex 3개이며 실제 Claude 업로드는 하지 않았다.

관리 키는 해당 Workspace에 한정해 루트 Git 제외 `.env.local`의 `WIKI_MANAGEMENT_TOKEN`에 저장했다. 실제 CLI로 설정 조회·25K 입력 예산 저장·중지 상태·검토 대기 조회를 확인했다. 기존 Alibaba 키/모델과 20 RPM·동시성 5·재시도 30초를 유지했고 설정 Version은 45다. 자동 정제 `false`, 실행 중 작업 0, 이번 작업 중 모델 호출 0이다. 운영 웹에서 BYOK 단일 읽기 화면과 Knowledge의 편집 버튼 제거를 확인했다. 현재 L3는 비어 있으므로 실제 지식의 사용자 검토 확정은 하지 않았다. 검토·동시 통합의 품질은 합성 경로 검증이며 실제 모델의 의미 판단을 보장하지 않는다.

## Alibaba DeepSeek Flash 전환

2026-09-13. 사용자 선택에 따라 벤치에서 확인한 범용 `deepseek-v4-flash`를 대상으로 한다. 루트 `.env.local`의 `DASHSCOPE_MODEL`을 변경했으며 API 키·Singapore 주소는 유지한다. Flash·Pro와 각 날짜 ID의 무료 쿼타는 별도이고 한 모델이 합산 4M을 쓰거나 다른 ID로 자동 전환하지 않는다. 자동 정제는 재개하지 않는다.

Alibaba DeepSeek V4도 Qwen과 같이 `enable_thinking`·`thinking_budget`·`max_completion_tokens`를 저장·전달하도록 API와 고급 설정 UI를 확장했다. 추론 OFF일 때 thinking_budget은 보내지 않는다. Alibaba의 정제·Hello 요청에는 `response_format=json_object`를 적용하며 응답 구조·원문 검증은 유지한다. NVIDIA의 요청 형식과 Free 기본 모델은 유지한다. DeepSeek 입력은 현재 보수적 UTF-8 바이트 추정이고, Qwen 전용 토큰 추정기를 그대로 적용하지 않는다.

로컬 검사 137개·타입 검사와 앱 `9f9cb07`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34756102294)가 성공했다. 운영 웹에서 Flash·enable_thinking=false·생성 16,384·입력 설정 25,000·20 RPM·동시 실행 5·재시도 30초를 유지해 저장했다. Hello는 1.1초·입력 14 / 출력 5토큰으로 성공했다. 이 테스트는 정제 실행이 아니며 사용자 지시에 따라 자동 정제는 계속 중지한다. 원문 수집·기존 무료 전용 설정은 유지한다.

## Alibaba 정제 모델 비교

**최신 재비교:** 첫 비교에서 JSON 모드 없이 파싱 실패 모델을 후보에서 좁힌 판단을 수정했다. Plus를 포함한 5개 모델에 같은 작은 입력·`json_object`·추론 OFF를 적용해 각 1회 재호출했다. 모두 JSON 파싱에 성공했으나 Max는 사례 2개와 필드를 누락했다. Alibaba DeepSeek V4 Flash는 변경 의도 9/10·검증 여부 10/10·인용/필수 출처 10/10으로 다음 Worker 검증의 우선 후보다. Plus는 변경 의도·인용은 10/10이나 검증 여부는 2/10이었다. 자동 점수와 별개로 근거 충분성·과잉 해석도 검토했다. [수정된 비교표·한계](../experiments/curation/model-selection/README.md).

재비교 5회와 직전에 완료된 Plus 비교 1회를 합쳐 추가 입력 10,897 / 출력 9,599토큰이다. 범용 Plus 무료 1M·만료 2026-11-26·무료 전용 Enabled를 확인했다. 운영 모델·25K·정제 중지는 유지했고 앱 배포·실제 Worker 발행 검증은 하지 않았다. 아래 최초 Max 추천은 이 결과로 대체한다.

2026-09-13. 범용 Qwen 3.8 Max·3.8 Flash·3.7 Flash·DeepSeek V4 Flash를 합성 사례 10개로 비교하고, Max·3.8 Flash에 약 30K 입력과 JSON 모드를 추가 비교했다. 총 6회·입력 67,265 / 출력 8,180토큰이다. 품질 우선 후보는 Max지만 필수 문자열 2개가 null이었고, Flash는 철회를 검색 방식 부재로 과잉 해석했다. 어느 후보도 전체 계약을 완전히 통과하지 않았다. [비교표·실패 사례·원래 응답](../experiments/curation/model-selection/README.md).

무료 쿼타·무료 전용 설정을 확인한 독립 평가이며 실제 Worker 발행 검증과 구분한다. 운영 BYOK·25K 입력·자동 정제 중지를 유지했다. 긴 입력 성공을 큰 청크의 품질 우위로 해석하지 않는다. 다음 적용은 명시적인 출력 스키마와 원문 기반 의미 검사부터 진행하며 이번 작업에서는 앱 코드·배포·큐·지식을 변경하지 않았다.

## Qwen 추론 소규모 비교와 사후 기록

2026-09-13. 합성 사례 6개를 두 입력에 묶어 off/1024/2048을 각 2회, 총 6회 호출했다. 실제 세션·정제 큐·지식은 건드리지 않았으며 12,031토큰을 사용했다. 분류 일치는 5/6·4/6·3/6, 근거·대상까지 모두 일치는 2/6·2/6·1/6이었다. 작은 판단용 비교여서 실세션 정제 성능을 일반화하지 않는다. 임시 설정은 추론 끔이며 추가 호출은 중단했다. [조건·원래 응답·측정값](../experiments/curation/thinking/README.md).

BYOK에 enable_thinking/thinking_budget/max_completion_tokens를 연결하고 필드명은 영문 스펙명으로 표시한다. Wiki 입력 한도는 maxInputTokens로 구분한다. 캐시·추론 사용량과 종료 사유를 실행 기록에 보존하고 호출 목록에 입력/출력·캐시/추론·당시 설정을 표시한다. BYOK는 20 RPM·최대 동시 실행 5·재시도 30~36초로 조정한다. Free는 20 RPM·1개·120~144초다. 같은 세션은 순차 처리하며 VM 자원 한도는 유지한다. 종료 때 신규 수신을 멈추고 모든 진행 슬롯을 함께 기다린다. 로컬 합성 검사 135개·타입 검사·프로덕션 빌드를 통과했다. 5개 동시 선점과 6번째 대기, Qwen 25K 추정 청킹의 순서·전체 범위 보존을 확인했다. 변경 SVG의 XML 검사·실제 렌더링을 확인했다. [CI·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34754602454)가 성공했고 API·Web·Worker·DB healthy를 확인했다. 운영 웹에서 Qwen BYOK 입력 25,000·생성 16,384·enable_thinking=false·20 RPM·concurrency=5·retryDelaySeconds=30·일일 제한 없음을 저장하고 새로고침 후 유지됨을 확인했다. 자동 정제 중지·모델 호출 0을 유지했으며 추가 실제 모델 호출은 하지 않았다. 기존 설정을 처음 읽을 때 진행 카드에 새 한도가 undefined로 보이는 문제도 스키마 기본값 적용으로 수정했고 관련 검사 4개·타입 검사를 통과했다. [후속 CI·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34754849518)도 성공했다. 전체 검사 136개를 통과했고 앱·Worker·DB healthy를 다시 확인했다.

## AI 연결 화면과 Hello 테스트

2026-09-13. Free/BYOK 두 모드로 단순화했다. Free는 NVIDIA 기본 연결을 자동 선택하며 BYOK만 주소·모델·키와 접힌 고급 설정을 표시한다. 모드별 암호화된 키·설정을 보관하고 활성 설정만 Worker에 적용한다. API 주소의 origin이 달라지면 새 키를 요구한다. L1·정제 상태는 바꾸지 않는다.

Hello 테스트는 입력 중인 설정과 해당 모드의 키를 사용한다. 웹 소유자 세션 전용이며 20초·분당 3회·키별 공통 호출 간격을 지킨다. 응답 시간과 입력/출력 토큰을 표시한다. 저장과 정제 활성화는 실행하지 않는다. 합성 검사 130개·타입 검사·프로덕션 빌드를 통과했다. 모드 전환 후 키 보존·주소 변경 차단·테스트 시 설정/큐 불변·미인증 차단을 확인했다. [CI·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34753232550)가 성공했다. 운영 웹에서 Free/BYOK 두 모드·기존 NVIDIA 키 유지·자동 정제 중지를 확인했다. Free 테스트 화면에 Hello 성공(0.3초·입력 14/출력 6 토큰)이 표시됐다. BYOK 입력 때 Bitwarden 자동완성 UI가 브라우저 자동화를 막았으나, Edge 네이티브 UI로 입력·테스트·저장을 완료했다. 연결됨 체크 아이콘도 테스트 성공과 같은 녹색으로 통일했다. [아이콘 수정 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34753435651)가 성공했다. 이 마지막 색상 변경의 브라우저 재확인은 같은 확장 UI 차단으로 보류했다.

## Alibaba Workspace BYOK

2026-09-13. 사용자 선택은 싱가포르 무료 쿼타의 Qwen 3.7 Flash 일반 호출이다. 서버 기본 제공자·모델은 유지하며 개인 작업 Workspace의 OpenAI 호환 BYOK로 설정한다. 기존 비공개 연결 정보의 정확한 API 호스트만 API·Worker 허용 목록에 추가했다. 브라우저에서 선택 모델 `qwen3.7-flash-2026-07-15`의 Stop-on-Exhaust Enabled와 잔량 약 999.79K/1M을 확인했다. Batch는 무료 쿼타에 포함되지 않아 사용하지 않는다.

Qwen의 추론 사용 안 함은 `enable_thinking: false`로 전달하며, 기본값은 제공자 기본 설정을 따른다. 지원하지 않는 세부 추론 수준은 요청 전에 거부한다. NVIDIA와 다른 OpenAI 호환 제공자의 요청 형식은 유지한다. 모델 전송 합성 검사 12개·타입 검사를 통과했다. 운영 웹에서 `qwen3.7-flash-2026-07-15`·싱가포르 주소·API 키를 BYOK로 저장했다. 입력 예산 25,000·최대 출력 16,384·추론 사용 안 함·일일 제한 없음이다. Hello 테스트는 0.8초·입력 22/출력 5토큰으로 성공했고 새로고침 후 BYOK·모델·키 저장 상태를 재확인했다. 자동 정제는 중지 상태를 유지했다.

초기 BYOK 저장 당시 입력은 UTF-8 바이트 기반이었다. 이번 변경은 QwenCloud 권장 `o200k_base` 추정 + 10% 여유로 25K 입력 상한을 계획한다. 지침·참고 맥락을 포함하고 추정 방식·실제 입력 토큰을 실행에 함께 남긴다. 호스팅 모델의 정확한 토큰 수나 항상 25K를 채우는 보장은 아니며, 원문 보관과 완료된 청크는 유지한다. 간결한 본문/근거 ID 표현·긴 도구 결과 선별·변경분만 출력은 후속 검토다.

## 세션 중심 진행률

2026-09-13. 기본 화면에서 원문 조각·정제 청크 수를 제거했다. L1은 기록 수·마지막 수집을 15초마다 갱신하고, L2는 세션 상태·이번 처리 진행률·새 기록 대기·마지막 반영을 표시한다. 처리 시작 때 미처리 수집 범위에 식별자를 부여하고 새 증분은 다음 처리로 남긴다. 진행률은 해당 범위의 반영된 원문 행 비율이며, 크기가 다른 청크 개수를 단순히 나누거나 새 수집분을 분모에 더하지 않는다. 모델 응답 저장과 지식 반영 완료도 구분한다.

스키마 변경은 기존 작업에 nullable 범위 ID·시작 시각 2개를 추가한다. L1·지식·수신 위치를 초기화하지 않는다. 재시도·중지·재개에는 범위를 유지하고 L2·L3 재생성에는 범위를 비운다. 합성 검증에서 증분 도착 후 25% 유지·서로 다른 청크 길이·작은 모델 묶음 여러 개·재시도·반영 중·다음 수집분 대기·초기화·Workspace 격리를 확인했다. 전체 검사 127개·타입 검사·빌드·SVG XML·실제 렌더링을 통과했다. 로컬 화면 연결은 Edge가 차단해 운영 화면에서 확인했다. [CI·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34751725954)가 성공했고 API·Web·Worker의 `0063949` 이미지·healthy와 기존 DB/Caddy 유지를 확인했다. 19:27 한국 시각 자동 정제 OFF·모델 호출 0·지식 0을 유지하며 세션별 대기 기록 8,135/259/226개가 서버와 화면에서 일치했다. 다크·라이트에서 새 목록·내부 조각 수 제거·정제 중지 상태를 확인했다. 진행률·반영 중·재시도 상태는 합성 DB 검사로 검증했으며 실제 모델 호출은 하지 않았다.

## Collector 선별 보관 전환

2026-09-13. 사용자 요청으로 자동 정제와 Collector 스케줄을 먼저 중지했다. `conversation-1`은 대화·도구 요청·결과를 보존하고 메타데이터·내부 추론·UI 완료 이벤트·반복 컴팩션 스냅샷을 제외한다. 원본이 없는 스냅샷 메시지는 출처를 구분해 복구한다. `stream-mask-3`은 원본 수신 위치와 선별 이벤트 수를 분리하며 제외 이벤트만 추가돼도 빈 L1 작업 없이 커서를 확정한다. 원격 Wiki 데이터와 수신 상태를 초기화했다. 기존 보관 조각 1,376개·지식 13개·호출 이력 136개와 원문 관련 객체 2,191개를 삭제했고, Agent Wiki 세션 3개를 처음부터 재수집했다. 정제는 사용자가 다시 요청할 때까지 중지한다. 인증·OCI 인프라·모니터링 체크포인트는 초기화 대상이 아니다.

[Collector 변경 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34750192689)와 클라이언트 0.6.0 설치를 완료했다. 18:59 한국 시각 기준 세션 3개의 기준 시점 수신 위치를 모두 확정했다. 보관 기록은 메인 8,033개·나머지 226개/259개, 압축 보관량 합계 50.2MB이며 현재 대화의 새 증분은 계속 추가된다. 같은 시점 제외한 실행 이벤트는 20,198개다. 이 수치는 대화·도구 기록 수이며 과거 화면의 필드 분할 줄 수와 직접 비교하지 않는다. 메인 로컬 로그 약 262MB의 선별 전후 측정에서는 이미지 포함 비압축 본문이 약 79MB로 줄었다.

업로드 중 한 차례 수집 실패 뒤 이미 올린 부분을 이어서 완료했다. 자동 정제 OFF·새 모델 호출 0·지식 0, 보관 본문 해시·근거 줄 수 일치를 확인했고 Collector는 Wiki 프로젝트 한정·10분 주기로 복구했다. 합성 회귀 검사 125개·타입 검사·빌드, SVG XML·상대 링크·실제 렌더링을 확인했다. 실행 로그 전체는 로컬에 유지하며 L1에는 결정적 규칙으로 선별한 기록만 보관한다.

L2·L3 초기화는 Curation 화면에서 공간 관리의 데이터 관리로 옮겼다. L1·수집 위치·AI 설정·호출 이력은 보존하며, L2 결과와 수동 지식을 포함한 L3를 지우는 범위를 확인창에 표시한다. 초기화 뒤 자동 정제는 중지 상태다. [최종 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34750636061)가 성공했고 API·Web·Worker healthy·기존 DB/Caddy 유지를 확인했다. 운영 웹에서 Curation 버튼 제거·데이터 관리 열기·확인창의 삭제 범위·취소 동작을 검증했다. 확인창 검증에서는 추가 초기화를 실행하지 않았다.

## 세션별 정제 묶음과 호출 이력

2026-09-13. 작은 같은 세션 증분을 묶어 청킹하도록 변경했다. 최대 32개·4,096행의 미처리 범위를 고정하며 기존 진행 청크·L1·지식은 유지한다. 원문별 처리 행은 내부 장부로 남고 대표 작업만 실행한다. 같은 업로드의 범위는 한 번 읽고 진행 입력 하나만 최대 8MB 메모리에 재사용한다. 인용은 검증 후 각 원문 ID·행으로 환산한다. 새 증분은 다음 묶음에서 처리하고 재시도는 성공 청크를 건너뛴다.

Curation은 상태·처리한 원문 조각·이번 묶음 청크·다음 대기로 구분한다. 호출 생략과 반영만 재실행한 기록은 내부에 보존하되 호출 목록·오늘 호출 수·일일 한도에서 제외한다. 합성 작은 증분 2개는 모델 호출 1회로 반영하고 원문 2개의 근거를 유지했다. 데스크톱 1440px 다크·라이트에서 목록과 호출 생략 30건 제외를 확인했다. 전체 검사 119개·타입 검사·SVG XML과 실제 렌더링을 통과했다. 배포 전 원문 1,341개·지식 12개·자동 정제 활성·기존 청크 위치 48/54를 확인했다. [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34748306295)가 성공했다. 17:47 한국 시각 API·Web·Worker가 `7d7a2e6` 이미지로 healthy, DB·Caddy 유지, 원문 1,353개·지식 12개·자동 정제 활성·기존 48/54 위치 유지를 확인했다. 실제 브라우저에서 새 컬럼과 호출 생략 제외를 확인했고 `remote-curation-9`가 기존 청크에서 HTTP 요청을 재개했다. 첫 응답의 `AI_INVALID_JSON`은 자동 재시도 대기이며 다른 세션 호출은 진행 중이었다. 새 다중 원문 묶음의 근거 반영은 합성 검사로 검증했고, 기존 묶음이 끝난 뒤 실제 자료에서도 확인한다.

## 비용·사용량 신호등

2026-09-13. 비용 요약은 A1 CPU 1,500 OCPU·시간·메모리 9,000 GB·시간의 보수적 월 예산, Object Storage 월 요청 50,000건, 부트+블록 볼륨 200GB, Wiki Standard 버킷 10GB 대비 사용률을 표시한다. PAYG의 저장소 기준은 [OCI Always Free 안내](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)를 확인했다. 다른 리전·구획·버킷까지 안전하다는 판정은 아니다.

🟢 80% 미만 · 🟡 80% 이상 · 🔴 100% 이상 또는 양수 비용 · ⚪ 미집계. 녹색은 표시한 항목의 여유만 뜻하며 지연된 청구·무료 자격을 보장하지 않는다. 볼륨은 Osaka 루트 구획의 현재 할당량, 버킷은 근사 바이트 용량을 조회한다. GB·월은 현재 용량으로 환산하지 않으며 단위가 불분명한 외부 전송은 사용률 판정에서 제외한다. 비용 조회 계정에 볼륨 목록·해당 버킷 메타데이터 읽기만 추가하며 원문 읽기·자원 변경 권한은 주지 않는다.

`sample` 실행은 현재 값으로 시험 카드 한 건만 보내고 비용·오류 알림 체크포인트를 변경하지 않는다. 정기 요약과 이상 점검 주기는 유지한다. 경계값·용량 단위·미집계·중복 전송을 포함한 모니터링 테스트 20개와 Terraform 모의 검사 2개를 통과했다.

17:18 한국 시각 [실제 샘플 실행](https://github.com/agent-observatory/agent-wiki/actions/runs/34747323283)이 성공했다. Slack이 시험 카드 한 건을 수락했고 블록 볼륨·버킷 현재 용량 조회도 모두 성공했다. 알림 체크포인트는 유지했다. Terraform은 기존 조회 계정 정책 1개만 변경했으며 자원 추가·삭제는 없다.

Slack 카드에서는 신호등 범례·조회 범위·집계 지연·과금 주의 문구를 제거했다. 비용·상태·사용률·증감·상세 링크만 간결하게 표시하며 판정 기준과 조회 범위는 이 문서에 유지한다.

2026-09-14. GitHub 예약 실행은 지연·누락될 수 있으므로, 09:13 한국 시각의 일일 요약이 실행되지 않아도 그날의 다음 6시간 비용 점검이 일일 요약을 보완하도록 했다. 체크포인트는 한국 날짜별로 한 번만 기록하며, 일일 요약 전의 점검은 이상 알림만 확인한다. 실행 로그에는 `daily_summary=delivered|already_delivered|not_due`를 남겨 Slack 전송 여부를 확인한다. 이날 09:13 KST 실행은 GitHub에 생성되지 않았고, 수정 후 [수동 일일 요약](https://github.com/agent-observatory/agent-wiki/actions/runs/34806822139)은 43초 만에 성공해 `daily_summary=delivered`를 확인했다.

## 이전 오류 조회 Actions

현재는 중지·제거한 방식이다. [현재 OCI 기본 오류 알림](#oci-기본-오류-알림)과 구분한다.

2026-09-14 실제 알림 간소화 수정: 시험에 사용한 포맷 변경이 로컬 미커밋 상태여서, 예약 Actions는 GitHub의 기존 포맷으로 발송했다. 실행 `34769263743`의 커밋 `8a1b9fb`와 로컬 수정본을 같은 API·Worker 오류로 비교해 기존 6개 블록/수정본 2개 블록을 확인했다. 서비스·제목, 오류 코드·건수·시각, 로그·점검 링크만 표시한다. 실제 `run` 발송 경로의 API 오류와 Worker 미분류 오류 회귀 검사를 추가했으며 기존 코드에서 2건 실패·수정본에서 모니터링 검사 21건 통과했다. 전송·중복 억제·체크포인트 정책은 유지한다. 커밋 `332b7a8`을 push하고 [실제 오류 모니터 workflow](https://github.com/agent-observatory/agent-wiki/actions/runs/34769499370)를 실행해 해당 커밋 checkout·OCI 로그 25건 조회·성공을 확인했다. 새 발송 대상은 없어 Slack 발송은 0건이며, 다음 신규 오류부터 새 형식을 사용한다. 기존 메시지를 재전송하거나 합성 오류를 운영에 추가하지 않았다.

2026-09-13. 복구 알림이 불필요하다는 요청에 따라 기존 오류 조회 Actions를 재사용한다. 5분마다 OCI Logging의 새 ERROR/FATAL만 전송하며 동일 이벤트를 제외하고 같은 오류는 최대 시간당 한 번 알린다. OK·RESET·오류 없는 조회는 메시지를 만들지 않는다. 전환 이전 오류는 재발송하지 않도록 시작 시각을 체크포인트에 기록하며 비용 상태를 유지한다. 로그 도착·GitHub 예약 실행은 지연될 수 있다. 점검 자체가 실패하면 오류 점검 실패만 알린다.

OCI 기본 경보는 [해제와 RESET도 발송](https://docs.oracle.com/en-us/iaas/Content/Monitoring/Concepts/monitoringoverview.htm)하므로 비활성화한다. 앱은 계속 JSON 로그만 출력하며 새 서버·Function·유료 자원은 추가하지 않는다. 오류/비용 검사 17개·Terraform 모의 검사 2개·그림 XML과 실제 렌더링을 통과했다. [실제 오류 조회 실행](https://github.com/agent-observatory/agent-wiki/actions/runs/34745740760)은 성공했고 이전 로그 26건을 조회하되 전환 이전 기록이라 Slack 발송 0건이었다. 오류 조회 workflow 활성·기존 비용 workflow 유지, Terraform은 경보의 is_enabled만 false로 적용했다. 원격 재조회 plan에서 추가 변경 없음까지 확인했다. 새 오류의 실제 Slack 수신은 아직 추가로 발생시키지 않았으며 합성 전달 검증은 로컬 테스트로 수행했다.

## 호출·수집·반영 이력의 표시 밀도

2026-09-13. 호출 이력은 주요 지표 한 줄·오류와 당시 재시도 한 줄로 정리했다. 공통 상태 배지를 세션·업로드·일별 이력에 적용하고, 반영 이력의 카드와 세로 링크를 평면 목록으로 줄였다. L1 목록은 모바일에서 메타데이터를 다음 줄로 내려 가로 스크롤을 없앴다. 타입 검사와 1440px·390px 브라우저 검증, 호출 이력의 다크·라이트 테마, 반영 이력의 Version 링크를 확인했다. 데이터 처리·재시도·모델 설정은 변경하지 않았다. 앱 `8562ff6`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34744620779)가 성공했다. 운영 Edge 화면에서 한 줄 지표·색상 배지·간결한 오류 행을 확인했으며 API·Web·Worker는 healthy, PostgreSQL 컨테이너는 유지됐다. 이후 사용자 요청에 따라 앞으로는 데스크톱 웹만 설계·검증한다.

## 저장 조각 경계의 인용과 운영 지침 필터 수정

2026-09-13. 반복 실패 응답을 원문과 직접 대조해 두 구현 오류를 확인했다. 384자 전송 조각으로 갈라진 동일 필드의 인용을 한 행에서만 찾아 정확한 인용을 거부했고, 명시적인 `developer` 메시지도 일반 텍스트로 정제하고 있었다. 재시도 추가만으로 해결할 수 있는 문제가 아니었다.

`remote-curation-8`은 같은 이벤트·필드·연속 segment의 원문만 이어서 정확하게 비교한다. 근거는 원래 보관 행과 범위로 고정한다. `text-fields-3`은 명시적인 system/developer 메시지를 제외하되 사용자 발언·역할 미확인·다른 중첩 메시지를 유지한다. L1을 변경하거나 유사 인용을 통과시키지 않는다.

실제 실패 응답 재검증에서 해당 인용이 2/3 → 3/3 일치했으며, 그 입력 자체도 운영 지침으로 정상 제외됐다. `Lint`를 `Lineage`로 바꾼 다른 실제 오인용은 계속 거부됐다. 기존 반영 인용 14개에는 새 제외 범위가 없었다. 조각 경계·누락·다른 이벤트/필드·잘못된 단어·중첩 역할·Worker 반영 회귀 검사를 포함해 전체 114개와 타입 검사를 통과했다. 추가로 영구 실패해 있던 JSON 형식·주장 범위 오류도 원래 검증을 유지한 새 응답 재정제 대상으로 구분했다. 실제 Worker·DB 경로에서 JSON 오류 → 인용 오류 → 범위 오류 → 정확한 반영을 검증했고 각 실패는 진행 위치를 유지하며 잘못된 출력은 반영하지 않았다. 최종 앱 `86c8d21`의 [CI·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34743804958)가 성공했다. 중간 빌드 `46f1bdd`는 취소하고 최종본만 배포했다. 15:56 한국 시각 API·Web·Worker 이미지와 건강 상태·기존 DB 컨테이너·원문 1,276개·지식 5개 유지를 확인했다. 멈춘 JSON·범위 오류 작업 2개만 기존 청크 위치 3·4에서 다시 대기시켰다. 배포 코드로 실제 실패 응답을 다시 검사해 2/3 → 3/3 일치·운영 지침 제외를 확인했고, 실제 오인용은 계속 거부했다. 15:57 이후 `remote-curation-8`·`text-fields-3`의 실제 모델 호출을 확인했다. 이 기록 시점에는 배포 후 새 지식 반영 성공까지 확인한 것은 아니다.

## 인용 불일치로 멈춘 정제 복구

2026-09-13. 11:34 이후 자동 정제는 활성인데 세션 3개의 선행 청크가 `EVIDENCE_MISMATCH`로 영구 실패해 대기 1,251개가 모두 막힌 상태를 재현했다. 실패 응답의 인용 일치는 각각 8/9·4/9·2/3이며, 불일치는 원문 요약·표현/공백 변경을 포함했다. 제공자 호출 장애나 일일 한도 소진이 아니었다.

`remote-curation-7`은 인용 오류를 저장 전에 거부하고 120~144초 뒤 같은 청크를 새로 정제한다. 이전 실패 정보를 제한된 맥락 예산 안에 전달하며, 거부된 출력의 단순 재반영·원문 수정·검증 완화는 하지 않는다. 실패 응답·성공 청크·시도 이력을 유지한다. 연속 두 번의 잘못된 인용 → 대기 → 정확한 재응답 → 반영을 실제 Worker·DB 경로로 검증했다. 전체 검사 112개·타입 검사 통과.

앱 `ce7c8b7`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34741438394)가 성공했다. API·Web·Worker 이미지와 건강 상태, 기존 DB 컨테이너 유지를 확인했다. 14:57 한국 시각에 실패 작업 3개만 재대기시켰고 각각 완료한 청크 3개·원문·지식·AI 설정 Version 39를 유지했다. 첫 실제 호출은 302초 뒤 NVIDIA 504로 끝나 136초 후 재시도했다. 15:05 자동 재호출의 인용 7개 중 2개 불일치를 거부한 뒤 128초 후 재정제를 예약하고 다른 세션을 즉시 시작했다. 그 세션도 504를 반환해 15:12:51 이후 재시도가 예약됐다. 인용 오류와 제공자 오류 모두 영구 실패로 큐를 막지 않는 것을 확인했다.

15:10 확인 기준 복구 후 새 반영 성공은 아직 없으며 지식은 3개다. 기존 인용 8개는 원문 해시·지정 행과 일치했다. 원문 일치 기준을 낮추지 않았고 모델의 인용 정확도가 개선됐다고 판단할 근거는 아직 부족하다. 자동 정제는 켜 둔다. 일반 조회에 새 모델 호출이나 유료 자원을 추가하지 않았다.

## 리니지·조회 그림 통합

`wiki-lineage.svg`에 L1–L3 리니지와 L4 검색·근거 반환, L5 조회·활용을 함께 배치했다. 별도 `wiki-query-ranking.svg`와 문서의 중복 그림은 제거했다. 생성기 재생성 일치·XML·상대 링크 검사와 실제 렌더링의 겹침·잘림을 확인했다. 문서 변경이며 앱 배포는 하지 않았다.

## 핵심어 없는 질문과 전체 목록 구분

2026-09-13. “왜?”·“어디에”·“???”를 정리하면 검색어가 없어져 전체 지식이 반환되는 문제를 재현했다. 빈 검색창의 목록 조회와 구분해 항목·인용을 비우고 `queryStatus: needs_terms`로 핵심어 추가를 안내한다. 웹에서도 자료 등록 안내 대신 검색어 안내를 보여준다. 검색할 말이 없다는 것과 지식이 없다는 것을 혼동하지 않는다. 전체 검사 111개·타입 검사·데스크톱/390px 모바일 안내·검색어 제거 후 목록 복귀·그림 XML/렌더링을 확인했다. 앱 `beb1e70`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34740459968)가 성공했다. 2026-09-13 14:37 한국 시각에 실제 API의 세 질문 모두 빈 항목·인용과 `needs_terms`를 반환하고, 빈 검색창은 지식 3개·정상 검색은 Context 인용을 반환하는 것을 확인했다. API·Web·Worker 건강 상태와 기존 DB 컨테이너·원문 1,235개·지식 3개 유지를 확인했다. 검증은 읽기 전용이며 외부 모델을 호출하지 않았다.

## L4 본문 발췌

2026-09-13. 앞부분의 “임베딩” 한 단어 때문에 뒤의 “비용 때문에 보류” 결정을 발췌하지 못하는 사례를 재현했다. 겹치는 본문 구간을 비교해 서로 다른 검색어가 함께 있는 구간을 우선한다. 같은 단어 반복과 조사 대안은 중복 가산하지 않으며 문자 예산·원문 기준 위치·잘림 표시를 유지한다. 선택한 구간의 의미가 옳다는 보장은 아니다. 추가한 두 실패 사례와 실제 Context API에서 결정·이유가 함께 반환되는 것을 확인했다. 외부 모델 호출·원문 변경은 없다. 전체 검사 110개·타입 검사·그림 XML·실제 렌더링을 통과했다. 앱 `566feea`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34739179596)가 성공했다. 2026-09-13 14:06 한국 시각에 API·Web·Worker 건강 상태와 기존 DB 컨테이너·원문 1,227개·지식 3개 유지를 확인했다. 배포본의 합성 긴 문서에서 1,600자·300자 한도에 각각 252자·110자를 반환하며 결정·이유와 원문 기준 위치를 유지했다. 실제 지식 3개의 검색 → Context → 고정 Version 조회도 통과했다. AI 설정 Version 39·활성 상태·재시도 정책은 유지했고 검증 중 외부 모델 호출은 없었다.

## L2 기존 결정 맥락 선택

2026-09-13. 실제 주장 7개의 개별 입력은 459~717바이트로 1,800 예산 안에 들어갔다. 예산을 늘리지 않았다. 합성 사례에서 같은 세션의 디자인 메모 3개가 예산을 먼저 채워 다른 세션의 운영 DB 결정을 제외하는 현상을 재현했다. 동일 세션 참조 1개를 우선하고 나머지는 본문 관련도로 선택하자 DB 결정이 포함됐으며 입력은 1,693 → 1,548바이트였다. “그거 취소”의 동일 세션 참조와 새 세션의 주제 조회도 유지돼 선택 검사 2/3 → 3/3이다. [측정값](../experiments/curation/context-selection-results.json) · [합성 검사](../tests/curation-context.test.ts). 입력 길이·내용에 영향을 받는 작은 사례이며 모델의 정정·추출 품질 점수는 아니다. 같은 메모를 더 길게 만든 대조에서는 이전 방식도 DB 결정을 포함했다. 후보 제외는 예산과 순서가 함께 만드는 문제다.

선택 버전·주장 수·동일 세션 수·입력량을 실행 진단에 남긴다. 모델 지침·입력 예산·재시도·근거 검증은 유지하며 외부 모델 호출은 하지 않았다. 전체 검사 107개·타입 검사·그림 XML·실제 렌더링 검사를 통과했다. 추가로 실제 수집 형식의 JSONL 필드 기록에서도 관련 결정 선택을 확인했다. 앱 `f9225c9`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34737015107)가 성공했다. GitHub 실행기가 25분 이상 배정되지 않아 대기 중인 배포 작업만 취소·재예약했고, 완료된 검사와 이미지를 재사용했다. 2026-09-13 13:38 한국 시각에 API·Web·Worker 건강 상태, 기존 DB 컨테이너·원문 1,220개·지식 3개 유지를 확인했다. 배포본의 실제 세션 3개를 읽기 전용으로 조회해 각 3개 주장을 선택했고 입력 1,736~1,738바이트·고정 Version을 검증했다. 기존 지식 3개의 검색 → Context 조회도 통과했다. AI 설정 Version 39·활성 상태·재시도 정책은 유지했다. 이번 검증은 모델 호출 없이 수행했으며 새 규칙으로 실제 정제가 완료됐다는 의미는 아니다. 인용 불일치로 확인이 필요한 세션은 자동 재시도 대기와 구분한다.

## L4 검색 관련도

2026-09-13. 같은 합성 문서 10개·질문 8개에서 첫 결과 정답이 3/8 → 7/8로 늘었다. 여러 검색어의 일치 수·제목/태그/본문 가중치와 한국어 조사 대안을 적용했다. Context의 관련 본문 발췌에도 같은 대안을 사용한다. [평가 자료·한계](../experiments/retrieval/README.md). “미뤘지”와 “보류”의 의미 연결이 약한 질문은 정답이 2위다. 정답의 후보 포함은 8/8이므로 이 자료에서는 후보 누락과 순위 실패를 구분할 수 있다. 일반 조회 모델 호출·인프라 증설 없이 개선했으며 작은 개발 평가 결과를 전체 정확도로 해석하지 않는다. 전체 검사 106개·타입 검사·그림 XML·상대 파일 링크·실제 렌더링 검사를 통과했다. API와 Context에서 순서·고정 Version·필터를 확인했다. 앱 `638a316`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34735835370)가 성공했다. API·Web·Worker 건강 상태, 기존 DB 컨테이너와 원문 1,206개·지식 3개 유지를 확인했다. 원격 배포본의 조사·와일드카드·본문 후반 발췌 검사와 실제 지식 3개의 검색 → Context → 고정 Version 조회를 통과했다. 일반 조회 모델 호출은 없었으며 AI 설정 Version 39·활성 상태·재시도 정책을 유지했다. 남은 원문은 미반영 상태로 표시된다. 다음 품질 점검은 L2의 기존 결정 후보 선택과 증분 맥락 누락이다.

## 인용 지침·입력 형식 비교

2026-09-13. 동일한 실제 입력·NVIDIA Flash·출력 상한 16,384로 한 번씩 비교했다. 본문 해시는 동일하며 모델 메시지는 약 6.5~7.2KB다. 모든 요청은 HTTP 200이었지만 간헐적 504가 해결됐다는 뜻은 아니다.

| 조건 | 인용 일치 | 추출 주장 | 응답 시간 |
| --- | --- | --- | --- |
| 현재 지침·입력 | 4/5 | 5 | 17.244초 |
| 짧은 인용 복사 지침 추가 | 3/4 | 4 | 9.009초 |
| 절대 줄 번호·디코딩된 텍스트 항목 | 4/5 | 5 | 23.197초 |
| 두 변경 함께 | 검사 대상 없음 | 0 | 1.733초 |

**제품 지침·입력 형식은 유지한다.** 단순한 인용 지침 추가로 불일치가 사라지지 않았고, 빈 추출을 정확도 향상으로 계산하지 않는다. 각 조건 한 번이므로 속도·품질 우열을 일반화하지 않는다. 인용 일치와 주장 의미의 정확성·누락 평가도 다르다. 이후에는 작은 합성 기준 사례와 실제 보류 구간을 함께 평가해야 한다.

비교 도구에 원문·모델 응답을 저장하지 않는 인용 평가와 줄 번호 보존 검사를 추가했고 관련 검사 6개를 통과했다. [내용 없는 측정값](../experiments/curation/evidence-prompt-results.json)을 기록했다. 실험은 L3에 반영하지 않았으며 매번 자동 정제 설정을 복원했다. 앱 배포는 하지 않았다.

## 인용 검사 결과 표시

2026-09-13. 실제 지식이 3개로 늘었으며 새 `EVIDENCE_MISMATCH` 한 건은 원문에 없는 인용 때문에 거부됐다. 유사 문장으로 보정하거나 재시도로 무조건 통과시키지 않는다. L2 호출 이력에 `원문 인용 9개 중 8개 일치 · 불일치 1개`처럼 위치·내용 일치 개수를 추가했다. 주장·관계의 인용을 함께 세고 원문·프롬프트는 노출하지 않는다. 이 수치가 없는 과거 기록은 미집계로 남긴다. 전체 검사 99개·타입 검사와 합성 데이터의 데스크톱·390px 모바일 표시·가로 넘침 없음을 확인했다. 앱 `26fb259`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34733829690)가 성공했다. API·Web·Worker 건강 상태와 기존 DB 컨테이너·원문 1,175개·지식 3개 유지를 확인하고 자동 정제 설정을 복원했다(Version 33). 배포본을 과거 실패 응답에 읽기 전용으로 적용한 결과는 2/3·4/9·8/9 일치였다. 이 계산으로 과거 실행 이력을 덮어쓰지 않았고 새 실행부터 수치를 기록한다. 저장된 지식의 인용 8개도 원문 해시·행 내용과 일치했다. 현재 실패 세션은 인용 불일치로 확인이 필요하며, 자동 정제 활성화만으로 해당 세션이 재시작되는 것은 아니다. 다음 비교는 검증 기준을 유지한 채 짧은 인용을 정확히 복사하는 모델 지침을 대상으로 한다.

## 모델 내부 식별자 충돌

2026-09-13. 원문 연결을 통과한 실제 응답 세 건이 서로 다른 주장에 같은 `anchor`, 두 문서에 같은 `clientRef`를 사용해 저장 단계에서 중지됐다. 합성 Worker 검사로 `DUPLICATE_CHANGE`를 재현했고, 새 문서에서 참조되지 않는 중복 이름만 결정적으로 구분하도록 수정했다. 관계·링크의 대상이 모호한 중복은 계속 거부하며 주장·근거·원래 모델 응답은 보존한다. 관련 검사 14개와 전체 검사 98개·타입 검사를 통과했다. 실제 실패 응답 세 건의 저장 경로를 트랜잭션 롤백으로 검증했으며 두 건은 통과하고 한 건은 `EVIDENCE_MISMATCH`로 거부됐다. 이 비교에서는 지식을 남기지 않았다.

앱 `4f8e99b`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34732240858)가 성공했다. API·Web·Worker 건강 상태와 기존 DB 컨테이너·원문 1,163개 유지를 확인했다. 11:14에 실패 작업 세 건을 재시도하고 자동 정제를 복원했다(설정 Version 31). 첫 실제 요청은 30.276초·1,677토큰으로 완료됐고 지식 1개·사용자 결정 1개를 저장했다. 서버가 연결한 인용 1개는 보관 원문의 해시와 행 내용이 정확히 일치했다. 해당 응답은 식별자 중복이 없어 이름 변경은 0개였다. 다음 청크는 계속 처리 중이며 세션 전체 완료를 뜻하지 않는다. 간헐적인 제공자 504가 해결됐다는 의미도 아니다.

## 인용문의 원문 위치 연결

2026-09-13. 실제 모델 응답 두 건은 보관 행 159~166 대신 본문 10~19줄을 인용해 거부됐다. 인용문 8개는 모두 디코딩된 청크 본문에 정확히 한 번 존재했다. `remote-curation-6`은 이런 경우에만 서버가 원문 행을 연결하고 기존 검증을 이어간다. 역할·정정 권한을 바꾸거나 유사 문장을 추측하지 않는다.

합성 Worker 검사에서 기존 실패를 재현한 뒤 실제 L3 반영·정확한 원문 인용·L1과 원래 모델 응답 보존을 확인했다. 중복·다른 원문/개정·불일치 인용은 연결하지 않는 검사도 통과했다. 원격의 실패 응답 8개를 읽기 전용으로 적용했으며 연결된 인용 8개 모두 실제 L1 행과 일치했다. 이 확인에서는 지식을 반영하지 않았다. 앱 `0eaeae0`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34729587129)가 성공했다. 실제 재시도 두 건은 2.256초·3.729초에 응답했지만 단일 행 `[163]`처럼 범위를 한 값으로 표현해 구조 검사에서 중지됐다. 이 표기만 `[163,163]`으로 정규화하는 수정을 추가했고 관련 검사 14개를 통과했다. 원래 응답·실패 이력·엄격한 공개 API 계약은 유지한다. 추가 수정 `7ae423b`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34731008628)가 성공했고 API·Web·Worker 건강 상태, 기존 DB 컨테이너와 원문 1,152개 유지를 확인했다. 전체 로컬 검사 95개·타입 검사를 통과했다. 배포본에서 기존 실패 응답 두 건 모두 구조 검사를 통과하며, 인용 8개 중 정확히 일치한 6개만 원문으로 연결된다. 불일치 2개는 임의 보정하지 않는다. 10:44에 형식 오류 작업 두 건을 다시 대기시키고 자동 정제를 활성 상태로 복원했다(설정 Version 29). 새 실제 요청은 모델 응답 대기 중이며 아직 L3 지식 반영 성공으로 기록하지 않는다.

스트리밍 Hello는 302.172초 뒤 504였고, 실제 5,102바이트 입력은 0.460초·HTTP 200으로 JSON을 반환했다. 첫 내용은 0.442초에 도착했고 토큰 사용량은 보고되지 않았다. 스트리밍만으로 지연이 해결됐다고 보지 않으며 제품의 기본 호출 방식은 유지한다. 진단 코드의 HTTP 200 이후 중단도 공유 대기를 적용하도록 고쳤고 합성 검사 4개를 통과했다. [내용 없는 측정값](../experiments/curation/stream-and-evidence-results.json).

## 재시도 대기 축소

2026-09-13. 반복 실패 때 대기가 2·4·8·16·32분으로 늘어나던 정책을 **매번 120~144초**로 변경했다. 제공자 `Retry-After + 5초`와 기본 대기 중 더 긴 시간을 적용하며, 오류 횟수·원인·청크 진행 위치는 유지한다. 연속 다섯 번 실패해도 대기가 늘지 않는 Worker·공유 키 검사 13개와 타입 검사를 통과했다. 앱 `94bb44c`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34726416283)가 성공했다. API·Web·Worker 건강 상태와 실제 대기 계산, 기존 DB 컨테이너·원문 1,109개 유지를 확인했다. 09:02로 밀린 작업 1건과 공유 키의 예약을 08:56:58로 함께 앞당겼다. 제공자 최소 대기는 이미 지났으며, 이전 실패·예약 기록과 청크 위치는 유지했다. 모델 비교 실험 동안 자동 정제는 잠시 중지하고 실험 종료 후 이전 활성 상태로 복원한다.

## Hello 대조와 제공자 대기 구분

2026-09-13. 같은 VM·API 키·Hello·출력 상한 1,024로 비교했다.

| 요청 | 결과 |
| --- | --- |
| `reasoning_effort: none` · 첫 실행 | 0.305초 · HTTP 200 · 15토큰 |
| `chat_template_kwargs.thinking: false` | 302.070초 · HTTP 504 |
| `reasoning_effort: none` · 재확인 | 302.087초 · HTTP 504 |
| 같은 형식 · 실제 5,127바이트 입력 · 출력 상한 16,384 | 302.084초 · HTTP 504 |

요청 형식만이 원인이라고 확정할 수 없다. 실패 응답에는 `Retry-After` 헤더가 없었으며 실제 재시도 대기는 135초·133초였다. 이전 실행 진단의 `providerRetryAfterSeconds=60`은 헤더가 없을 때의 내부 기본값일 수도 있어 제공자가 명시한 값으로 단정하지 않는다. 헤더가 없거나 해석할 수 없으면 `null`을 기록하도록 수정했고 관련 AI 검사 11개와 타입 검사를 통과했다. 앱 `4d590a2`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34727581527)가 성공했다. API·Web·Worker 건강 상태와 기존 DB 컨테이너·원문 1,118개 유지를 확인했다. 원격 코드에서 기본 120~144초, 제공자 180초 → 185초, 헤더 없는 HTTP 오류 → `null`을 검증했다. 이 검증에는 외부 모델 호출을 사용하지 않았다.

이번 실제 입력은 출력 상한을 16,384로 늘려도 504였다. Workspace 출력 상한은 16,384로 넓혔으며 필요한 만큼만 생성하도록 한다. 설정 변경 후 비교를 마쳤으며 09:24에 출력 상한 16,384·자동 정제 활성 상태로 재개했다. 스트리밍·축약 지침 비교는 아직 하지 않았다. [측정값](../experiments/curation/provider-diagnosis-results.json)에는 원문·키·모델 출력 내용을 저장하지 않는다. 모델 비교는 L3에 반영하지 않으며, 응답 성공과 정제 품질 검증을 구분한다.

## 모델 호출 기한과 NVIDIA 요청 옵션

2026-09-13. 사용자 요청으로 모델 호출 제한을 늘렸다. 실행 진단에 당시 제한·임대 시간을 남긴다.

| 항목 | 현재 설정 |
| --- | --- |
| 모델 호출 전체 기한 | 330초 · 이전 150초 |
| 작업 임대 | 7분 · 호출 도중 임대 만료 방지 |
| 모델 HTTP 연결 대기 | 360초 · 전체 기한보다 먼저 끊기지 않게 설정 |
| NVIDIA 비동기 결과 조회 | 고정 40회 제한 없이 같은 요청을 전체 기한 안에서 조회 |

호출 간격·재시도 대기·종료 시 90초 유예는 유지한다. AI 회귀 검사 10개·타입 검사를 통과했다. 공용 HTTP 설정 유지, 실제 요청의 대기 제한, 무응답 서버 취소와 40회 이후 결과 수신을 검사했다. 앱 `734391e`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34724886175)가 성공했다. API·Web·Worker 이미지 SHA·건강 상태와 실제 330초·420초 설정을 확인했다. 기존 DB 컨테이너·원문 1,071개를 유지했고 준비 실패 3건만 다시 대기시킨 뒤 08:20에 자동 정제를 재개했다. 새 실행이 준비 단계를 통과해 실제 모델 요청을 시작했고 `modelTimeoutMs=330000`이 기록됨을 확인했다. 실제 요청 1회는 302.107초 뒤 제공자의 HTTP 504로 끝났다. 우리 330초 제한이 먼저 끊은 것이 아니었다. 같은 입력은 약 5KB였고 응답 토큰은 미집계다. 실패와 2,176초 재시도 대기를 DB에 기록했으며 다음 시각은 09:02였다. 자동 정제는 활성 상태다. [내용 없는 측정값](../experiments/curation/timeout-result.json).

배포 검증 중 추가한 Undici 루트 모듈이 공용 Dispatcher를 설치해 OCI 인증 요청을 깨뜨리는 문제를 발견했다(`invalid content-length header`). 버전을 고정한 Agent 모듈만 불러오도록 분리했다. 원격의 세 원문을 읽고 해시가 일치함을 확인했다. 준비 실패 이력은 남기고 해당 작업을 재시도하며 L1은 변경하지 않는다.

마지막 150초 시간 초과 요청은 메시지 JSON 5,127바이트, 원문 텍스트 1,434바이트, 시스템 지침 2,668바이트였다. 출력 상한은 2,048토큰이다. 100MB 원문 전체 전송이 아니며 입력 크기만을 원인으로 단정하지 않는다. NVIDIA DeepSeek V4 추론 옵션은 [공식 예제](https://build.nvidia.com/deepseek-ai/deepseek-v4-flash-0731)의 `chat_template_kwargs` 형식으로 맞췄다. 요청 형식 수정과 실제 모델 응답 성공은 구분한다.

ARM 실행기 배정이 지연되면 Actions 수동 실행에서 `image_runner=ubuntu-24.04`를 선택해 ARM 이미지를 만든다. 기본은 기존 ARM 실행기이며 검사·배포 단계는 같다.

## 현재 청크의 주제로 참고 지식 찾기

2026-09-13. 뒤쪽 청크에서도 보관 조각의 앞부분으로 참고 지식을 찾던 문제를 수정했다. 이제 실제 정제할 청크 본문으로 후보를 정렬한다. 첫 주제와 후반 주제가 다른 합성 자료에서 후반 청크를 재개할 때 해당 주제의 지식이 먼저 오는 것을 검증했다. 앱 `1adac4c`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34722473497)가 성공했다. API·Web·Worker 이미지 SHA와 건강 상태, 기존 DB 컨테이너 유지를 확인했다.

## 실제 정제에서 발견한 불필요한 지식

2026-09-13. `remote-curation-4`를 실제 세션으로 소량 실행하자 첫 청크가 8.16초·2,730토큰으로 완료됐지만, 세션 ID·서브에이전트 별명·작업 경로를 지식으로 만들었다. 근거가 있어도 장기적으로 필요한 지식은 아니므로 자동 정제를 중지했다. 두 번째 호출은 150초 뒤 `AI_TIMEOUT`으로 끝났으며 122초 뒤 재시도하도록 기록했다. 중지 상태에서 새 호출은 없었고 응답 없는 토큰은 미집계로 남겼다. [내용을 제외한 측정값](../experiments/curation/real-session-trial.json).

`remote-curation-5` / `text-fields-2`는 확인된 `session_meta` 이벤트와 조각에 나뉜 기본 시스템 지침을 입력에서 제외한다. 일반 대화에서 같은 용어를 언급한 경우와 알 수 없는 이벤트는 유지한다. 실제 첫 보관 조각은 131,028 → 73,569바이트, 618줄 중 158줄이 제외됐다. 원문 줄 번호·L1 객체는 바꾸지 않는다. 로컬 회귀 검사·타입 검사·빌드와 그림 렌더링을 통과했다. 앱 `471a79a`의 [배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34722328574)를 확인했다. 시험 지식 1개를 재생성 기능으로 초기화했고, 같은 트랜잭션에서 원문 1,014개·수집 위치 3개·호출 이력 2개가 동일하게 유지됨을 검증했다. 첫 구간은 이제 모델 호출 없이 넘어갔고 계획된 청크는 74 → 49개로 줄었다. 다음 본문 구간은 150초 시간 초과였다. 작은 입력에서도 지연이 발생하므로 입력 크기만 원인이라고 단정하지 않는다. 새 앱 확인 후 07:25에 자동 정제를 다시 활성화했다. 최신 원문은 1,038개였으며 생성 지식의 품질은 계속 점검한다.

## 개인 규모의 화면 집계와 작은 모델 실험

2026-09-13. L2의 L1 카드에서 세션·문서 수와 보관 조각 수를 구분하고 L3 카드에는 실제 지식 수를 표시한다. 정제 완료 조각 비율은 보조 설명으로 옮겼다. 재생성 전의 오래된 실행 완료 시각이 새 진척도에 표시되지 않도록 실행 세대도 맞춘다. 네 조각을 한 세션으로 집계하고, 다른 세션은 별도로 세는 검사와 초기화 후 완료 시각 제거를 검증했다. 타입 검사·빌드가 통과했다. 앱 `67683b2`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34721951970)가 성공했다. API·Web·Worker SHA와 건강 상태, 기존 DB 컨테이너 유지를 확인했다. 운영 웹의 3개 세션·1,014개 보관 조각·실제 지식 수가 서버 집계와 일치한다.

무료 NVIDIA DeepSeek Flash에 ‘사용자가 AI의 DB 변경 제안을 인용했지만 아직 검토 중’인 합성 사례를 한 번 보냈다. 약 0.52초·159토큰으로 응답했고 기존 결정을 대체하지 않았다. 예상 라벨은 `proposed`, 실제는 `unconfirmed`여서 엄격한 라벨 일치에는 실패했지만 성급한 결정 변경은 없었다. 한 번의 간단한 응답이며 전체 정제 품질·안정성을 입증하지 않는다. 지식에는 반영하지 않았다. [실행 코드](../experiments/curation/quoted-proposal.mjs)·[측정값](../experiments/curation/quoted-proposal-result.json).

## 실제 세션 형식과 정제 입력

2026-09-13. 실제 원격 세션 3개의 최근 L1 조각 3개를 읽기 전용으로 점검했다. 반복 컴팩션 대화·런타임 지침·암호화 필드가 함께 수집되어 있었다. 원문은 보존하고 L2 입력에서 확인된 암호화·런타임 지침 필드만 제외했다. 생략 범위는 인용할 수 없고, 해당 필드만 있는 청크는 AI를 호출하지 않는다. 나머지 대화와 알 수 없는 필드는 유지한다.

한 표본은 130,367 → 94,001바이트로 줄었고 다른 두 표본은 그대로였다. 전체 자료의 절감률·정제 품질 개선으로 일반화하지 않는다. 컴팩션 안의 발화자와 Codex 메시지·도구 출력 형식도 구분했다. 구조상 발화자를 찾은 것이 주장 내용의 사실 검증을 뜻하지 않는다. [내용을 제외한 측정값](../experiments/curation/input-shape-results.json)을 기록했다. 원문 데이터·키·리소스 ID는 이 파일에 포함하지 않는다.

로컬 검사 79개와 타입 검사·빌드가 통과했다. 원문 줄 번호 유지·생략 구간 인용 차단·일반 대화 보존·암호화 전용 입력의 무호출 완료·발화자 혼동 방지를 확인했다. 반복 스냅샷의 의미 중복 제거는 아직 하지 않았다. `67683b2`에 함께 배포되었고 원격 `remote-curation-4`와 원문 보존을 확인했다.

## 원문을 유지하는 지식 재생성

2026-09-13. 개인 세션 규모에 맞춰 Workspace 전체를 한 번에 다시 만드는 기능을 추가했다. 현재 **공간 관리 → 데이터 관리 → L2·L3 초기화**에서 자동 정제를 중지하고 진행 작업을 마친 뒤 실행한다. 수동 지식을 포함한 Knowledge·근거·관계·정제 결과를 초기화하고 원문부터 다시 대기한다. 자동 정제는 직접 재개한다.

L1 객체·수집 위치·로그인·AI 설정·호출 이력·토큰 집계·제공자 대기는 유지한다. 같은 초기화 요청은 한 번만 적용하며, 트랜잭션 실패는 롤백한다. 이전 실행의 늦은 응답은 새 정제에 반영하지 않는다. 로컬 합성 검사에서 원문 보존·다른 Workspace 격리·수집 중복 판정 유지·호출 이력 보존·활성/진행 작업 거부·중복 요청·롤백·늦은 응답 차단을 확인했다. 기존 전체 검사와 추가 회귀 검사, 타입 검사·빌드가 통과했다. 재생성 그림의 XML과 실제 렌더링도 확인했다. 원격 재생성을 실행하거나 AI를 활성화하지 않았다. 앱 `bca3dc9`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34721284566)가 성공했다. API·Web·Worker 이미지 SHA와 건강 상태, 기존 DB 컨테이너 유지, 원문 1,005개·정제 중지 상태를 확인했다. 운영 웹에서 재생성 버튼·삭제 범위 설명·Escape 취소·포커스 복귀를 확인했으며 원격 초기화는 실행하지 않았다.

개선은 실제 개인 세션의 크기와 실패 사례를 기준으로 진행한다. 대규모 부하 실험·분산 처리·부분 재생성은 현재 범위에 추가하지 않는다.

## 증분 맥락·주장 관계 검증

2026-09-13 자율 작업. 앱 `dbfb145`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34719762179)가 성공했다. API·Web·Worker 이미지 SHA와 건강 상태, 기존 PostgreSQL 컨테이너 유지, 운영 웹의 세션 3개 요약을 확인했다. 기존 OCI 자원·L1·Collector 위치를 유지했다.

| 변경 | 확인 |
| --- | --- |
| 세션 안의 순서 | 같은 업로드의 0·1·2·10번 조각을 숫자로 정렬. 앞선 실패·재시도는 같은 세션만 대기 |
| 정제 입력 | 제목만 제공하던 방식을 최대 6개 주장 본문·상태·범위·근거 위치로 변경, 예산 1,800 |
| 자동 반영 | 문서 전체 교체 금지. 새 주장과 고정된 과거 주장의 관계를 한 트랜잭션으로 저장 |
| 관계 검증 | 대상·범위 일치, 정정 근거, 사용자 결정의 권한, 과거 Version·자기 참조 검사 |
| 조회·웹 | 현재/이력 모드, 적용 범위, 상태 라벨·변경 관계 링크. 과거 검색어에서 현재 결정으로 연결 |
| 실패 복구 | 세션 요약 행에서 실패 작업만 재시도. 성공 청크·완료 작업·시도 이력·자동 정제 중지 상태 유지 |

최종 로컬 검사 71개와 빌드가 통과했다. 모델 오판을 반영한 역할 검사·미확인 전환·대체 차단과 Query의 미반영 입력 표시를 포함한다. 같은 문서의 고정 Version 이력, 이미 대체된 대상 재변경 거부, 세션 실패 재시도와 실행 가능한 작업 기준의 대기 상태를 포함한다. 브라우저에서 고정 Version 링크 이동·상태/범위 라벨·모바일 가로 넘침 없음·페이지 오류 없음을 확인했다. Client 0.5.1과 Codex·Claude 조회 Skill을 로컬에 설치했다. 설정·전송 상태 파일의 해시가 그대로이며 Agent Wiki만 10분마다 수집하는 스케줄 유지를 확인했다.

로컬 합성 작업 누적량 실험에서 상관 서브쿼리의 반복 탐색 비용을 확인했다. 세션별 첫 미완료 작업을 윈도 함수로 한 번에 계산하도록 바꿨다.

| 누적 작업 | 다음 작업 선택 · 변경 전 → 후 | 진척도 집계 · 변경 전 → 후 |
| --- | --- | --- |
| 1,000 | 2,339ms → 4ms | 59ms → 15ms |
| 10,000 | 1,748ms → 20ms | 3,532ms → 47ms |

각 조건 로컬 1회 측정이며 워밍업·실행계획 차이가 있어 운영 성능 보장은 아니다. [입력·측정값](../experiments/curation/queue-results.json)과 [재현 스크립트](../experiments/curation/queue-benchmark.ts)를 남겼다. 로컬 테스트 DB 환경에서 `npx tsx experiments/curation/queue-benchmark.ts`로 재현하며 운영 DB에서는 실행을 거부한다.

무료 NVIDIA DeepSeek Flash에 합성 사례 6개 × 증분만/이전 결정 포함 2개 조건으로 총 12회 요청했다. 27분 5초 동안 유효 JSON 응답 3회, 180초 시간 초과 9회였다. 보고된 토큰은 1,198개이며 응답 없는 요청의 사용량은 알 수 없다. VM의 모델 목록 조회는 83ms에 성공했고 설정 모델도 목록에 있었다. [원시 측정 결과](../experiments/curation/context-results.jsonl)와 [평가 입력](../experiments/curation/cases.json), [실행 코드](../experiments/curation/evaluate.mjs)를 보존했다.

**결과:** 이전 결정이 있는 조건에서 검토 의견을 제안으로 구분한 응답은 있었지만, 에이전트의 “설치 완료”를 사용자 결정의 대체로 잘못 판단한 응답도 있었다. 맥락 없는 조건에서도 이를 미확인 대신 제안으로 분류했다. 성공한 짝 비교가 부족해 맥락 효과·모델 품질의 우열을 결론내리지 않는다. 제안의 참조 대상 표현도 평가 지침과 정답의 계약이 충분히 명확하지 않아 단순 정확도 점수로 해석하지 않는다.

발견한 오판을 회귀 사례로 반영했다. Worker는 L1의 역할 필드·이벤트 종류에서 발화자를 확인한다. 사용자 역할을 입증하지 못한 사용자 결정, 사용자/도구 근거가 없는 관찰은 미확인으로 낮추고 그 주장의 자동 대체 관계를 제거한다. Claude의 user 메시지 안에 감싼 tool_result도 사용자 결정으로 취급하지 않는다. 원본 모델 출력과 미확인 전환 수는 실행 기록에 남긴다. 역할 정보가 저장 조각 밖에 있거나 불명확한 경우에도 사용자 권한으로 추정하지 않는다.

Query 응답에는 대기·실패·진행·업로드 수와 `curation.hasUnprocessedInputs`를 추가했다. 정제되지 않은 증분에 후속 결정이 있을 수 있으므로 ‘현재 상태’를 전체 원문의 최신 상태로 오해하지 않게 한다. 원격 L1 958개가 모두 업로드 조각 번호를 보유하고 대기 상태·성공 청크 0인 것을 확인했다. L1·수집 위치·자동 정제 중지 상태를 유지했으며 실험 결과를 운영 지식에 저장하지 않았다.

최종 검증: 로컬 71개 검사·빌드, CI·배포, 파일 링크 72개·SVG 8개 XML/재생성 일치·변경 그림 렌더링을 통과했다. 운영 CLI의 `--view history`가 미반영 입력 966개와 `hasUnprocessedInputs=true`를 반환했다. 서버의 세션별 실행 가능 선두는 3개, 첫 업로드 조각은 0번이었다. L1은 966개·Knowledge는 0개이며 자동 정제는 중지 상태다. 실제 원문에 대한 정제 품질을 검증했다고 표현하지 않는다.

소요 시간은 **05:47–06:29 한국 시각, 약 42분**이다. 그중 NVIDIA 비교 실험은 27분 5초 동안 실행했고 구현·로컬 검증과 병행했다. 비용이 생기는 OCI 자원 생성·사양 변경은 하지 않았다.

아직 별도 세션 요약/미완결 도구 상태·저장 조각을 넘는 청킹·다중 청크의 의미 통합·리랭커·L1 보존 재생성 실행은 구현하지 않았다. 현재의 제한된 기존 주장 조회가 이 설계 전체를 대체하지 않는다. 서버의 근거·관계 검사는 모델의 의미 해석이 맞다는 보증이 아니다.

## Curation 요약과 L2·L3 설계

2026-09-13. 웹에서 세션 작업 펼치기·개별 작업 목록을 제거하고 상태별 집계·청크 반영·세션 페이지네이션을 유지했다. 진단 API와 실행 기록은 유지하며 데이터 삭제는 없다. 타입 검사·빌드와 앱 `b7cb928`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34718007438)가 통과했다. 운영 웹에서 세션 3개와 상태 컬럼 유지, 작업 펼침 버튼·상세 페이지네이션 제거를 확인했다.

설치·수집·API 계약은 `client-and-api.md`에 남기고 중복 정제·재시도 설명을 L2·L3 문서로 옮겼다. `docs/wiki/`를 없애고 문서를 `docs/` 아래로 옮겼다. 중복 Wiki 목차·프로젝트 역사 안내 파일을 아키텍처에 합쳤으며 `docs/README.md`의 파일 표에 운영 현황을 추가했다. 상대 링크·앵커 150개, SVG 8개 XML·재생성 일치와 변경한 그림 렌더링을 확인했다.

설계 문서는 [l2-l3-memory.md](l2-l3-memory.md)로 묶었다. 결정 변경 그림을 L1 원문 → L2 의도 판단 → L3 주장 상태/근거 보존 → L4 질문별 조회로 갱신했다. 검토 의견·적용 범위·미해결 충돌·늦은 수집, 현재 채택과 사실 검증의 구분을 문서와 합성 검증 기준에 반영했다. 알고리즘 구현·실제 모델 품질 검증은 이번 범위에 포함하지 않았다. 자동 정제 중지와 L1을 유지한다.

## Curation 세션별 목록

2026-09-13. 서버에서 같은 세션의 정제 작업을 묶고 대기·진행 중·실패·완료 수를 집계한다. 세션 목록과 펼친 개별 작업은 각각 페이지네이션하며 URL에 선택 상태를 유지한다. 목록은 DB 메타데이터만 조회한다. 세션 27개·한 세션 30개 작업의 집계·페이지 경계·다른 Workspace 접근 차단·삭제 원문 제외를 포함한 통합 검사 10개, 타입 검사·빌드가 통과했다. 앱 `3c33c33`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34717510395)가 성공했다. 운영 작업 891개가 세션 3개(860·14·17개)로 묶이고 DB 합계와 일치했다. 펼치기·접기·25개씩 다음 페이지·새로고침 후 선택/페이지 유지와 기본 목록의 정렬·여백을 확인했다. API·Web·Worker 건강 상태와 기존 PostgreSQL 컨테이너 유지를 확인했다.

## 증분 맥락과 결정 통합 설계

2026-09-13. [l2-l3-memory.md](l2-l3-memory.md)에 증분 맥락·결정 관계·청킹과 리랭킹 비교 실험·L1을 보존한 L2·L3 재생성 그림 4개를 분리했다. 문서·그림의 새 알고리즘과 재생성 절차는 설계이며 아직 구현·품질 검증하지 않았다. 현재 Worker는 개별 L1 조각 안에서 청킹하고 관련 지식 3개의 제목·Version만 참고한다. 세션을 가로지르는 맥락 상태·주장 단위 관계 통합·리랭커·재생성 실행 기능은 후속 작업이다.

SVG 8개의 XML·재생성 일치, 문서 링크/앵커 77개와 새 그림 4개의 실제 렌더링을 확인했다. 이번 변경에서 원문·지식·정제 상태를 초기화하거나 실제 AI를 호출하지 않았다. 자동 정제는 기존 중지 설정을 유지한다.

## Raw Sources 증분 수집 이력

2026-09-13. 상세 화면에 수집 횟수·마지막 수집·누적 줄 수와 기본 접힌 수집 이력을 추가했다. 확정 업로드별로 보관 조각을 묶어 한 번으로 집계하며 중복만 있는 업로드·미확정·실패는 제외한다. API는 DB 메타데이터만 읽고 이력을 최신순으로 페이지네이션한다. 각 L1은 불변이며 기존 전체 기록 보기와 근거 조회를 유지한다.

실제 Collector 합성 입력의 증분·기기 간 중복 제외와, 27회 수집의 페이지 경계·여러 조각 합산·다른 Workspace 접근 차단·원문 객체 없이 조회를 검증했다. 업로드 통합 검사 8개·타입 검사·빌드가 통과했다. 앱 `7b5ac39`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34716412753)가 성공했다. 운영 상세에서 기본 접힘·펼치기·최신순·최초 수집 배지와 전체 기록 읽기를 확인했다. 확인 시점의 수집 15회·491,298줄은 DB 메타데이터와 일치했다. API·Web·Worker 건강 상태와 PostgreSQL 컨테이너 유지도 확인했다. 원문 재처리·AI 호출·DB 구조 변경은 없다.

## 계층 이름과 수집 화면 통일

2026-09-13. 웹 메뉴·제목·목록 이동·페이지네이션과 현재 설계 문서·그림의 계층 이름을 `L1 · Raw Sources`·`L2 · Curation`·`L3 · Knowledge`·`L4 · Query`·`L5 · Answers`로 통일했다. 메뉴 순서는 L3 → L2 → L1이다. 웹과 그림 생성기는 같은 이름 정의를 읽으며 디자인·작업 지침에도 기준을 기록했다. 웹 타입 검사·빌드, SVG XML·재생성·상대 링크·실제 렌더링을 확인했다. 앱 `08169d0`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34716085229)가 성공했다. 운영 Raw Sources 화면에서 새 메뉴 순서·제목·페이지네이션 이름과 수동 등록 버튼 제거를 확인했다.

수집 화면의 `원문 보관` 버튼과 수동 등록 창을 제거했다. 세션 수집은 Collector로 수행한다. 버튼 제거 앱 `f58af31`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34715772314)가 성공했다.

## 애플리케이션 이름과 실행 구성 통일

2026-09-13. `apps/agent-wiki-api`·`apps/agent-wiki-web`·`apps/agent-wiki-worker`와 `packages/agent-wiki-client`로 코드 경로를 맞췄다. Client 안의 `cli/agent-wiki.mjs`·`collector/`·`skill/` 역할을 구분하며 단일 설치·`agent-wiki` 명령은 유지한다. 로컬 패키지는 0.5.0이다.

Compose 서비스·컨테이너는 `agent-wiki-gateway`·`agent-wiki-web`·`agent-wiki-api`·`agent-wiki-worker`·`agent-wiki-db`, 자체 앱 이미지는 각각 같은 이름이다. 내부 DNS·Caddy 라우팅·Worker 상태 파일·launchd 식별자·systemd·CI/CD·설치 안내와 검사를 맞췄다. VM 표시 이름만 Terraform으로 갱신했으며 자원 생성·교체는 없다.

이름 전환은 기존 외부 유입을 막고 Web → Worker → API → DB를 순서대로 종료한 뒤 동일 데이터 경로·인증서를 새 서비스에 연결한다. DB 인증기관과 키를 유지하며 새 내부 호스트명을 인증서에 추가했다. 전환 실패 복구와 종료 순서를 합성 검사로 확인했고 전체 테스트·타입 검사·빌드를 통과했다. 앱 `0707275`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34715094358)가 성공했다. 새 이름의 컨테이너 5개만 실행 중이며 API·Web·Worker·DB 건강 상태, 웹 로그인 유지·새 설치 안내·CLI 조회·외부 DB TLS 접속·systemd의 새 서비스 이름을 확인했다. 전환 전후 원문 840개·수집 위치·지식·정제 실행·AI 설정이 일치했다. 로컬 설정과 전송 상태의 바이트 일치를 확인하고 새 launchd 이름으로 Agent Wiki만 10분 수집을 재개했다. 첫 실행 종료 코드 0·실패 0, 수신 위치 753,775바이트 증가·원문 849개와 최신 원문 표본의 해시·줄 수 일치를 확인했다. 자동 정제는 중지 상태이며 실제 AI 호출은 하지 않았다.

## 명령 이름·그림 일관성

2026-09-13. 실행 명령을 제품명과 같은 `agent-wiki`로 통일했다. 로컬 패키지 0.4.1, 설치된 Codex·Claude 조회 Skill, 문서·웹 설치 안내에 적용했다. 실제 조회와 Collector의 Agent Wiki 한정·10분 주기를 확인했으며 기존 설정·전송 상태를 유지했다.

그림에서 설치 패키지 아래 CLI·Collector를 개별 카드로 묶고 계층 배지를 각 컴포넌트 오른쪽 상단에 맞췄다. 그림 4개의 제목·본문·배지 크기를 공통 상수로 통일했다. CLI 검사·타입 검사·빌드, SVG XML·재생성·상대 링크·실제 렌더링을 확인했다. 앱 `1aceacb`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34714568351)가 성공했다. 운영 사용법의 설치·조회·Collector 명령이 모두 `agent-wiki`로 표시됨을 확인했고 API·Web·Worker 건강 상태와 기존 PostgreSQL 컨테이너 유지를 확인했다.

## 컴포넌트 이름·Skill 실행 위치

2026-09-13. 배포도·계층도·리니지·운영도에 `agent-wiki-client`·`agent-wiki-cli`·`agent-wiki-collector`·`agent-wiki-gateway`·`agent-wiki-web`·`agent-wiki-api`·`agent-wiki-worker`·`agent-wiki-db` 고유 이름을 적용했다. 기반 기술은 이름 아래로 구분하고 저장소·VM의 이름도 아키텍처 표에 연결했다. 설치된 조회 Skill은 작업 에이전트 안에 표시한다. 서버의 기존 Compose 서비스 키·OCI 표시 이름과 그림 이름의 대응은 아키텍처를 따른다.

로컬 패키지를 `@agent-observatory/agent-wiki-client` 0.4.0으로 설치했다. 명령은 `wiki`를 유지하며 실제 조회와 launchd의 새 패키지 경로·Agent Wiki 한정·10분 주기를 확인했다. 설정·전송 상태를 재사용했다. CLI 합성 검사, SVG 4개의 XML·재생성 일치·상대 링크·실제 렌더링을 확인했다. 서버 앱·인프라의 실행 구성을 교체하거나 AI 정제를 활성화하지 않았다.

## Wiki CLI·Collector 단일 설치

2026-09-13. 그림을 먼저 단일 패키지로 합쳤고 조회 Skill · 사용 지침, Wiki CLI · 검색 실행, Collector · 백그라운드 수집을 구분했다. 조회 명령·Skill·백그라운드 수집을 `packages/cli`에 통합했다. 별도 Collector 패키지와 명령을 제거했다. `wiki setup`으로 연결·수집 범위·주기를 설정하며 `wiki collector start|stop|status|run`으로 수집을 관리한다. 설정은 `~/.agent-wiki/config.json` 하나로 공유하고 수집 프로세스·잠금·전송 상태는 조회와 독립적으로 유지한다.

로컬 설치를 0.3.0으로 교체했다. 기존 기기 ID·전송 상태 파일의 해시를 유지한 채 설정을 합쳤고, 실제 조회와 증분 수집이 성공했다. 현재 범위는 Agent Wiki만, 주기는 10분이다. npm tarball을 저장소 밖에 단독 설치해 의존성·명령 실행을 검증했다. 합성 검사 57개·타입 검사·프로덕션 빌드, 그림 4개의 XML·실제 렌더링을 확인했다. 앱 `e41065d`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34713046259)가 성공했고 API·Web·Worker 건강 상태와 기존 PostgreSQL 컨테이너 유지를 확인했다. 원격 데이터 초기화·AI 정제 활성화·npm 공개 게시는 하지 않았다.

## 문서·설치 안내 정리

2026-09-13. 문서 안내·아키텍처·사용법·디자인·작업 지침을 정리했다. 구조와 계약의 중복을 줄이고 이미 구현한 직접 업로드 설명, Version 표기, 삭제된 원격 지식 링크를 고쳤다. 과거 설계·운영 기록은 당시 검증으로 구분했다.

CLI 0.3.1은 `wiki skill install --client codex|claude|all`을 지원한다. 프로젝트의 Codex `.agents/skills/agent-wiki`, Claude Code `.claude/skills/agent-wiki` 경로에 설치하며 로컬 두 경로와 통합 CLI 설치를 확인했다. Skill은 조회 판단 지침이며 매번 CLI 실행을 강제하지 않는다. 설치·공유 연결·범위 유지 합성 검사와 타입 검사·빌드를 통과했다. Markdown 상대 링크·SVG XML·재생성·변경 그림 렌더링도 확인했다. 클라이언트가 새 세션에서 지침을 선택하는 실제 행동은 별도 검증 대상이다.

앱 `d470cd0`의 [CI·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34713373602)가 성공했다. 운영 웹에서 세 역할·클라이언트별 Skill 경로·설치 명령·L2 메뉴 안내를 확인했고 API·Web·Worker 건강 상태와 기존 PostgreSQL 컨테이너 유지를 확인했다. 현재 원문 804개는 모두 분리 보관 참조 형식이며 표본 2개의 해시·줄 수가 일치하고 텍스트에 이미지 본문이 없었다. 지식·정제 실행은 0개, 자동 정제는 중지 상태다. 로컬 Collector는 Agent Wiki만 10분 주기로 계속 실행한다.

## 수집 범위·일일 제한·개발 데이터 정리 · 배포 완료

2026-09-13. Collector 기본은 전체 프로젝트이며 `projects` 배열로 범위를 제한한다. 현재 설치는 **Agent Wiki만 · 10분 주기**다. `wiki-collector install --interval <분>`으로 설정과 스케줄러를 함께 갱신한다. 실제 launchd의 600초 주기·실행 종료 코드 0을 확인했다. 자동 정제는 최대 20 RPM·동시 실행 1개를 유지하며 일일 제한 기본값을 없음으로 바꾸고 필요한 경우에만 직접 설정한다. 웹·문서·그림에 반영했다.

사용자 승인에 따라 구형 자료 2,746개·지식 6개와 관련 객체 2,837개를 초기화했다. 로그인·Workspace·API 키·AI 키·로컬 세션 원본은 유지했다. Agent Wiki 세션 3개를 텍스트·이미지 분리 형식으로 재수집했고, 기준 시점까지 수신 위치와 로컬 원본의 접두부 해시가 모두 일치했다. 확인 시점의 입력 약 172MB는 약 55MB로 압축됐으며 자료 775개가 모두 최신 원문 참조 형식이다. L2는 대기, L3 지식·실제 모델 호출은 0이며 자동 정제는 중지 상태다.

재수집 중 이미지 조각 128개 초과를 발견해 완전한 이벤트 경계에서 범위를 줄이고 서버 확인 후 나머지를 이어 보내도록 보완했다. 여러 자료 묶음의 원문 참조 위치가 0으로 초기화되던 오류도 수정했다. 기존에 생성된 참조 188개는 보존한 원문에서 전체 내용 해시를 대조해 위치를 바로잡았고, 첫·마지막 참조 표본 6개와 후속 업로드 표본의 실제 읽기를 확인했다. 원본 텍스트·이미지 조각은 변경하지 않았다.

합성 검사 56개·타입 검사·프로덕션 빌드, 일일 제한 선택·저장·새로고침·모바일 화면, SVG XML·실제 렌더링을 통과했다. 앱 `261e5f9`의 [검사·이미지 게시·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34712203313)가 성공했다. 운영 웹의 일일 제한 없음·10분 수집 안내와 API·Web·Worker 건강 상태, 기존 PostgreSQL 컨테이너 유지를 확인했다. AI 정제 품질 검증은 포함하지 않는다.

## 정제 진단 이력 · 배포 완료

2026-09-13. NVIDIA DeepSeek Flash의 동시성 1·최소 3초 간격을 유지하고 첫 일시 오류 대기를 최소 2분으로 늘렸다. 실행별 호출 시각·응답 시간·HTTP 상태·요청 수·실패 단계·시도 횟수·당시 대기 시간·재시도 예약을 DB에 보존한다. 응답 검증에 실패해도 보고된 토큰을 남기며 복구는 새 실행으로 기록해 이전 실패 이력을 보존한다. 웹에 최근 7일 모델별 정제 성공률·자동 재시도·평균/95% 소요 시간·일별 기록·반복 오류를 추가했다. 과거 미측정 이력은 별도로 표시한다.

합성 자료 검사 49개·타입 검사·프로덕션 빌드와 브라우저의 성공률·오류·재시도 이력·모바일 가로 넘침·다크/라이트 표시를 확인했다. 실제 모델 호출과 자동 정제 활성화는 하지 않았다. 앱 `8abec22`의 [검사·이미지 게시·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34710848413)가 성공했다. 운영 웹에서 최근 7일 집계와 미측정 상태를 확인했고 API·Web·Worker 건강 상태, 기존 PostgreSQL 컨테이너·지식 6개 유지, 첫 재시도 120초를 확인했다. 자동 정제 중지·일일 한도 24회·최근 1시간 실행 0회이며 실제 AI 정제 품질은 아직 검증하지 않았다.

## Version 표기 · 배포 완료

2026-09-13. 웹 목록·상세·이력·선택 메뉴와 관련 안내의 개정 표기를 `Version`으로 바꿨다. 앱 `365027c`의 [검사·이미지 게시·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34708553601)가 성공했다. 운영 화면에서 `Version 3` 표기, API·Web·Worker 건강 상태와 새 이미지, 기존 PostgreSQL 컨테이너·지식 6개 유지를 확인했다. 내부 revision 계약과 저장된 지식 본문은 변경하지 않았다.

## 웹 디테일·분리 보관 · 배포 완료

2026-09-13. L3→L2→L1 메뉴, 한 줄 세션 목록, 서버 페이지네이션(25·50·100), URL 페이지·탭 유지, 개정 배지·당시 문서 제목, 요청 시 원문 열람을 반영했다. 정제 상태 카드에 중지·재개를 추가했다. 활성 상태만 변경하고 다른 AI 설정·키·호출 한도·재시도 대기를 유지한다. 실행 중인 청크는 마무리하고 이후 작업을 중지한다.

새 Collector 업로드는 이미지·텍스트를 분리한 zstd 조각을 사용한다. 서버는 이미지 해시·텍스트 참조를 검증하고, 영구 gzip 투영본 대신 원문 참조에서 근거 줄을 재구성한다. 기존 보관본은 자동 삭제·변환하지 않는다. 자동 정제 활성화·실제 AI 호출·새 인프라 생성은 이 배포에 포함하지 않는다.

로컬 검사 46개·타입 검사·프로덕션 빌드를 통과했다. 페이지 이동·새로고침, 당시 제목 표시, 본문 없는 메타데이터 열람, 중지·재개 및 설정 초안 보존, 모바일 목록을 브라우저로 확인했다. 105MiB 이미지 분리·무결성, 이미지 파일 없이 근거 복원, 중지 중 현재 청크 마무리를 검증했다. 앱 `95822bd`의 [CI·이미지 게시·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34707414864)가 성공했다.

운영 API·Web·Worker의 새 이미지와 건강 상태, 기존 PostgreSQL 컨테이너·지식 6개 유지를 확인했다. 운영 웹에서 메뉴·한 줄 세션 목록·개정 제목과 배지·정제 목록 2페이지 새로고침 유지·재개 버튼을 확인했다. 실제 새 증분 838개 기록이 텍스트 1조각·이미지 23조각, 합계 4,331,855바이트로 보관됐고 원문 참조 39개를 등록했다. 새 참조 표본의 825줄과 내용 해시가 일치했다. 자동 정제는 중지, 일일 한도 24회, 최근 1시간 모델 호출 0회다. 이번 수정·검증·배포는 약 20분 걸렸다.

## 조회 Skill·Wiki CLI · 그림 정비

2026-09-13, 전체 배포도와 계층도에서 조회 Skill·작업 에이전트·Wiki CLI를 별도로 표시했다. 스킬은 판단 지침, Wiki CLI는 우리가 만드는 접속 도구이며 실제 요청은 CLI → Caddy → Wiki API로 흐른다. AI Provider 표기와 OpenAI 아이콘, VM 헤더의 Oracle·Docker 아이콘을 반영하고 반복 설명을 줄였다. 생성기 재생성·SVG XML·실제 렌더링의 겹침·잘림을 확인했다. 문서·그림 변경이며 앱 실행 동작은 바꾸지 않았다.

## 정제 재시도·웹 진척도 · 배포 완료

2026-09-13, 모델 요청을 동시성 1·같은 호스트/API 키당 최소 3초 간격으로 제한했다. NVIDIA 결과 폴링도 이 간격을 공유한다. 429·일시 서버 오류·연결 시간 초과는 청크를 폐기하지 않고 키 전체를 지수 backoff+jitter와 Retry-After에 따라 대기시킨다. 대기 시각·연속 오류 횟수·청크 진행 위치는 DB에 저장하며 일일 시도 한도와 설정의 일시 중지는 유지한다. 인증·입력·근거 오류는 확인 필요 상태로 남긴다.

수집·AI 정제 화면에 L1 보관·L2 청크 정제·L3 처리 완료, 전체 Workspace 집계, 미분할 자료 수, 대기 이유·다음 시도 가능 시각·마지막 반영 시각을 추가했다. 15초마다 화면 데이터를 갱신하며 분할된 청크의 진행률만 표시한다. 목록의 100개 표시 제한과 전체 집계를 구분한다.

로컬 42개 검사·타입 검사·프로덕션 빌드를 통과했다. 세 번을 넘는 일시 오류, 임대 만료 복구, 키별 대기 상태·소유자 격리, 부분 성공 재개, Retry-After 초/날짜, 일일 한도·100개 초과 집계를 검증했다. 실제 모델 호출이나 자동 정제 활성화는 하지 않았다. 기존 자료의 긴 한 줄 입력 오류와 실제 청크의 Flash 정제 품질은 별도 확인 대상이다.

앱 `50038de`의 [CI·ARM64 이미지 게시·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34705325323)가 성공했다. API·Web·Worker의 새 이미지와 건강 상태, 기존 PostgreSQL 컨테이너·지식 6개 유지, 신규 대기 상태 테이블 적용을 확인했다. 운영 웹에서 원문 자료 2,657개·정제 대기 2,650개·자동 정제 중지 표시, 15초 자동 갱신, 갱신 중 설정 초안·선택 탭 보존을 확인했다. 설정 초안은 저장하지 않고 원래 값으로 되돌렸다.

## 증분 직접 업로드·텍스트 청킹 · 배포 완료

2026-09-13, 최종 앱 `982f7b5`의 [CI·ARM64 이미지 게시·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34704078936)가 성공했다. Collector의 증분 읽기·스트리밍 마스킹·4MiB zstd 조각·Object Storage 직접 업로드와 서버의 해시 검증·이벤트 중복 제거·연속 수신 위치 확정을 구현했다. 마스킹한 이미지 포함 L1은 보관하고 AI에는 원본 업로드·이벤트·필드 위치가 연결된 텍스트만 전달한다.

- 이벤트 경계를 우선하는 기본 청킹, 입력 예산, 청크별 근거 검증·반영·실패 지점 재개를 구현했다. 전체 세션의 먼 결정 간 충돌을 자동 통합하는 단계는 이번 구현 범위가 아니다.
- 기본 모델은 NVIDIA DeepSeek Flash, 입력은 UTF-8 바이트 기반 보수적 예산 8,000, 출력 2,048, 추론 `none`이다. Pro·Kimi는 수동 교체하며 자동 이중 호출하지 않는다.
- 로컬·CI 36개 검사, 타입 검사·프로덕션 빌드, Terraform 검증·모의 테스트를 통과했다. 105MiB 이미지 기록의 스트리밍 압축, 증분·기기 간 중복·이벤트 ID 위치 변경, 미완성 기록·변조 해시, 마스킹 경계, 청크 부분 성공 후 재개를 포함한다.
- 기존 원문 버킷에 대한 PAR 관리 권한만 Terraform으로 적용했다. 새 컴퓨트·스토리지 자원은 만들지 않았다. 기존 PostgreSQL 컨테이너·지식 6개를 유지했고 앱 건강 검사를 확인했다.
- 실제 세션 3개를 새 경로로 보관했다. 가장 큰 원본은 136,633,967바이트·11,102개 기록이며 33개 압축 조각 총 64,614,104바이트였다. 원본 다운로드의 압축 전후 SHA-256을 확인했다. 이어 추가된 790,036바이트·165개 기록만 306,804바이트로 전송했고, 서버 위치가 136,633,967에서 137,424,003으로 연속 전진했다.
- 웹에서 업로드 완료·신규/중복 수·기기별 검증 위치, 텍스트 보기의 원본 연결, Flash 설정 저장·Kimi↔Flash 프리셋 전환을 확인했다. Collector의 30분 실행을 복구했다. OCI SDK 주소 템플릿, 전송 중 증분 발생, 대용량 텍스트 쓰기와 Worker 상태 점검을 운영 검증에서 보완했다. 주소 오류 때 남은 미완료 업로드는 임시 객체 정리 경로로 만료 처리했다.
- 105MiB 이미지의 텍스트 투영은 제한된 메모리 실행에서 558바이트였다. 실제 텍스트 투영 5개 표본에서 이미지 data URL·연속 base64 조각이 없음을 확인했다. 보관·투영 완료와 AI 지식화 완료는 구분한다. 텍스트에는 실행 메타데이터도 포함되므로 의미 통합과 입력 선별 품질은 후속 검증 대상이다.
- 아주 짧은 합성 입력으로 Flash를 두 번 확인했으나 HTTP 529와 90초 시간 초과였다. 실제 세션의 AI 정제 성공·품질 검증은 아직 확인하지 못했으며 자동 정제는 중지 상태를 유지한다.

이번 설계 정리·구현·배포·운영 검증은 약 45분 걸렸다.

## 세션 식별·증분 직접 업로드 · 문서 반영

2026-09-13, 세션 식별자를 Workspace·에이전트 종류·원본 세션 ID로 정하고 기기·파일 세대별 수신 위치를 분리했다. API의 선 체크·PAR 발급 → Collector의 Object Storage 직접 업로드 → 서버 검증·중복 판정·불변 L1 등록·연속 위치 확정 흐름을 문서와 그림에 반영했다. **설계 변경만 수행했으며 직접 업로드·증분 전송의 구현·배포는 하지 않았다.** 모델 호출과 L2 청킹도 실행하지 않았다.

당시 코드는 기기·에이전트 종류·세션 ID로 수집 스트림을 구분하고, 변경 파일의 기록을 API로 다시 보내 서버가 중복을 제거한다. 파일 256MiB·기록 1MB·요청 최대 50개/목표 16KB 한도, 이미지 data URL 본문 제외, 서버 저장 시 gzip 압축을 사용한다. 이 기존 동작을 새 직접 업로드 계약의 구현 완료로 해석하지 않는다.

검증: SVG 4개의 XML·편집 가능한 텍스트·재생성 일치, 수정 문서의 로컬 링크 30개와 diff 공백 검사를 통과했다. 변경한 배포·계층·운영 그림 3개를 실제 렌더링해 겹침·잘림을 확인했다. 앱·Collector·인프라 실행 코드는 변경하지 않았다.

## Collector·원격 정제·설정 화면 · 배포 완료

2026-09-13 최종 수정본 `ae76b11`의 [검증·게시·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34700751316)가 성공했다. 운영 Edge에서 설정 저장 성공·탭 유지·정제 비활성·호출 0회를 확인했다. 로컬 Collector CLI와 30분 launchd 실행을 설치했으며 초기 과거 기록 동기화는 백그라운드에서 진행한다. 모델 호출·청킹 설계는 사용자 요청으로 보류했다. 이번 구현·배포·검증은 약 30분 걸렸다.

2026-09-12 앱 `ea4a313`의 [CI·ARM64 게시·자동 배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34700430876)가 성공했다. 기존 VM·PostgreSQL 컨테이너·볼륨·인증서를 유지하고 Caddy·Web·API·Worker·PostgreSQL 5개 실행을 확인했다. 아래의 Worker 제거·미구현 기록은 이전 단계의 이력이다.

- 읽기 전용 Codex·Claude Collector, 서버의 위치·해시 중복 검사, 불변 원문과 정제 작업 등록, 설정 암호화, 원격 Worker와 재시도·종료 처리를 구현했다. 원문을 실제 비공개 Object Storage에 적재했고 반복 전송에서 신규 0·중복 반환을 확인했다.
- 웹에 수집·AI 정제 메뉴와 작업·AI 설정·수집 상태를 추가했다. 소유자 Edge에서 배포된 메뉴·원문 작업 목록·저장된 키의 비공개 표시·정제 일시 중지·호출 0회를 확인했다.
- 로컬 27개 검사와 타입 검사를 통과했다. 수집 중복·미완성 기록·권한·암호화·한도·근거 반영·임대 복구·실제 Worker SIGTERM, 수집과 대화형 API의 요청 한도 분리를 포함한다. 실제 자료에서는 수집 요청 한도가 웹에 영향을 주는 문제를 발견해 수집 전용 한도와 재시도 대기를 보완했다.
- 사용자가 모델 호출과 청킹 논의를 다음으로 미뤘다. **자동 정제는 비활성화했으며 실제 세션의 AI 지식화·품질 검증은 이번 완료 범위에서 제외한다.** 기존 지식 6개는 유지했고 새 원문은 정제 대기 상태다. 연결 확인용 합성 모델 요청과 실제 자료 정제를 혼동하지 않는다.
- Collector 연결은 Agent Wiki 프로젝트만 허용하며 전용 `source:write` 키를 로컬 비밀 파일에 보관했다. AI 키는 암호화해서 서버에 저장했고 원문·토큰·프롬프트를 운영 로그에 출력하지 않는다.

## 작업 세션과 수집·정제 분리 · 문서·그림 정비

2026-09-12, 별도 Collector가 클라이언트 기록을 읽고 원격에 보관하며 별도 백그라운드 실행이 군집화·정제하는 방향으로 설계를 수정했다. **Collector·자동 군집화·백그라운드 정제는 아직 미구현**이며 실행 위치·모델 연결·사용량 정책은 미정이다. 아래 개인 에이전트 정제 기록은 이전 구현 당시의 사실이다.

아키텍처·사용법·작업 지침·CLI Skill에서 활성 대화의 시작·종료·매 턴에 수집·정제를 요구하는 흐름을 제거했다. 프로젝트 역사 파일은 원격 Wiki 링크로 축소했다. 원격 원문·지식은 수정하지 않았다. 그림 4개와 생성기를 갱신했고, 전체 배포도에서 호스트 로그를 생략하고 DNS·인증서 발급·보관을 분리했다. XML·재생성 일치·문서 링크·PNG 렌더링을 확인했다. 이어 전체 배포도에 L1~L5 역할 라벨을 붙이고 정제 상자·원문 저장소 연결을 정리했으며, 그림의 진행 상태 표시는 제거했다. SVG 4개 재생성·렌더링과 선택적 3배 PNG 생성·Zed 표시를 확인했다. 웹 사용법 문구는 수정·타입 검사 후 앱 `ef43ac3`의 [CI·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34697700073)가 성공했다. 운영 Edge에서 필요할 때 조회·자동 수집 미구현 안내와 매 작업 기록 요청 절차의 제거를 확인했다. 수집·정제 실행이나 데이터 초기화는 하지 않았다.

## 그림 예시 표기 정리 · 문서 검증 완료

2026-09-12 계층도·리니지도의 예시 식별자를 원문 A·지식 A·첫 번째 개정·정제·반영 기록으로 풀어 썼다. 생성기와 디자인 규칙을 함께 수정하고 SVG XML·재생성 일치와 PNG 렌더링의 겹침·잘림 없음을 확인했다. 앱 코드와 원격 지식은 변경하지 않았다.

## 제품 문구 정리 · 배포 완료

2026-09-12, 앱 `60c365c`의 [CI·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34696655794)가 성공했다. 로그인 소개는 개인 위키, 안내 제목은 위키 사용법으로 정리하고 운영 Edge 화면에서 제목을 확인했다. 현재 지식 두 건도 시작 문서 r3·정제 역할 r2로 수정하고 CLI로 읽어 확인했다. 원문 인용과 과거 개정은 보존했다.

## 개인 에이전트 정제·메뉴별 페이지 · 운영 전환 완료

2026-09-12 앱 `0bf20179694b808f90481380ab61512e9e662a6a`의 [CI·ARM64 빌드·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34696016139)가 성공했다. Actions 전체는 2분 40초다. Caddy·Web·API·PostgreSQL 4개 실행과 건강 검사를 확인했고 PostgreSQL 컨테이너 ID는 교체 전과 같았다. Worker 컨테이너·런타임 파일·이전 큐를 제거했다.

- 기존 원문 메타데이터 0개·수동 지식 5개와 API 키를 초기화했다. 사용자·세션·개인 작업 Workspace를 유지했다.
- CLI로 실제 비공개 Object Storage에 역사 원문 6개, DB에 지식 6개를 등록했다. 이어 CI·Compose 출력 발췌 1개를 추가하고 시작 문서를 r2로 갱신했으며 새 `recall`에 반영됐다. 현재 원문은 총 7개다. 같은 반영을 재전송해 중복 없이 같은 결과가 반환됐다. 모든 글은 에이전트 작성·검토 전이며 현재 시점의 정제 실행과 정확한 근거 줄을 가진다.
- `wiki recall`에서 프로젝트 시작 문서와 목차, `wiki search "Atlas 독립"`에서 고정 개정 인용을 확인했다. CLI·Skill을 로컬 설치하고 `.agent-wiki.json` 연결과 Git 제외 `.env.local`의 `WIKI_TOKEN`을 준비했다. npm 공개 게시나 모든 에이전트의 자동 훅 설치는 하지 않았다.
- 소유자의 기존 Edge 세션으로 새 페이지·지식 6개·원문 6개·근거 수와 원천 자료 메뉴의 새로고침 유지, 고정 개정의 근거 탭과 원문 5–8줄 표시를 확인했다. 로컬에서는 새로고침·뒤로 가기·과거 개정·원문 업로드·웹 정정·라이트 테마 유지·390px 가로 넘침 없음을 확인했다.

검색은 키워드 방식이다. 에이전트가 질문에서 핵심어를 골라 조회하고 정확한 원문이 필요할 때 추가 조회한다. 저장되지 않은 대화 복구·의미상 사실 검증·자동 전체 세션 수집·MCP·임베딩은 완료 범위가 아니다. 모니터링 전환의 별도 검증은 아래 해당 기록을 따른다.

## 개인 에이전트 정제·메뉴별 페이지 · 로컬 검증 완료

2026-09-12, 서버 Worker·NVIDIA·pg-boss를 제거하고 불변 원문·다중 근거·지식 개정·멱등 반영·시작 Context를 구현했다. 메뉴별 Next.js URL, shadcn/ui 기본 컴포넌트와 사용법 화면, `wiki` CLI·Skill을 추가했다. **이 기록 시점에는 새 버전의 운영 배포 전이다.** 아래 첫 버전 기록과 구분한다.

- API 통합·정상 종료 검사 16개 통과: 중복 반영·개정 충돌·Workspace 격리·근거 구간·과거 개정·대체 순환·Context 크기 제한·실제 SIGTERM.
- CLI로 원문 6개 → 지식 6개 → 동일 묶음 재시도 → 시작 Context → 고정 개정·근거 조회를 로컬에서 확인했다. 사용자가 제공한 대화 발췌와 커밋이 고정된 이전 README를 사용했다. 당시 자동 추출이나 사람 검토 완료로 표시하지 않았다.
- 최초 전환은 기존 Wiki 테이블·키·큐만 초기화한다. 사용자·세션·Workspace, VM·DB 컨테이너·인증서·Object Storage 운영 체크포인트를 보존한다. 실패하면 외부 유지보수 응답을 유지해 옛 앱과 새 스키마가 섞이지 않게 한다.

## shadcn/ui 기본 디자인 선택 · 문서 반영

2026-09-12 공식 저장소·컴포넌트·테마 문서를 확인하고 웹 기본 디자인을 shadcn/ui로 선택했다. Neutral 테마·Radix 계열·Lucide와 화면별 컴포넌트 조합을 `docs/DESIGN.md` 및 전환 계획에 반영했다. 기존 앱의 자체 CSS·Radix Select는 아직 교체하지 않았으며 이번 변경은 문서만 반영했다.

## 개인 에이전트 정제 전환 · 계획만 작성

2026-09-12, 개인 에이전트가 정제하고 Wiki는 저장·근거 검증·조회하는 방향으로 문서와 그림을 변경했다. [실행 계획](client-and-api.md)과 목표 4개 컨테이너 그림은 구현 완료 증거가 아니다. 이 작업에서는 앱 코드·운영 DB·원문·키·클라우드 자원·배포를 변경하지 않았다. 기존 Worker·NVIDIA 경로와 수동 등록 지식 5개는 전환 전 상태로 남아 있다.

사용자는 **개발 모드에서 DB·원문·기존 지식·키 초기화와 하위 호환성 없는 재구성**을 허용했다. 사용자가 운영 모드로 선언하기 전까지 적용한다. 다음 구현에서는 새 구조를 검증한 뒤 일괄 교체하고 실제 근거에서 프로젝트 역사를 다시 작성한다.

계획 검증: 계층·배포·리니지·운영 SVG 4개를 재생성하고 XML·편집 가능한 텍스트·재생성 일치·문서 상대 링크와 앵커를 검사했다. PNG로 실제 렌더링해 겹침·잘림을 확인했다. 앱 테스트·배포는 이번 문서 작업의 검증에 포함하지 않는다.

## 개인 위키 테마·접근 제한 갱신

2026-09-12, 앱 커밋 `3f8ce7f93dee6440144d7afe88500155c8bf3727`을 [GitHub Actions](https://github.com/agent-observatory/agent-wiki/actions/runs/34683743055)로 배포했다. CI 검증·ARM64 이미지 게시·배포가 모두 성공했다(2분 31초). 다크가 기본이며 로그인 화면과 앱 헤더에서 라이트로 전환할 수 있다.

- 로컬: typecheck·production build·테스트 11개 통과. 합성 OAuth 응답으로 비소유자 사용자·세션 생성 차단, 기존 비소유자 세션·API 키 거부, 소유자 설정 누락 시 접근 차단을 확인했다. 390px 화면·문서 편집·테마 유지도 확인했다.
- 운영: Edge의 기존 소유자 세션으로 정상 접근, 다크 화면, 라이트 전환 후 새로고침 유지와 다크 복귀를 확인했다. 다른 사람의 실제 GitHub 계정으로 로그인하지는 않았다.
- 첫 실사용 자료는 [Atlas에서 Wiki까지의 역사 초안](architecture.md#프로젝트-역사)을 바탕으로 개인 작업 Workspace·개발 기록 폴더에 문서 5개를 직접 등록했다. 각 문서에 여러 태그와 근거 링크를 넣었다. NVIDIA 추출 경로를 사용한 것이 아니다.

같은 날 아이콘 전용 테마 토글(`b5c5ac7`)과 공통 드롭다운(`f3edb2e`)을 배포했다. [드롭다운 CI·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34684211495)가 성공했고 운영 브라우저에서 다크·라이트 메뉴, 선택 표시, 방향키·Enter 선택, Escape 후 포커스 복귀를 확인했다. 자료 5개는 새로고침 뒤에도 유지되며 `VM` 검색의 첫 Context에 단일 VM 결정 문서·개정·인용 URL이 반환됐다. 역사 문서의 연결 문서 4개도 표시됐다. 실제 에이전트 클라이언트 연결은 아직 후속 작업이다.

## 첫 버전 요약

웹 디자인은 OpenGateway Docs를 참고해 중성 검정·회색과 파란 포인트, 구분선 중심의 목록·본문으로 갱신했다. 앱 `1b633cf`의 [CI·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34684581721)가 성공했다. 로컬 합성 자료로 1440px·390px의 다크/라이트와 가로 넘침 없음, 주요 글자 대비를 확인했으며 운영에서도 기존 지식 5개와 역사 문서의 새 화면을 확인했다. 문서 그림의 색상 규칙은 유지한다.

첫 버전을 OCI에 배포했다. **https://agent-wiki.duckdns.org 에서 HTTPS 접속·GitHub 소유자 로그인을 확인했다.** 비용·오류 모니터링은 아래 별도 검증 기록을 따른다. 실제 NVIDIA 추출 성공은 미완료 항목이다.

## 첫 배포 당시 상태

| 항목           | 상태                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| OCI 계정       | API 인증 성공, Osaka Home region. 사용자가 PAYG 업그레이드 완료를 확인                                                            |
| 비용 범위      | A1 2 OCPU·12GB, 부트 50GB + 데이터 50GB만 허용                                                                   |
| OCI 자원       | VCN·서브넷·Internet Gateway·보안 목록·원문 버킷·50GB 데이터 볼륨 생성                                            |
| VM             | A1 2 OCPU·12GB RUNNING. 부트 50GB·데이터 50GB 연결·전송 중 암호화 확인                                                      |
| 앱             | Next.js 웹, Fastify API, pg-boss Worker 작성. 인증·권한·개정·검색·큐 복구·SIGTERM 통합 테스트 8개 통과           |
| NVIDIA 추론    | 모델 ID 조회 성공. 합성 자료 추론은 시간 초과로 실제 추출 성공을 확인하지 못함                                   |
| DNS·HTTPS      | DuckDNS를 VM에 연결, Caddy 인증서 자동 발급·HTTPS 200 확인                                                        |
| 로그인         | 실제 GitHub OAuth 로그인 성공. 등록한 소유자의 GitHub ID만 허용                                                         |
| GitHub Actions | 테스트 → ARM64 이미지 게시 → 실제 VM 배포 성공. `DEPLOY_ENABLED=true` |
| 모니터링       | 오류는 OCI 기본 경보로 전환. 비용·사용량 Actions 유지. 아래 전환 검증 기록 참고 |

이 문서는 실제 수행 상태다. [아키텍처](architecture.md)와 그림은 목표 구조를 설명하며, 구현·배포 검증의 증거를 대신하지 않는다.

## 첫 버전 사용 흐름

1. GitHub 로그인 후 Workspace를 만든다. 다른 사용자의 로그인은 허용하지 않는다.
2. 문서·기억·용어를 작성하고 폴더·태그·용어 별칭을 지정한다. 문서 수정에는 현재 개정 번호가 필요하다.
3. 에이전트 연결에서 Workspace 전용 조회 키를 발급한다. 원천 자료를 접수할 에이전트에는 별도 `ingest` 키를 발급한다.
4. `/api/workspaces/{id}/context?q=...`에서 문서 발췌·개정·출처를 받는다. 이 조회는 LLM을 호출하지 않는다.
5. 원천 자료 접수에는 외부 NVIDIA 전송 동의와 `Idempotency-Key`가 필요하다. 100KB 이하의 비기밀 텍스트·Markdown·JSON으로 시작한다.
6. AI 정리 문서는 확인 필요 상태로 표시한다. 인용 문구가 원천 자료에 실제 존재하는지 검사한 뒤 저장한다.

삭제는 즉시 검색·Context에서 제외하는 논리 삭제다. 운영 백업, 정기 복원 검사, 과거 원문 객체의 물리 정리는 이번 첫 버전 범위 밖이다. 원문 저장소·로그·외부 AI 약관에 맞지 않는 자료는 넣지 않는다.

## 운영 경계

- `.env.local`은 개발자의 비밀 원본이며 Git에 넣지 않는다. Terraform state·tfvars·배포 키·런타임 env도 Git에서 제외한다.
- API·Worker의 런타임 환경 파일은 따로 만들고 DB 관리자 비밀번호·Slack 토큰·OCI 사용자 개인키를 전달하지 않는다. OCI 원문 저장에는 VM instance principal을 사용한다.
- DB 마이그레이션만 별도 DDL 역할을 사용한다. DataGrip용 계정은 앱 계정과 분리하며 TLS·비밀번호로 접속한다.
- GitHub Actions는 공개 저장소의 기본 러너를 사용한다. 유료 대형 러너·유료 자원·무료 한도 초과는 허용하지 않는다. PAYG 계정 업그레이드는 사용자가 직접 완료했다.
- 이미지 빌드는 VM 밖에서 실행한다. 배포는 이미지 pull → Caddy 외부 차단 → Web/Worker/API 정상 종료 → 마이그레이션 → 앱 교체 → 상태 확인 → 외부 재개 순서다. Caddy와 PostgreSQL은 일반 앱 배포에서 유지한다.
- 실패한 마이그레이션의 자동 되돌리기는 하지 않는다. 이전 앱과 호환되는 추가 변경만 자동 배포한다.

## 인프라 이력

Terraform은 `infra/terraform/`에 있다. 로컬 state에는 생성된 자원이 기록돼 있으므로 새로 중복 생성하지 않고 같은 state로 이어간다. VM·데이터 볼륨·원문 버킷에는 `prevent_destroy`를 적용했다. 운영 환경 변경 전 계정 전체 무료 사용량과 plan을 확인한다.

2026-09-12 재확인 결과, VM 생성은 `LaunchInstance`의 `Out of host capacity`로 실패했다. Terraform과 별개인 OCI capacity report도 2 OCPU·12GB, 2 OCPU·6GB, 1 OCPU·6GB 모두 `OUT_OF_HOST_CAPACITY`였다. 작은 사양은 조회만 했으며 실제 구성은 2 OCPU·12GB를 유지한다. 이는 Osaka에서 계정에 할당 가능한 A1 호스트 용량 부족이며, 디스크 부족이나 계정의 A1 사용량 초과가 아니다. 당시 VM 사용량은 0, 부트 볼륨은 0GB, 데이터 볼륨은 50GB였다. 서비스 한도 여유는 무료 제공량을 의미하지 않는다. [OCI 용량 부족 안내](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/troubleshooting-out-of-host-capacity.htm)

Terraform 문법 검증과 모의 plan 검사를 통과했다. 실제 plan은 기존 자원을 유지하고 VM·볼륨 부착·동적 그룹만 추가한다. 이후 업그레이드 완료 통보 뒤 같은 state로 VM 생성·볼륨 연결·배포를 완료했다.

## 확인한 것과 남은 것

- 브라우저에서 Workspace 생성, 문서 저장·읽기, 키워드 검색, 근거 Context 표시를 확인했다. 모바일 390px에서 가로 넘침이 없다.
- 실제 Docker 이미지에서 TLS로 PostgreSQL에 연결하고 마이그레이션·API readiness 200·미인증 401·정상 종료 코드 0을 확인했다. DataGrip 전용 계정은 신뢰한 CA로 TLS 접속되고 평문·미신뢰 CA 접속은 거부된다. 이는 로컬 컨테이너 검증이며 2026-09-12에는 맥에서 공인 DB 주소로 `wiki_admin`·신뢰 CA·서버 검증을 사용한 TLS 접속까지 확인했다.
- 초기 설치에서 PostgreSQL이 `pg_hba.conf`를 읽지 못하는 권한 문제와 재실행 시 기존 DB 초기화 파일을 덮어쓰지 못하는 문제를 수정했다. 비공개 임시 경로로 전달한 뒤 파일별 소유자·권한을 지정한다. 실제 PostgreSQL 컨테이너에서 첫 설치·재실행·비밀 파일 접근 제한을 검증하며 CI에도 포함했다.
- 실제 API 프로세스에 SIGTERM을 보내 DB 처리 중인 요청이 200으로 끝나고 종료 코드 0으로 내려가는 것을 확인했다. 남아 있던 keep-alive 연결이 종료를 막던 문제를 수정했다.
- 강제 종료 등으로 큐가 최종 실패하면 자료 목록 조회 때 실패 상태를 맞추고 수동 재시도를 허용한다. 새 작업 ID가 생긴 뒤 늦게 도착한 옛 작업은 반영하지 않는다. 실제 VM 컨테이너의 강제 종료·복구 검증은 배포 후 남아 있다.
- Kimi/DeepSeek는 응답 시간 초과 후 유한 재시도·최종 실패까지 확인했다. 인용 검증과 중복 반영 방지는 합성 모델 응답을 주입해 검증했으며, 이를 실제 NVIDIA 추론 성공으로 표현하지 않는다.
- 첫 버전 AI 수집은 새 문서·기억 후보를 만든다. 기존 지식을 자동 병합하거나 사실 확인 완료로 승격하지 않는다. 웹에서 편집·확인한다.
- MCP 서버, 그래프 시각화, 자동 기존 문서 병합, 로그 없는 전체 중단·지표 경보는 후속 작업이다. HTTP Context API와 문서 연결 데이터는 구현돼 있다.

같은 Terraform state로 볼륨 부착과 instance principal을 완료했다. `scripts/bootstrap-vm.py --image <검증된 커밋 SHA>`는 런타임 환경 파일·DB TLS 인증서·DNS·Actions 접속 정보를 준비한다. 해당 스크립트와 `ci.yml`로 첫 배포를 수행했다. 배포 검증 결과는 아래 기록을 따른다. 이 스크립트는 VM을 생성하거나 유료 전환하지 않는다.

GHCR 패키지는 조직 정책상 비공개다. Actions가 짧은 수명의 저장소 범위 토큰을 stdin으로 VM에 전달해 이미지를 받고 즉시 임시 Docker 인증 파일을 지운다. 개발자의 GitHub 개인 토큰은 VM에 복사하지 않는다.

2026-09-12 사용자 요청으로 자동 VM 생성·배포 재시도 예약을 삭제했다. 자동 재시도하지 않는다. 이후 사용자 지시로 Terraform을 수동 재실행했다.

## 첫 OCI 배포 확인

- 사용자 요청으로 진행 중이던 로컬 아키텍처 문서·그림 변경을 롤백하고 기존 OCI 구성으로 복귀했다. 클라우드 사양은 늘리지 않았다.
- VM 생성은 약 37초에 성공했다. 볼륨의 PV 전송 중 암호화와 VM 옵션 불일치를 수정했고, 재시작 후 암호화된 볼륨 연결을 확인했다. Terraform `prevent_destroy`는 유지했다.
- 생성 전용 암호화 필드와 cloud-init user data 변경은 기존 VM을 교체하지 않도록 처리한다. 실제 암호화 상태는 `launch_options`, 기존 호스트 설정 갱신은 `scripts/configure-host.sh`가 담당한다. 수정 뒤 Terraform 모의 검사와 실제 `No changes`를 확인했다.
- Ubuntu AppArmor에 로그 소켓 경로만 허용하고 로그 디렉터리 소유권을 수정했다. `configure-host.sh`로 로그 기록·부팅 시 Compose 서비스 등록을 복구했으며 실제 JSON 로그와 systemd active를 확인했다.
- GitHub Actions run `34679399455`로 첫 배포한 뒤 최종 run `34679670518`에서도 테스트·ARM64 이미지 게시·배포가 모두 성공했다. 현재 앱 이미지 기준 커밋은 `047af5a9e301d51373c6a818f8aacdfa89e73604`이며 앱 교체 중 PostgreSQL 컨테이너는 유지됐다.
- Caddy·웹·API·Worker·PostgreSQL 5개 컨테이너 실행, API readiness 200, 실제 HTTPS 200과 GitHub 소유자 로그인, 외부 DB TLS 접속을 확인했다. DataGrip 접속 값은 `.env.local`에 저장했다.
- 합성 자료로 웹 문서 생성·키워드 검색·개정과 출처를 포함한 Context, 에이전트 키를 사용한 원격 Context API 200을 검증했다. 검증용 공간·문서·개정·임시 키는 모두 정리했다.
- 첫 앱 배포 당시 비용·오류 알림은 미완료였다. 이후 사용자가 Incoming Webhook을 제공했으며 현재 구성과 검증은 아래 기록을 따른다.

## 오류 알림 · OCI 기본 경보

아래는 이전 구성의 기록이다. 현재 발송 기준은 [OCI 기본 오류 알림](#oci-기본-오류-알림)을 따른다.

2026-09-12, 오류 알림만 다음 경로로 전환했다. 앱·VM·DB와 비용·사용량 알림은 변경하지 않았다.

`stdout → Docker syslog → rsyslog → OCI Unified Monitoring Agent → OCI Logging → Connector Hub → Monitoring 경보 → Notifications → Slack`

- 기존 Connector Hub와 확인된 Slack 구독을 재사용한다. `data.severityNumber >= 17`만 `agent_wiki_errors / ErrorLogCount` 지표로 보낸다. 원본 JSON은 Slack에 전달하지 않는다.
- 경보는 `ErrorLogCount[5m].grouping().count() > 0`, 평가 간격 1분·발동 대기 1분·집계 대기 5분이다. 로그 전송 지연을 포함하므로 즉시 알림은 아니다.
- 한국어 제목·요약·본문과 오류 로그 링크를 사용한다. 상태 변경 시 알리며 정기 반복은 없다. 오류 종류별 중복 제거는 하지 않는다. `OK`는 경보 해제이며 앱·로그 수집 정상의 증명이 아니다.
- 원격 `Application error monitor` 워크플로는 중지했다. 로컬 오류 조회 워크플로·포매터·전용 테스트를 제거했다. 비용 Actions와 공유 운영 체크포인트는 유지한다.
- Terraform 적용: 경보 1개 생성·기존 권한/커넥터 2개 수정, 삭제 없음. 실제 Docker stdout의 INFO·WARN·ERROR 합성 로그 3개가 OCI Logging에 수집됐고, 오류 지표는 1건이었다. 22:21 한국 시각에 경보 발동과 Slack 도착을 확인했다(로그 출력 후 약 9분). `ONS_OPTIMIZED` 기본 서식으로 수정한 알림도 22:24·22:25에 실제 수신·표시를 확인했다. 확인용 반복은 해제했고 API의 반복 설정 `null`을 확인했다. 기본 서식의 상태·시각 등 OCI 고정 항목은 영어다. 긴 URL은 `오류 로그 보기` 링크로 줄였다.

Terraform 모의 검사 2개·기존 비용 알림 테스트 9개, SVG XML·상대 링크·실제 렌더링 검사를 통과했다. 전체 Terraform plan에서 다른 자원 변경이 없음을 확인했다.

[OCI 로그 경보 구성](https://docs.oracle.com/en-us/iaas/Content/connector-hub/alarmlogs.htm)과 [제목·본문 설정](https://docs.oracle.com/en-us/iaas/Content/Monitoring/Tasks/update-alarm-dynamic-variables.htm)을 따른다. 기존 커넥터 1개를 재사용하며 Monitoring 월 수집 5억·조회 10억, HTTPS 알림 100만 건의 [무료 범위](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) 안에서 운영한다. 별도 Function·서버는 없다.

## 초기 비용·오류 모니터링 기록

아래는 전환 전 검증 기록이다. 비용·사용량 구성은 그대로 유지하고, 오류 Actions·Connector Hub 비활성 설명은 위 OCI 경보 구성으로 대체했다.

2026-09-12, 월 예산 SGD 1과 전용 조회 계정을 만들고 GitHub Actions의 두 예약 워크플로를 활성화했다. 앱 VM·DB 사양은 유지했다. 예산은 지출을 강제로 차단하지 않는다.

| 알림 | 실행 기준 |
| --- | --- |
| 정기 비용·사용량 | 매일 09:13 한국 시각. 월 누적·어제 잠정 비용·비교 가능한 날짜의 사용량 증감 |
| 비용·사용량 이상 | 03:13·09:13·15:13·21:13. 첫 양수 비용·새 비용 구간·A1 보수적 예산 80% 이상·일 사용량 급증 |
| 앱 오류 | 5분마다. ERROR 이상만 조회하고 동일 이벤트 제외, 같은 오류는 최대 시간당 한 번 |

앱 JSON → Docker syslog → rsyslog `events.jsonl` → OCI Unified Monitoring Agent → OCI Logging 수집을 확인했다. GitHub Actions가 로그를 조회해 한국어 제목·오류 코드·발생 시각·확인 링크로 Slack에 보낸다. 실제 INFO·WARN·ERROR 합성 로그에서 오류만 선택했고, 재조회는 추가 알림 0건이었다. OCI 검색 반영에는 수 분의 지연이 있었다.

알림 체크포인트는 기존 원문 버킷의 운영 객체 한 개에 보관한다. 전용 OCI 계정의 비용·로그 조회와 조건부 체크포인트 읽기·쓰기까지 확인했다. Wiki 원문·VM 관리 권한은 없다. 실제 비밀은 로컬 비공개 설정과 GitHub `production` secrets에만 두었다. Terraform 실제 plan은 `No changes`, 모의 검사 2개·Python 알림 검사 16개를 통과했다. 운영 그림은 재생성·XML 검사·렌더링을 확인했다.

OCI 원본 JSON을 보내던 Connector Hub는 `INACTIVE`다. 시험용 Topic·Slack 구독은 유지하되 알림 Function과 이메일은 사용하지 않는다. 현재 범위는 기록된 앱 오류이며, 로그가 없는 전체 중단이나 CPU·디스크 경보는 아직 없다. 비용 집계는 최대 48시간 지연될 수 있고 Actions 예약도 지연·누락될 수 있다. 이 구성은 실시간 지출 차단이나 무손실 장애 감지를 제공하지 않는다.

실제 GitHub 실행에서 [정기 비용 요약](https://github.com/agent-observatory/agent-wiki/actions/runs/34683657189)과 [오류 알림](https://github.com/agent-observatory/agent-wiki/actions/runs/34683778380)이 성공했다. Slack 채널에서 두 한국어 카드의 실제 수신·표시를 확인했다. OCI가 JSON 속성을 평탄화하는 차이도 반영해 서비스·오류 코드·요청 ID를 보존한다. 현재 수신 비용은 SGD 0이나 A1 CPU·메모리와 전일 비교 자료는 아직 미집계다. 전체 비용 0을 확정한 상태는 아니다.

오류 재실행에서 추가 알림 0건, 같은 날 비용 요약 재실행에서도 중복 전송이 없는 것을 확인했다. 오류 확인 링크는 해당 로그·ERROR 필터·조회 시간 범위를 연다. Slack 클릭 응답 서버 없이 사용할 수 있도록 카드의 이동 요소는 일반 링크로 마무리했다.

</details>

## 아키텍처 그림 통합 · 2026-09-14

웹 메뉴 구성은 `DESIGN.md`에 모으고 아키텍처의 웹 탐색 섹션과 `wiki-navigation.svg`를 제거했다. L1–L5와 리니지는 `wiki-layers.svg` 하나로 합쳤으며 증분 정제·결정 변경·원문 근거 추적·독립 조회를 표시한다. 기존 `wiki-lineage.svg`와 두 폐기 그림의 생성 코드는 제거했다.

문서·생성기 수정 완료. 현재 SVG 8개의 XML, 생성기 재실행 일치, 변경 문서의 상대 링크, 통합 그림 렌더링의 겹침·잘림을 확인했다. 이 작업은 문서 정리이며 앱 배포·운영 설정·정제 상태는 변경하지 않았다.

통합 그림의 L1–L5 제목에 남색 상단 띠와 흰 글자를 적용했다. 생성기의 선택 옵션과 DESIGN 규칙에 반영하고 XML·재생성 일치·실제 렌더링을 확인했다.

## 지식 용어·그림 논의

2026-09-14. 사용자 요청으로 구현·배포를 보류하고 Claim(주장)·Decision(결정 유형)·Wiki Page(주제별 페이지) 용어를 제안했다. 당시 두 개의 개념 초안을 추가했다. 최종 구현에서는 `wiki-knowledge-model.svg` 하나로 통합했다. L1–L5 이름은 유지하고 L3 내부 저장 결과와 L2 처리 책임을 구분한다. SVG XML·문서 상대 링크와 PNG 렌더링의 글자·잘림을 확인했다. 실제 정제·DB·모델 호출·초기화는 수행하지 않았다.

## 통합 model Step의 재시도가 한 번도 모델에 닿지 않았다 (2026-09-17)

`knowledge-design` 주제의 Consolidation Job이 model Step에서 73회 시도하고도 실패만 반복했다. 오늘의 AI 호출 수가 84 → 102 → 120으로 계속 올라가서 무한 재시도를 먼저 막았고(`MAX_MODEL_ATTEMPTS = 12`), 그 뒤 실제 원인을 찾았다.

- 진짜 실패는 **1회차 한 번뿐**이다. glm-5.2가 HTTP 200으로 응답했고 출력이 계약과 달라 `AI_INVALID_OUTPUT`이 됐다.
- 2회차부터 71회는 **모델을 부르지도 않은 유령 시도**였다. HTTP 상태 없음·usage null·소요 0초.
- 원인: gather는 결과를 `steps.model.output`에 넣는데, model Step의 실패 분기 두 곳이 `steps.model`을 새 객체 리터럴로 다시 만들면서 `output`을 떨어뜨렸다. 다음 시도는 `modelPrompt(undefined)`에서 TypeError로 죽었고, 분류기에는 ModelError도 ZodError도 아니어서 일반 버킷(`CONSOLIDATION_MODEL_FAILED`)으로만 남았다.
- 즉 "출력 오류는 3회까지 새 응답을 받는다"는 규칙은 **한 번도 작동한 적이 없다**. 첫 출력 오류에서 사실상 Job이 죽는다.
- 기존 회귀 테스트는 이 버그가 있어도 통과했다. mock이 `gathered`를 쓰기 전에 예외를 던져서, 2회차에 모델이 호출됐는지를 아무도 확인하지 않았다.

함께 고친 것:

- 재시도 시 `steps.model`을 spread로 보존한다. `output`이 없으면 모델을 부르지 않고 gather부터 다시 한다.
- 호출 집계 기준인 `requestedAt`을 프롬프트 조립 **뒤**로 옮겼다. 프롬프트를 만들다 죽는 건 우리 버그이지 모델 호출이 아니다. 유령 71회가 오늘 호출 수에 들어가 있었다.
- 실패한 run에 `detail`·`usage`·`schemaIssues`를 남긴다. 그 전에는 코드만 남아서 1회차의 진짜 원인을 지금도 알 수 없다.
- `AppError`(`AI_ENDPOINT_NOT_ALLOWED`·`AI_REASONING_NOT_SUPPORTED`)를 분류에 추가했다. 맨 `TypeError`는 일부러 일반 버킷에 둔다. 추출처럼 `AI_CONNECTION_FAILED`로 매핑하면 프로그래밍 오류가 일시 오류로 위장해 조용히 재시도한다.
- `PROMPT_VERSION`을 `remote-curation-19`로 올렸다. `ai_inference`를 `current`로 발행하지 못하게 한 서버 규칙이 그 전 실행과 구분되지 않았다.

미해결로 남긴 것: 통합 model Step에 입력 예산 검사가 없다. 강등된 주장의 관계를 버린다(`curation-proposal.ts`). 근사 중복은 병합되지 않는다(정확 일치만). `failed` Job의 `rerun_requested`는 읽히지 않는다. 그리고 여전히 현재 주장의 87%가 이 위키를 만든 세션 자체에서 나온다.

## 배포 실패가 이유를 말하지 않았다 (2026-09-17)

`a734355` 배포에서 migration Job이 180초 안에 끝나지 않아 롤백됐다. CI 로그에는 `timed out waiting for the condition` 한 줄뿐이었고, 롤백이 Job을 정리한 뒤라 VM에 접속했을 때는 Pod도 로그도 없었다. 같은 커밋을 그대로 재실행하니 성공했다 — 스키마 변경이 없는 배포였으므로 원인은 그 순간의 잠금 대기이거나 이미지 준비 지연이다. **어느 쪽인지 확인할 방법이 없었다는 것이 진짜 문제다.**

`scripts/deploy-k3s.sh`의 롤백 경로가 Job의 Events와 Pod 로그 60줄을 먼저 출력하도록 고쳤다. 다음 실패는 스스로를 설명한다.

## knowledge-design 통합 재실행 — 픽스 확인 (2026-09-17)

배포 후 `consolidate knowledge-design`을 1회 수동 실행했다. **1회차에 HTTP 200·`finish=stop`으로 완료**했다. 73회 시도하고도 못 하던 주제다. 관계 40개 반영·5개 규칙 거절.

다만 반영된 40개가 **전부 `supports`**다. 전체 관계는 157개가 됐고 그중 `supports` 143 · `supersedes` 9 · `contradicts` 4 · `retracts` 1이다. 통합이 만들어내는 거의 유일한 판정이 "서로 뒷받침한다"이고, 화면에서는 아무것도 접히지 않는다. 통과한 관계의 근거를 열어보면 `✓ Compiled successfully` 같은 도구 출력이 인용돼 있다 — 자기 순환 수집의 잔재다. 파이프라인은 이제 돌지만, 그 산출물이 독자에게 주는 것은 아직 거의 없다.

## 강등된 주장의 `supports`·`contradicts`를 더 이상 버리지 않는다 (2026-09-17)

근거가 사용자·도구의 것이 아니면 `user_decision`·`observation` 주장을 `agent_statement`로 강등하는데, 그때 그 주장이 제안한 **관계를 전부 지우고 숫자만 진단에 남겼다.** `l2-l3-memory.md`가 "관계를 버려 통과시키지 않는다"고 적어둔 것과 정면으로 어긋난다.

실제로 버려야 하는 건 `supersedes`·`retracts`뿐이다 — 채택된 주장만 다른 주장을 대체·철회할 수 있으므로 강등된 주장의 대체 제안은 성립하지 않고, 그대로 두면 청크가 `CLAIM_REPLACEMENT_NOT_CURRENT`로 계속 재생성된다. `supports`·`contradicts`에는 그런 규칙이 없다. 강등은 **누가 말했는지**에 대한 판정이지 두 주장이 서로 어떤 관계인지에 대한 판정이 아닌데, 후자까지 같이 지우고 있었다.

이제 대체 계열만 걸러내고 그 목록을 `diagnostics.droppedRelations`에 이유와 함께 남긴다.

## 실패한 Job이 사람의 재실행 요청을 삼켰다 (2026-09-17)

Job이 실행 중일 때 도착한 수동 트리거는 두 번째 Job을 만들지 않고 그 Job의 `rerun_requested`로 흡수된다. 그런데 `rerun_requested`는 Job이 **완료**될 때만 읽혔다. 그 Job이 실패하면 사람이 누른 요청은 아무 데도 남지 않고 사라졌다. 이제 실패 처리가 그 플래그를 확인하고 새 수동 Job을 만든다(고유 인덱스가 `pending`·`running`만 덮으므로 실패한 행 옆에 바로 만들 수 있다).

## `ai_inference`가 `current`로 발행되는 것을 서버에서 막는다 (2026-09-17)

"AI 해석은 사람이 채택하기 전까지 제안"이라는 규칙이 Worker의 제안 검증에만 있었다. 그 규칙이 생기기 전에 발행된 `ai_inference`·`current` 주장 4개가 지금도 사용자의 결정 옆에 확정 사실처럼 보인다. `DECISION_EVIDENCE_NOT_USER`를 서버에 둔 것과 같은 이유로 — 모든 자동 발행자가 여기를 지나간다 — `AI_INFERENCE_NOT_CURRENT`를 발행 경로에 추가했다. 기존 4개는 그대로 남아 있으며 별도 정정 대상이다.

## supports 편중을 다룬다 — 접기·좁히기·기억 (2026-09-17)

관계 157개 중 143개가 `supports`였다. 통합은 돌지만 화면에서는 아무것도 줄지 않았다. 세 가지를 함께 했다.

1. **결정적 접기.** `supports`로 이어진 `current` 주장의 연결 성분을 대표 하나로 접는다. 대표 선정 규칙은 권한 → 다른 주장을 supports하지 않는 것(재진술이 아닌 원 진술) → 가장 이른 `recorded` 근거 시각 → 근거 수 → 주장 ID. 전순서라 행 순서와 무관하게 같은 결과가 나온다. 규칙은 `packages/core/src/wiki-page.ts` 한 곳에 있고 Version 스냅샷의 `clusters` 필드로 웹에 전달된다 — 웹은 그 결정을 그릴 뿐 다시 계산하지 않는다. 조립 버전 `topic-sections-6`.
2. **프롬프트 좁히기.** `supports`는 "출발 주장이 대상과 **같은 진술**을 다시 말하거나 그 진술의 새 근거일 때"로 좁혔다. 한 subject에 대한 서로 다른 참인 사실 둘은 `leave_unresolved(parallel)`이다. `CONSOLIDATION_PROMPT_VERSION`은 `consolidation-2`.
3. **판단 끝난 묶음 기억.** `current`가 2개 이상인 묶음은 실행할 때마다 후보였다. 그래서 그냥 둘 다 참인 사실 한 쌍이 14개 Job에 걸쳐 계속 재과금되고 `supports`가 계속 붙었다. 이제 묶음 지문을 `steps.gather.output.groupHashes`에 남기고 직전 completed Job과 같으면 모델에 보내지 않는다. **수동 실행도 이 기억을 따른다** — CLI가 지금 통합이 실제로 도는 유일한 경로라 수동을 예외로 두면 재과금이 그대로다. `consolidate plan`·`--all`도 같은 기억을 읽어 "이번엔 0개"가 정직하게 보인다.

회귀 테스트: 같은 corpus에 두 번 실행 → 두 번째 모델 호출 0회. 접기 규칙은 입력을 뒤집어도 같은 대표를 고르는지 확인한다.

## 위키가 자기 출력을 다시 먹는 것을 입력 단계에서 끊는다 (2026-09-17)

`wiki_echo` 생략을 추가했다(`text-fields-5`). 에이전트가 Wiki CLI를 실행하면 그 출력에 위키 내용이 담기고, 그게 L1로 수집돼 관찰로 추출되고 다시 지식이 된다. 현재 주장의 87%가 이 위키를 만든 한 세션에서 나온 이유다.

역할 게이트로는 못 막는다. 도구 출력은 **정당한 관찰이 인용하는 바로 그것**이고, `kubectl get pods`와 `agent-wiki pages`를 역할로 구분할 방법이 없다. 그래서 판정이 가능한 유일한 지점 — 그 출력을 만든 **명령** — 에서 끊는다. Wiki CLI를 부른 도구 호출과 그 출력 블록을 통째로 비우고, 짝은 `id`·`call_id`·`tool_use_id`로 맞춘다. L1은 그대로 두고 해당 줄만 비워 원문 줄 번호를 유지하므로 인용 검증도 그대로다.

`agent-wiki-worker Running` 같은 **진짜 관찰은 남는다** — 정규식은 명령만 보고, 이름이 본문에 등장하는 것으로는 걸리지 않는다. 회귀 테스트가 둘을 함께 확인한다.

이 게이트가 Claude 수집 재개의 선행 조건이다.

## 재구성 실행과 그때 드러난 청크 폐기 (2026-09-17)

Fable과 정한 대로 실행했다. 실행 전 상태 전체(페이지 스냅샷 32개·주장 423개·관계 157개·원문 분포)를 `experiments/curation/production/pre-rebuild-2026-09-17.json`에 남겼다 — 이게 유일한 사본이다.

- 정제 중지 → `POST /curation/rebuild`에 **Codex 원문 10개(6,036행)만** 범위로 지정 → 재개. 문서 194개가 지워지고 10개가 큐에 들어갔다. 나머지 682개 원문은 L1에 그대로 있고 화면에는 **미정제**로 정직하게 표시된다.
- 재추출 도중 **청크 2개가 `CLAIM_SCOPE_MISMATCH`로 죽었다**(한 청크는 7회 시도, 한 시간에 8회 호출). 원인은 하나의 잘못된 관계가 **발행 전체를 실패시켜 그 청크의 주장을 전부 버리는** 것이다. 재생성해도 모델은 같은 제안을 다시 하므로 호출만 태우고 결국 청크가 주차된다.
- `subject`·`scope`는 관계를 맺을 수 있는지 판정하는 게이트다. 양끝이 어긋난 관계는 **나중에도 유효해질 수 없으므로** 대기함에 넘길 수도 없다(대기함은 "아직 판단 못 함"이지 "영원히 불가"가 아니다). 이제 Worker가 발행 전에 그 관계만 버리고 주장은 살린다. 버린 목록은 `diagnostics.droppedRelations`에 이유와 함께 남는다.
- 서버 게이트는 그대로다(다른 발행자용 최후 방어선). 회귀 테스트는 `tests/claim-relations.test.ts`·`tests/claim-authoring.test.ts`가 서버 쪽을, `tests/curation-improvements.test.ts`가 Worker 쪽을 고정한다.

## 근거가 어긋난 관계도 청크를 죽이고 있었다 (2026-09-17)

범위 불일치를 고친 직후, 같은 재추출에서 다음 청크가 `CLAIM_RELATION_EVIDENCE_REQUIRED`로 죽었다. 관계는 출발 주장이 이미 가진 근거 중에서만 인용할 수 있는데, 모델이 다른 줄을 골랐다. 이 코드는 재시도 목록에도 없어서 **첫 실패에 바로 주차**됐다 — 재생성 기회조차 없이 그 청크의 주장이 전부 사라진다.

같은 판단을 적용했다. 잘못된 건 관계이지 주장이 아니므로 Worker가 그 관계만 버리고 이유를 `diagnostics.droppedRelations`에 남긴다. 서버 게이트와 재시도 목록은 다른 발행 경로를 위한 최후 방어선으로 남긴다.

이걸로 "관계 하나 때문에 청크 전체를 잃는" 경로는 세 가지(`CLAIM_SCOPE_MISMATCH`·`CLAIM_RELATION_EVIDENCE_REQUIRED`·강등된 주장의 `supersedes`) 모두 막혔다.

## 재구성 결과 — 자기 순환이 지식에서 사라졌다 (2026-09-17)

Codex 원문 10개(6,036행)만 재추출해 **10개 작업 전부 완료**했다. 재추출 중 `CLAIM_SCOPE_MISMATCH`·`CLAIM_RELATION_EVIDENCE_REQUIRED`로 죽던 청크 두 개는 관계 폐기 픽스를 배포한 뒤 재시도해서 통과했다.

검증 질의(운영 DB, 읽기 전용):

| 확인 | 결과 |
| --- | --- |
| `claude:c2715289`를 근거로 하는 current 주장 | **0개** (재구성 전 186개, 전체의 87%) |
| current 주장의 출처 | Codex 세션 4개(467개) + 사용자 피드백 1개 |
| 그 세션 원문의 상태 | 263개가 L1에 그대로, 작업 없음 = 화면에 **미정제**로 표시 |
| `Compiled successfully`·`main -> main` 같은 도구 출력을 인용한 current 주장 | **0개** |
| 페이지 조립 버전 | `topic-sections-6`, `clusters` 포함 |

3시간 창 기준 실행 성공률은 134/148(91%)이고, 새 폐기 기계가 실제로 돌았다 — 범위 불일치 관계 9개·강등 주장의 대체 관계 8개를 **관계만** 버렸고 그 청크의 주장은 모두 살아남았다.

사용자 피드백 주장 1개는 `claim assert`로 다시 세웠다. 이번에는 `infrastructure` 주제에 붙였다 — 이전 것은 `topic_key`가 비어 있어 **어느 페이지에도 나타나지 않았다.**

평가용 corpus로 위키를 만들기 **이전** Codex 세션(`01a092a5`)의 원문 22개(8,780행)를 큐에 넣었다.

## 무한 재시도의 일반형도 막았다 (2026-09-17)

`runConsolidation`의 바깥 catch — Step이 던진 것을 잡는 마지막 자리 — 가 **횟수 계산 없이 60초마다 영원히 재시도**하고 있었다. 오전에 73회까지 간 모델 Step 버그의 일반형이다. 열두 번 시도해도 안 풀린 DB 오류는 더 해도 안 풀린다. 이제 해당 Step의 시도 수를 기록하고 상한에서 Job을 실패시킨다.

## 직접 찔러보고 찾은 두 구멍 (2026-09-17)

배포한 코드를 합성 입력으로 직접 돌려봤다. 두 개가 나왔다.

- **`wiki_echo`가 실제 Claude 도구 결과 모양을 놓치고 있었다.** 도구 결과의 본문이 블록 배열이면(`content[0].content[0].text`) 그 줄은 `tool_use_id`가 붙은 컨테이너보다 **한 단계 깊다.** 정확히 그 컨테이너만 비교하고 있어서, 게이트가 존재하는 이유인 **위키의 답 자체가 입력에 그대로 남았다.** 이제 조상 경로 전체를 본다. 도구 이름이 위키인 경우(`mcp__agent-wiki__*`)도 함께 잡는다.
- **`supports` 접기가 subject·scope를 가로지를 수 있었다.** 저장 게이트가 막고 있어 실제로는 도달 불가지만, 만약 뚫리면 한 주장이 **다른 subject 묶음 안에 숨겨져** 애초에 없었던 것처럼 읽힌다. 자기 자신을 supports하는 간선도 무시한다.

둘 다 "코드가 만들 상태"가 아니라 "지금 코드가 실제 입력에 무엇을 하는가"를 재서 나왔다.

## 적대적 검토가 찾은 것들 (2026-09-17)

오늘 배포한 10개 커밋을 Fable에 적대적으로 검토시켰다. 9건이 나왔고 그중 다섯은 **운영 데이터로 측정된** 실제 오작동이었다.

1. **웹의 supports 접기가 한 번도 동작하지 않았다.** 스냅샷은 `id|rev|anchor`로 묶음 구성원을 적는데 웹은 `id:rev:anchor`로 찾는다. 구분자 하나가 달라 조회가 전부 빗나갔다 — **페이지 본문은 접히고 화면 목록은 중복을 그대로 보여줬다.** 같은 커밋이 양쪽을 다르게 썼고 테스트는 core만 봤다. 이제 형식을 core에 고정하고 그 문자열 자체를 테스트가 못 박는다. 조립 버전 `topic-sections-7`.
2. **예산 초과로 이월한 묶음이 영원히 이월된다.** 재실행은 같은 Job 행을 재사용하므로 그 Job이 `completed`가 아니게 되고, "직전 completed Job"을 읽는 기억은 아무것도 못 찾는다. 방금 판단한 묶음이 다시 열리고, 같은 것이 또 예산에 맞고, 나머지는 또 이월된다 — 한 바퀴마다 모델 1회. 이제 지문을 그 행에 실어 나른다.
3. **기계가 만든 재실행이 사람 권한을 받았다.** 이월·실패 재실행을 `manual`로 예약해서 `enabled`·`consolidation.auto`·일일 호출 한도·추출 중 거부를 전부 우회했다. 이제 원래 트리거를 유지한다.
4. **강등된 주장의 `contradicts`가 확인된 관찰을 밀어냈다.** 근거 역할 때문에 `agent_statement/unconfirmed`로 내려간 한 문장이, 사용자가 근거로 확인한 current 관찰을 `conflicted`로 만들었다(운영에서 실제 1건). 이제 **양끝이 모두 채택 상태일 때만** 충돌로 친다. 그리고 강등된 주장이 `user_decision`에 건 `contradicts`는 Worker가 버린다 — 서버가 거부하면 청크 전체가 날아가고 재생성해도 모델이 같은 제안을 반복한다.
5. **`wiki_echo`가 이름만 보고 있었다.** 저장소 디렉터리·Kubernetes 네임스페이스·CLI 파일이 전부 `agent-wiki`라서 `cd /repo/agent-wiki && git status`, `kubectl -n agent-wiki get pods`, `cat …/agent-wiki.mjs`가 **전부 차단**됐다. Claude 수집을 켜면 에이전트의 진짜 도구 출력이 거의 다 사라지고, 말한 문장만 남아 지식이 관찰에서 진술로 기운다. 이제 **명령 위치**에서만 판정한다(래퍼 `node`·`npx`·`bash -lc`는 통과시키고 다음 토큰을 본다). Codex의 `arguments` JSON도 같이 푼다.
6. **자기 자신과 관계 맺는 것을 아무도 막지 않았다.** 자기 `supersedes`는 모든 게이트를 통과한 뒤 `effectiveClaimState`가 그 주장을 스스로 대체 처리한다. `relation add`는 FROM의 정정 Version을 먼저 만들어 revision이 달라지므로, 검사는 입력 참조에서 해야 한다.

미해결로 남긴 것: `diagnostics.droppedRelations`를 읽는 화면이 없다(폐기가 조용한 손실의 알리바이가 될 수 있다). `consolidate plan`은 예산 이월을 반영하지 않아 Job이 실제로 보내는 묶음보다 많이 보여준다. 추출 프롬프트의 `supports` 정의는 아직 넓다(통합만 좁혔다).

## subject 어휘에는 정의 층이 없다 (2026-09-17)

새 레퍼런스(어노테이션·시맨틱 레이어·온톨로지의 구분)로 우리 구조를 재보니, 빠진 것은 추론이 아니라 **`subject`의 정의 층**이었다. 운영 DB 측정(live 주장 1,819개·subject 127개):

| 관찰 | 값 |
| --- | --- |
| 주제당 어휘 힌트 한도(24개)를 넘은 주제 | 2개 — `infrastructure` **101개**, `knowledge-design` 34개 |
| 같은 뜻이 다른 slug로 갈라진 쌍 | 최소 4쌍(`graph-storage-visualization`/`-and-visualization` 등)과 4개 군 |
| 여러 주제에 `current`를 동시에 둔 subject | 20개(예: `byok-model-selection`이 3개 주제에 분산) |
| 한 (subject, scope)에 `current` 결정이 6개 이상인 묶음 | 17개 — `agent-wiki-doc-style`은 18개 |
| `glossary` 문서 · 비어 있지 않은 `aliases` | **0개 · 0개** |

가장 직접적인 원인 하나를 고쳤다. 어휘 힌트는 주제당 24개로 자르는데 그 자르기가 **알파벳순**이었다. `infrastructure`는 앞 24개만 모델에 보이고 실제로 그 주제를 떠받치는 77개가 통째로 가려졌으니, 모델은 위키가 이미 이름을 가진 속성에 새 slug를 만들 수밖에 없었다. 이제 **사용 빈도순**으로 자른다(동률은 알파벳순으로 안정).

남은 것: 갈라진 subject를 잇는 방법이 없다. 스키마의 `glossary`·`aliases`가 정확히 그 자리인데 채우는 명령도, 모델에 요구하는 필드도 없다. 토큰 중첩으로 "같은 속성일 수 있는 subject 쌍"을 **모델 없이 결정적으로** 계산할 수 있으므로, 후보를 사람에게 보여 별칭으로 확정받는 것이 다음 단계다. 자동으로 묶지 않는다.

추론을 더 하지 않기로 했다. "같은 subject·scope의 두 결정은 시간 순서가 곧 대체"라는 규칙을 검토했으나, current 결정이 2개 이상인 49개 묶음 중 **모든 결정이 신뢰 가능한 `recorded` 시각을 가진 묶음은 4개뿐**이다. 8%에만 발동하고, 그 8%조차 "나중"이 "대체"라는 보증이 없다 — 같은 subject의 서로 다른 참인 사실 둘은 이미 `leave_unresolved(parallel)`이다.

## 파이프라인 전체를 실제 자료로 한 바퀴 돌렸다 (2026-09-17)

재구성 이후 추출 → 통합 → 재조립을 끝까지 돌린 결과다.

| 단계 | 결과 |
| --- | --- |
| 추출 | 작업 32개 **전부 완료**. current 주장 863개 |
| 통합 1회차 | 묶음 115개 판단, 관계 `supports` 730 · `supersedes` 87 · `contradicts` 27 |
| 통합 2회차 | 열린 묶음 **115 → 5 → 1**. 모델 호출은 첫 바퀴에 몰리고 이후 거의 0 |
| 접기 | 페이지 6개에서 주장 **127개가 대표 아래로 접혔다**(infrastructure 66 · knowledge-design 29 · collection 18 · project-structure 9 · documentation-conventions 5) |
| 추론 | 아무도 저장하지 않은 `superseded` **44건**을 관계에서 도출. 저장된 `state`는 전부 `current`다 |
| 자기 순환 | `claude:c2715289` 근거의 current 주장 **0개**. 도구 출력(`Compiled successfully` 등)을 인용한 current 주장 **0개** |
| 비용 | 오늘 854회 호출 |

통합 기억이 실제로 작동한다: 같은 corpus를 다시 돌리면 열린 묶음이 115에서 5로, 다시 1로 줄어든다. 새 관계가 생기면 그 묶음의 지문이 한 번 바뀌므로 한 바퀴 더 도는 것이 정상이고, 그 뒤로는 변화가 없는 한 모델을 부르지 않는다.

남은 것: `documentation` · `design` 두 주제의 cycle Job이 `auto=false`라 대기 중이다(정상). `diagnostics.droppedRelations`를 읽는 화면이 아직 없다. `subject` 갈라짐을 잇는 용어집은 비어 있다.

## 화면의 접기를 실제 스냅샷으로 확인했다 (2026-09-17)

접기 로직을 `apps/agent-wiki-web/lib/clusters.ts`로 꺼내 테스트 가능하게 만들고, **운영 Version 스냅샷 6개에 화면과 같은 코드를 그대로 돌렸다.**

| 주제 | current | 화면 줄 | 접힌 수 |
| --- | --- | --- | --- |
| infrastructure | 456 | 390 | 66 |
| collection | 135 | 117 | 18 |
| knowledge-design | 134 | 105 | 29 |
| documentation-conventions | 34 | 29 | 5 |
| project-structure | 26 | 17 | 9 |
| technology-selection | 17 | 17 | 0 |
| **합계** | **802** | **675** | **127** |

회귀 테스트는 구분자가 어긋난 형식으로 쓴 멤버십이 **아무것도 접지 않는다**는 것까지 고정한다 — 그게 하루 종일 조용히 실패하던 모습이다. 그리고 core의 `claimKey`와 웹의 `claimKeyOf`가 같은 문자열을 만드는지 테스트가 직접 비교한다.

## subject에 정의 층을 만들었다 (2026-09-17)

`subject`는 관계를 맺을 수 있는지 판정하는 기준인데 정의가 없었다. 같은 속성이 두 slug로 갈라지면 통합이 **둘을 아예 비교하지 않는다.**

- **`subject_aliases`** — Workspace 설정 테이블(지식이 아니다). 발행 없이 넣고 빼며 재구성이 지우지 않는다. 사슬(A→B, B→C)은 양방향으로 거부해 `canonical()`이 한 번의 조회로 끝난다.
- **주장의 `subject`는 절대 바꾸지 않는다.** 모델이 그때 말한 것이고 불변 Revision의 일부다. 대신 **비교하는 자리**가 정본으로 본다: 관계 게이트(`CLAIM_SCOPE_MISMATCH`)·통합 묶음 키·Worker의 범위 불일치 폐기·어휘 힌트·페이지 조립.
- **어휘 힌트에서 별칭은 사라진다.** 사람이 접은 slug를 모델에 다시 보여주면 다음 청크에서 갈라짐이 재발한다. 이게 예방 효과다.
- **후보는 모델 없이 계산한다.** 단순 토큰 겹침은 네임스페이스에 묻힌다(`oci`가 50개 slug에, `container`가 16개에). 토큰을 워크스페이스 어휘 안에서의 희귀도로 가중해 비교한다. 표면 갈라짐(불용어·접미 facet)은 잡지만 **공유 토큰이 없는 진짜 동의어는 못 잡는다** — 그건 154개 목록을 사람이 읽어 정한다.

```bash
agent-wiki subject candidates --min 0.6
agent-wiki subject alias add --alias A --canonical B --reason "같은 속성"
agent-wiki subject alias list
agent-wiki subject alias remove --alias A
```

별칭을 확정하면 그 묶음의 지문이 바뀌므로 다음 통합이 그 묶음만 다시 연다. 통합을 자동으로 시작하지는 않는다.

## 버려진 관계를 볼 수 있게 했다 (2026-09-17)

Worker가 세 이유로 관계를 버리는데(범위 불일치·근거 불일치·강등된 주장의 대체/충돌) **읽는 화면이 하나도 없었다.** 24시간 기준 112건이 진단 JSON 안의 숫자로만 존재했다. Fable의 표현대로 "폐기가 조용한 손실의 알리바이"였다.

- 새 테이블·새 화면을 만들지 않았다. 기존 `consolidation_inbox`에 **`needs_human`** 상태를 더했다. `pending`은 "아직 판단 안 함"이라 모델에 다시 가지만, 게이트가 절대 받을 수 없는 관계는 다시 보내봐야 같은 제안이 돌아온다. gather는 `pending`만 읽으므로 자동으로 제외된다.
- 진단에 남던 `anchor`만으로는 **주장을 특정할 수 없었다**(anchor 97개 중 46개가 여러 문서에 같은 문자열로 존재). 이제 발행 직후 확정된 articleId·revision으로 기록한다.
- `agent-wiki review conflicts`와 웹 **Sources → Curation 탭**이 양끝 주장·subject·scope와 함께 **이유별 결정적 행동 한 줄**을 보여준다. 모델은 쓰지 않는다.
- 사람이 `relation add`로 같은 관계를 실제로 이으면 그 행은 `resolved`가 된다.

## 별칭이 실제로 갈라진 주장을 잇는 것을 확인했다 (2026-09-17)

`subject candidates`가 운영 126개 subject에서 **4쌍**을 냈고, 표면 갈라짐이 분명한 둘을 이었다.

- `graph-storage-and-visualization` → `graph-storage-visualization` (불용어 `and`만 다름)
- `container-instance-dns-storage` → `container-instance-storage` (DNS와 스토리지를 한 slug에 붙였고 주장 내용은 스토리지다)

나머지 둘(`oci-always-free` ↔ `-instances` / `-constraints`)은 **잇지 않았다.** 같은 대상의 서로 다른 측면이라 합치면 묶음만 커지고 판단이 어려워진다.

이은 직후 그 두 묶음의 지문이 바뀌어 다시 열렸고, 통합이 돌아 **`supports` 3개와 `supersedes` 1개**를 새로 맺었다. 별칭이 없었다면 두 slug는 영영 비교되지 않았을 관계다.

## 오늘 최종 상태 (2026-09-17)

| 항목 | 값 |
| --- | --- |
| 페이지 | 6개 · current 주장 801개 → 화면 675줄(126개 접힘) |
| 관계 | `supports` 734 · `supersedes` 88 · `contradicts` 27 |
| 관계에서 도출된 상태 | `superseded` 45건(저장된 값은 전부 `current`) |
| 자기 순환 | 위키를 만든 세션을 근거로 하는 current 주장 **0개** |
| subject 별칭 | 2개 |
| 오늘 AI 호출 | 857회 |

남은 것: 재구성 이전에 만들어진 **정확히 같은 문장의 주장 묶음 28개**가 아직 남아 있다(대부분 `supports`로 이어져 화면에서는 접힌다). 새로 생기는 것은 병합 픽스가 막지만 기존 것을 소급해 합치지는 않는다. `needs_human` 행은 다음 추출부터 쌓인다 — 폐기는 추출 발행 시점에 기록되므로 지금은 0이다.
