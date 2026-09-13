# Client 설치·수집·API 계약

**설치와 연결은 이 문서, 정제·지식 모델은 L2·L3 기억 설계에서 다룬다.** 수집·API 계약은 아래 접힌 영역에 둔다. [전체 구조](architecture.md) · [L2·L3 기억 설계](l2-l3-memory.md) · [실제 배포·검증](OPERATIONS.md).

## 사용자는 어떻게 쓰나

이전 결정이 필요할 때 에이전트가 Wiki를 조회한다. 같은 대화에서는 이미 받은 고정 개정을 재사용하고, 변경 여부가 필요하면 다시 조회한다. 검색은 L2 완료를 기다리거나 모델을 호출하지 않는다.

```sh
agent-wiki recall --project agent-wiki
agent-wiki search "단일 VM" --project agent-wiki
```

`recall`은 저장된 시작 문서·목차를 조회한다. 아직 수집·정제하지 못한 대화까지 기억한다고 설명하지 않는다. 웹은 지식·근거·Version·진행 상태·설정의 읽기 전용 뷰어다. 지식 수정·검토·AI 설정·정제 제어는 CLI에서 실행한다.

## 연결과 지침

**`agent-wiki-client` 하나에 `agent-wiki-cli`·`agent-wiki-collector`·조회 Skill을 포함한다.** CLI와 Collector는 client 패키지 안의 형제 구성이다. client는 별도 실행 프로세스가 아니라 설치 단위이며 조회 Skill은 설치 후 작업 에이전트가 읽는다. 설정은 `~/.agent-wiki/config.json` 하나로 공유한다. 프로젝트 연결 별칭과 수집할 로컬 경로는 구분한다.

```sh
# 저장소 루트에서 패키지 설치
npm install --global ./packages/agent-wiki-client
# 사용할 프로젝트 디렉터리로 이동한 뒤 지침 설치
agent-wiki skill install --client codex
agent-wiki setup --no-skill --workspace <Workspace-ID> --project agent-wiki --path /absolute/project --env /absolute/project/.env.local
agent-wiki collector start
```

순서는 **CLI 설치 → 프로젝트에 Skill 설치 → 연결 설정 → 필요할 때 조회**다. 저장소 밖에서 사용할 때는 먼저 사용할 프로젝트 디렉터리로 이동한다.

| 클라이언트 | 설치 명령 | 현재 디렉터리 기준 경로 |
| --- | --- | --- |
| Codex | `agent-wiki skill install --client codex` | `.agents/skills/agent-wiki/SKILL.md` |
| Claude Code | `agent-wiki skill install --client claude` | `.claude/skills/agent-wiki/SKILL.md` |
| 둘 다 | `agent-wiki skill install --client all` | 위 두 경로 |

`--client` 기본값은 `codex`다. `setup`도 지정 클라이언트의 Skill을 설치하며 기존 파일을 보존한다. 명시적인 `skill install`은 동봉된 버전으로 갱신한다. 연결만 설정하려면 `setup --no-skill`을 사용한다. Claude 경로는 [공식 Skill 안내](https://code.claude.com/docs/en/skills)를 따른다.

Skill은 사용 지침이며 설치만으로 CLI가 자동 실행되지 않는다. 에이전트가 필요성을 판단해 명령을 실행한다. 예를 들어 과거 결정은 조회하고 현재 코드로 충분한 타입 오류 수정은 생략한다. 시작·재개·컴팩션에 강제 호출하지 않는다.

```sh
agent-wiki search "임베딩" --project agent-wiki
agent-wiki recall --project agent-wiki
```

`collector start`는 별도로 자동 수집을 켠다. `setup`·Skill 설치·조회는 수집을 시작하지 않는다. 키는 웹의 **에이전트 연결**에서 발급해 Git 제외 env 파일에 `WIKI_TOKEN`으로 둔다. 조회와 수집을 같은 키로 사용할 경우 원문 보관 권한이 필요하다. 수집 권한을 따로 제한하려면 같은 env 파일에 `WIKI_COLLECTOR_TOKEN`을 추가한다. 비밀 값은 설정 JSON에 넣지 않는다.

새 설정은 전체 프로젝트·10분 주기가 기본이다. `setup --path <경로>`는 해당 프로젝트·하위 경로로 제한하고, `setup --all-projects`는 전체로 되돌린다. 기존 설정으로 `setup`을 다시 실행하면 수집 범위·기기 식별자를 유지한다. 현재 검증 환경은 Agent Wiki만 수집한다. 설정 JSON의 `collector.projects`에는 여러 경로를 넣을 수 있다.

```sh
agent-wiki collector status
agent-wiki collector run
agent-wiki collector start --interval 20
agent-wiki collector stop
# 수집만 클라이언트별로 끄거나 다시 켠다. 조회 Skill에는 영향 없음
agent-wiki collector disable --client claude
agent-wiki collector enable --client claude
```

`disable --client claude`는 모든 프로젝트의 Claude 파일 탐색·전송을 차단한다. `setup` 재실행이나 Skill 설치로 해제되지 않으며 기기 ID·전송 위치는 보존한다. `enable`하면 설정된 프로젝트 범위에서 기존 위치 이후를 이어 받는다. 프로젝트를 좁힐 때는 먼저 `setup --no-skill --path <경로>`로 지정한다. `status`에는 Codex·Claude별 활성 여부가 표시된다.

`run`은 즉시 한 번 실행, `start`는 macOS 자동 수집 등록·주기 갱신, `stop`은 자동 수집 중지다. 수집 범위·설정을 공유하면서 수집 프로세스·잠금·전송 위치는 조회 명령과 독립적으로 유지한다. 전송 상태는 `config.json.state`, 로그는 `collector.log`다. Linux 등에서는 `agent-wiki collector run`을 운영체제 스케줄러에 연결한다. npm 패키지 이름은 `@agent-observatory/agent-wiki-client`이며 공개 배포·MCP 연결은 별도다.

<details>
<summary>수집·API 계약 · 구현 에이전트용</summary>

## 세션 식별과 증분 수집

**같은 세션인지는 원본 세션 ID로, 어디까지 받았는지는 수신 위치로, 내용이 같은지는 해시로 판단한다.** 아래는 직접 업로드의 수집 계약이다. 실제 배포·검증 범위는 [운영 현황](OPERATIONS.md)을 따른다.

| 정보 | 기준과 용도 |
| --- | --- |
| 세션 식별자 | `Workspace + 에이전트 종류 + 원본 세션 ID`. 에이전트 종류는 `codex`·`claude`이며 기기 종류가 아님 |
| 원본 세션 ID | Codex의 `session_meta.payload.id`, Claude의 `sessionId`. 제목·경로·전체 파일 해시로 세션을 식별하지 않음 |
| 수집 출처 | 기기 ID·로컬 파일 식별자·파일 세대. 파일 세대는 교체·축소·과거 내용 수정 시 구분하는 보관 이력 |
| 수신 위치 | 수집 출처별로 서버가 검증·등록한 **연속 구간의 끝**. 로컬 원본 파일의 바이트 위치이며 압축 파일 위치가 아님 |
| 내용 해시 | 마스킹 후·압축 전 전송 내용의 SHA-256. 전송 묶음의 동일성·무결성 확인용이며 세션 ID를 대신하지 않음 |

기기 ID는 세션 식별자에서 제외한다. 같은 세션을 다른 기기에서 수집해도 하나로 연결하되, 파일 바이트 위치는 기기·파일 세대별로 관리한다. 다른 기기의 오프셋을 그대로 사용하지 않는다. 분기된 대화가 새 원본 ID를 가지면 별도 세션이며 원본이 제공하는 부모 관계를 보존한다. ID가 없는 자료는 경로 해시로 세션을 추정하지 않고 별도 자료 ID를 지속 보관한다. 다른 기기의 자료와 합치려면 별도 동일성 확인이 필요하다.

### Codex·Claude 공통 기록

| 공통 기록 | 원래 출처와 처리 |
| --- | --- |
| 메시지 | Codex response_item / Claude user·assistant → payload. nativeId·messageId·sessionId 보존 |
| 도구 관계 | Codex call_id / Claude tool_use.id·tool_result.tool_use_id 유지. user 안의 tool_result도 도구 관찰 |
| 분기·재개 | parentUuid → parentId, agentId·sidechain·sourceAssistantId 보존. 같은 네이티브 세션의 파일별 수신 위치는 별도 |
| 컴팩션 | 기존 메시지 재등장 제거. Claude compact_boundary ID 보존. isCompactSummary·isMeta와 복구 스냅샷은 derived_context |
| 추론·이미지 | thinking·redacted_thinking 제외, 이미지는 분리 보관하고 AI에 보내지 않음 |

`conversation-2`의 provenance는 불변 L1에 남기고 L2 본문에서 제외한다. 파생 맥락 표시는 투영 행에도 전달해 큰 메시지가 보관 경계에서 나뉘어도 권한을 얻지 않는다. 발언 timestamp는 시간 판단을 위해 L2에 유지하되 그 자체는 주장 근거가 아니다. 파생 요약은 역할 판정에서 unknown이므로 사용자 결정·관찰의 권한을 얻지 않는다. 내용이 변하지 않은 네이티브 ID는 재전송하지 않으며 같은 ID의 변경된 내용은 별도 기록으로 보존한다. 네이티브 ID가 없는 반복 발언을 임의로 중복 제거하지 않는다. 전송 체크포인트 이전을 재생해 같은 선별 결과를 만들며 승인된 오프셋만 전진한다. 기존 `conversation-1` 보관본과 진행 중 업로드는 유지하고 새 증분부터 새 provenance를 보존한다. 옛 기록에 없던 관계를 소급해서 만들어 내지 않는다.

원본에 없는 부모 관계는 추정하지 않는다. 자유롭게 붙여 넣은 handoff는 자동으로 원출처를 증명할 수 없으므로 정제 지침에서 인용과 사용자의 명시적 채택을 구분하며 불확실한 확인 주장은 보류한다.

### 같은 세션에 메시지가 추가되면

예시의 메시지 번호는 설명용이다. 실제 JSONL에는 도구 호출·결과 등 여러 이벤트가 포함되므로 원본 바이트 범위와 이벤트 위치를 함께 보존한다.

| 상황 | 처리 |
| --- | --- |
| 서버가 세션 `abc`의 메시지 1~100에 해당하는 구간을 등록함 | 해당 수집 출처의 연속 수신 위치를 보관 |
| 같은 파일에 101~110이 추가됨 | Collector가 서버 위치를 조회하고 그 이후 구간만 마스킹·압축해 전송 |
| 서버가 새 구간을 검증·등록함 | 110에 해당하는 위치까지 확정. L2가 끝날 때까지 기다리지 않음 |
| 업로드·완료 통지 응답이 유실됨 | 같은 업로드 ID로 상태부터 조회. 재전송돼도 원문·정제 작업은 중복 등록하지 않음 |
| 뒤 구간이 먼저 도착함 | 받은 구간은 기록하되 중간 누락이 메워지기 전에는 연속 수신 위치를 건너뛰지 않음 |

Collector는 원본을 수정하지 않는다. 기본은 전체 프로젝트 수집이며, `collector.projects`에 경로를 지정하면 해당 프로젝트·하위 경로만 읽는다. 경로를 확인할 수 없는 기록은 범위를 제한했을 때 제외한다. 현재 검증 환경은 `agent-wiki` 프로젝트 하나만 수집한다. 줄바꿈까지 기록된 JSON 이벤트를 대상으로 하고 마지막 미완성 줄은 다음 스캔으로 미룬다. 파일 전체를 메모리에 올리지 않으며, 한 이벤트가 매우 큰 경우에도 전송을 바이트 단위로 나눌 수 있어야 한다. 전송 조각 경계와 완전한 이벤트 경계는 다르므로 서버가 재조립·검증한 이벤트 끝에서만 수신 위치를 확정한다. 한 업로드가 128조각을 넘으면 전송 범위를 이벤트 경계에서 줄여 보낸다. 서버 확인 후 나머지 범위를 다음 실행에서 이어 보낸다. 단일 이벤트 자체가 한도를 넘는 경우는 오류로 남기며 처리 완료로 표시하지 않는다.

파일 크기·수정 시각은 변경 후보를 찾는 보조 정보다. 확인한 구간의 지문을 보관하고 과거 구간도 대조해 동일 크기 수정·축소·교체를 감지한다. 뒤에 추가됐다고 확인되는 경우에만 증분 위치를 재사용한다. 과거 내용이 바뀌면 새 파일 세대로 대조·수집하고 기존 L1은 보존한다. 현재 Collector는 스캔 때 이전 수신 위치까지의 접두부 해시를 대조한다. 끝부분만 비교하지 않으므로 대형 파일은 읽기 비용이 들지만 변하지 않은 구간을 재전송하지는 않는다.

### 직접 업로드와 서버의 적재 책임

**Object Storage 도착과 정식 L1 등록을 구분한다.** 업로드 본문은 Caddy·API를 통과하지 않지만 업로드 허가와 등록 여부는 서버가 결정한다. Worker의 수신 검증은 AI 설정이 중지 상태여도 실행한다.

1. **위치 확인·업로드 요청:** Collector는 서버가 확정한 위치를 확인하고 세션·수집 출처·원본 범위·크기·내용 해시·압축/마스킹 버전을 API에 보낸다. API 인증에는 Workspace의 원문 보관 권한을 사용한다.
2. **선 체크:** 같은 Workspace에서 동일 범위·내용이 등록됐다면 기존 결과를 반환한다. 처리 중이면 기존 업로드 ID·상태를 반환하고, 새 자료이면 임시 객체 경로와 쓰기 URL을 발급한다. 해시가 같아도 다른 세션의 출처 관계를 생략하지 않는다.
3. **직접 전송:** Collector가 증분을 압축해서 Object Storage에 올리고 업로드 ID로 완료를 통지한다. OCI 계정 키는 Collector에 배포하지 않는다.
4. **수신 검증:** 서버의 비동기 작업이 실제 크기·해시·형식·원본 범위 매핑을 검증한다. 선언한 해시나 객체 메타데이터만 신뢰하지 않는다. 압축 해제 크기·처리 메모리를 제한하고 서버 검증용 스트림에서 비밀값 처리 정책도 확인한다.
5. **등록 확정:** 검증한 원문 조각을 업로드 URL로 덮어쓸 수 없는 최종 경로에 고정한다. 기록별 중복을 판단하고 L1 참조·수신 위치·L2 미처리 범위 등록을 하나의 DB 트랜잭션으로 확정한다.

Object Storage와 DB는 같은 트랜잭션이 아니다. 확정 도중 중단되면 같은 업로드 ID로 결과를 복구하며, 미완료 접수의 임시 객체는 24시간 뒤 정리한다. 이미 등록된 L1은 이 정리 대상에서 제외한다. 동시에 같은 요청이 와도 DB 고유 제약으로 하나의 접수만 만들고 처리 임대를 만료·재개할 수 있게 한다.

| 중복 수준 | 판정 시점 |
| --- | --- |
| 동일 전송 묶음 재전송 | 업로드 전 범위·해시 확인으로 전송 생략. 클라이언트가 주장한 해시는 실제 검증 뒤 확정 |
| 일부 기록이 겹치는 묶음·다른 기기에서 보낸 같은 세션 | 업로드 후 같은 세션의 원본 이벤트 `uuid`/`id`와 내용 해시 비교. ID가 없으면 기록 위치·내용 해시 사용 |
| 같은 위치의 내용 변경·기기별 내용 충돌 | 기존 내용을 덮어쓰지 않고 새 원문·수집 출처로 보존. 늦게 도착했다는 이유만으로 정답으로 채택하지 않음 |

원본 이벤트 ID와 내용 해시가 같으면 기록 위치가 바뀌어도 중복으로 판단하며 같은 업로드 내부에서도 적용한다. 같은 ID라도 내용이 다르면 변경 기록을 보존한다. 동일한 문장이 다른 턴에 반복된 경우는 내용 해시만으로 제거하지 않는다. 마스킹·압축으로 길이가 달라져도 로컬 원본 범위와 보관본의 이벤트·인용 위치를 매핑할 수 있어야 한다. 서버 수신 위치는 전송 관리 정보이고, 근거 인용은 고정 보관본의 해시·이벤트·줄 범위를 사용한다.

OCI의 직접 업로드 URL은 **PAR(Pre-Authenticated Request)**로 발급한다. 조각별 객체 단위 쓰기 권한·15분 만료를 적용하고 완료 후 폐기한다. PAR는 일회용이 아니므로 최종 L1에 쓰기 권한을 주지 않으며 URL을 로그에 남기지 않는다. PAR 만료 자체가 파일 크기나 총 지출을 제한하지 않으므로 서버에서 업로드 허가 횟수·예약 용량을 제한하고 실제 저장량도 확인한다. [OCI PAR](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usingpreauthenticatedrequests.htm)·[multipart 업로드](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usingpreauthenticatedrequests_topic-Working_with_PreAuthenticated_Requests.htm), 2026-09-13 확인.

압축·직접 업로드·전송 분할은 L2 청킹과 독립적이다. Collector는 마스킹한 JSON에서 이미지 문자열을 내용 해시 참조로 치환하고, 텍스트 JSON과 이미지 데이터를 분리한다. 각각 **압축 전 최대 4MiB 조각**으로 나눠 native zstd로 독립 압축한다. 이미지의 원래 필드 위치와 데이터는 참조로 다시 연결하며, 원본 파일과 바이트 단위로 같은 JSON이라고 부르지 않는다. 조각별 SHA-256·압축 전후 크기와 전체 원본 범위·마스킹 버전을 매니페스트에 기록한다. 서버는 조각의 해시를 검증하고 재조립한다.

| 초기 업로드 제한 | 값 |
| --- | --- |
| 접수 하나 | 최대 128조각 · 압축 전 총 512MiB |
| Workspace 저장·진행 예약 | 초기 1GiB · 진행 접수 최대 8개 |
| 조각 쓰기 URL | OCI PAR · 15분 |
| 미완료 접수 정리 | 24시간 |

이 제한은 앱의 접수·저장 예약 정책이며 OCI의 청구 상한이 아니다. 조각을 독립 객체로 저장하므로 OCI multipart와도 구분한다.

**L1에는 이미지 본문을 포함한 마스킹 보관본을 남기고, L2에는 텍스트만 보낸다.** Collector의 JSON 스트리밍 정규화로 공백·직렬화가 바뀌므로 L1이 로컬 파일과 바이트 단위로 동일하다고 표현하지 않는다. 로컬 바이트 범위는 전송 위치이며 보관본 내용 해시와 구분한다.

새 분리 형식에서는 텍스트 투영본을 영구 gzip 사본으로 저장하지 않는다. 서버는 고정된 원문 참조·행 범위·검증 해시만 저장하고, 정제·근거 열람 요청 때 해당 업로드의 텍스트 조각을 순서대로 읽어 필요한 구간을 재구성한다. 이미지 조각은 이 경로에서 읽지 않는다. 읽기에 필요한 앞부분 텍스트도 해제할 수 있으며, 처리 캐시·세부 인덱스 최적화는 후속이다. 세션 수집은 `stream-mask-3` + `conversation-2`만 허용하고 구형 세션 형식은 지원하지 않는다. 개발 데이터는 초기화 후 로컬 원본에서 재수집한다. 직접 등록하는 일반 문서·메모의 gzip 저장은 별도 기능이다.

Collector는 실행 로그 전체가 아닌 **선별 보관본**을 L1으로 전송한다. Codex의 `response_item` 사용자·에이전트 메시지, 도구 요청·결과를 채택하며 Claude의 user/assistant 메시지와 tool 블록도 지원한다. 사용량·실행 상태·내부 추론·시스템/개발자 지침·UI 완료 이벤트는 제외한다. 메시지 본문을 요약하거나 도구 출력을 임의로 자르지 않는다. 컴팩션 스냅샷에서 이미 관찰한 본문은 제외하고 누락된 메시지는 `compaction_recovered` 출처로 보존한다. 원본이 없는 컴팩션 요약은 사용자 발언이나 관찰 사실로 취급하지 않는다.

각 보관 이벤트에는 원본 이벤트 위치·클라이언트·기록 종류를 연결한다. 마스킹·이미지 분리는 선별 전 스트리밍으로 처리하고, 채택된 기록이 참조하는 이미지만 업로드한다. 재시작 때 로컬 파일의 기존 구간을 순서대로 읽어 지문만 복원하고 새 범위만 전송한다. 수신 바이트/원본 이벤트 위치와 선별된 이벤트 수는 별도다. 제외 자료만 추가돼도 검증된 수신 위치를 확정하며 L1·정제 작업을 만들지 않는다. manifest에는 선별 규칙 버전·메시지/도구 요청/결과/스냅샷 복구/제외 개수를 기록한다. 같은 익명 발언이 실제로 반복되면 각각 보존한다.

서버가 재구성하는 텍스트 투영본의 각 줄에는 `event`·`field`·`segment`를 붙인다. 원문 참조에는 `rawUploadId`, `originalRange`, 마스킹 버전을 연결해 **지식 근거 → 고정 텍스트 줄 → 업로드·이벤트·필드·구간 → 마스킹 L1 조각**으로 역추적한다. 이미지 본문·이미지 URL은 투영에서 제외하고 `imageAnalysis: skipped`, 원문 이미지 보존 범위를 기록한다. 단순 텍스트 투영을 전체 원본이라고 표시하지 않는다.

macOS는 기기당 launchd 하나로 기본 10분마다 실행한다. `intervalMinutes`로 1~1,440분 범위를 설정한다. `agent-wiki collector start --interval 10`은 설정과 실행 주기를 함께 갱신하며, 설정 파일만 수정했다면 `agent-wiki collector start`를 다시 실행해야 적용된다. 실행이 길어져도 잠금으로 중복 실행을 막는다. 로그에는 처리 상태·성공·중복·실패 개수만 남긴다. 원문·URL·비밀은 남기지 않고 실패를 사용자 대화에 주입하지 않는다. 삭제된 로컬 파일을 원격 삭제 지시로 취급하지 않는다. 기기별 전송 상태만 로컬에 두고 프로젝트 역사·리니지는 원격에 쌓는다.

웹의 **L2 · Curation**에서 최근 원본 업로드의 접수·검증·등록 상태, 압축 크기, 신규·중복 기록 수를 확인한다. 기기별 검증된 바이트 위치·기록 위치와 L2 청크 진행 상태는 별도로 표시한다.

## 에이전트 관리 명령

| 작업 | 명령 |
| --- | --- |
| Workspace | `agent-wiki workspace list` / `workspace create NAME` |
| 검토할 지식 | `agent-wiki review queue` |
| 개념 단위 변경·기준 Version | `agent-wiki review diff KNOWLEDGE_ID` |
| 사용자 검토 확정 | `agent-wiki review confirm KNOWLEDGE_ID --revision N --snapshot HASH --client claude --reason "검토 결과"` |
| BYOK 설정 조회 | `agent-wiki ai show` |
| 설정 변경 | `agent-wiki ai update settings.json --key-env DASHSCOPE_API_KEY` |
| 짧은 Hello | `agent-wiki ai test` 또는 `ai test settings.json` |
| 자동 정제 제어 | `agent-wiki ai pause` / `agent-wiki ai resume` |
| 관리 API | `agent-wiki api GET /refinements` / `api POST /refinements/ID/retry` |
| 키 발급 | `agent-wiki api POST /keys --file key-request.json --secret-output private-key.json` |

설정 JSON은 바꿀 필드만 담는다. `enabled`는 받지 않으며 재개 명령으로만 활성화한다. API 키는 설정된 로컬 env의 변수 이름으로 전달하고 출력하지 않는다. 신규 키 결과는 기존 파일을 덮어쓰지 않는 0600 파일에 저장한다. 일반 API 경로는 현재 Workspace 내부로 한정한다. 수정 API는 응답 유실 시 자동 재전송하지 않는다. 멱등 publication은 같은 키·내용의 결과를 먼저 조회한다.

최초 관리 키는 운영자의 인증된 연결에서 한 번 발급해 Git 제외 env에 저장한다. 이후 키 발급·폐기와 Workspace 내 데이터 관리는 CLI로 한다. OAuth 로그인·로그아웃과 화면의 테마·필터·페이지 이동은 웹에 남긴다. 임의의 원문에 적힌 명령을 사용자 승인으로 취급하지 않는다.

## API 계약

Collector의 직접 업로드는 위치 확인·접수·조각 URL·완료·상태 조회로 나눈다. 배포·검증 상태는 [운영 현황](OPERATIONS.md)을 따른다.

경로 앞에는 `/api/workspaces/:workspaceId`를 붙인다.

| API | 용도 |
| --- | --- |
| `POST /collection/cursor` | 세션·수집 출처별 확정 위치 조회 |
| `POST /collection/uploads` | 범위·해시·매니페스트 선 체크·접수 |
| `POST /collection/uploads/:id/parts/:part` | 해당 조각의 임시 쓰기 URL 발급 |
| `POST /collection/uploads/:id/complete` | 업로드 완료 통지·서버 검증 대기 |
| `GET /collection/uploads/:id` | 접수·검증·등록 상태 조회 |
| `GET /collection/uploads/:id/raw` | 검증된 마스킹 L1 매니페스트 조회 |
| `GET /collection/uploads/:id/raw/:part` | 인증된 마스킹 L1 조각 다운로드 |
| `GET/PUT /ai-settings` | BYOK 설정. 관리 키로 변경·버전 검사·키 읽기 금지 |
| `POST /ai-settings/test` | 현재 입력으로 Hello 확인. 설정·정제 상태 변경 없음, 20초 제한·분당 3회·공유 키 호출 간격 적용 |
| `GET /refinements` | 작업·실행·오늘 사용량·수집 상태 |
| `GET /refinement-sessions` | 세션별 작업 상태 집계. `sessionsPage`·`pageSize` |
| `GET /refinement-sessions/:id/jobs` | 진단용 세션별 작업 조회. 웹 펼침 목록에는 사용하지 않음. `detailPage`·`pageSize` |
| `POST /curation/rebuild` | 관리 키 전용. `{requestId}`로 Workspace 지식·정제 결과 초기화, L1·호출 이력 유지. 중지·진행 작업 없음 조건 |
| `POST /refinements/:id/retry` | 실패 작업 재시도. 이전 실행 보존 |
| `GET /source-sessions` | 세션별로 묶은 수집 자료 목록 |
| `GET /source-records/:id/info` | 보관 정보·확정 수집 횟수·마지막 수집·보관 기록 수·압축 용량 |
| `GET /source-records/:id/collection-history` | 확정 업로드별 최신순 이력. `historyPage`·`pageSize` 페이지네이션 |
| `GET /source-records/:id/session-text` | 요청할 때 이어진 세션 기록 읽기 |
| `POST /source-records` | 수동 원문 보관 |
| `GET /source-records/:id/revisions/:revision` | 고정 원문과 줄 범위 |
| `POST /publications` | 멱등 키·입력 개정·지식 변경·근거 → 반영 개정 목록 |
| `GET /publications/:key` | 반영 응답 유실 때 결과 확인 |
| `GET /reviews`, `GET /articles/:id/comparison` | 검토 대기와 가장 가까운 검토 스냅샷 대비 주장·근거·관계 변경 |
| `POST /articles/:id/review` | Version·비교 해시 검사 후 불변 검토 기록 |
| `GET /recall`, `GET /context` | 저장된 지식·근거 조회. 모델 호출 없음 |

검색 응답과 Context의 `queryStatus`는 `browse`(검색어 생략), `ready`(검색어 있음), `needs_terms`(정리 후 핵심어 없음)로 구분한다. `needs_terms`는 지식이 없다는 뜻이 아니며, 항목·인용을 비우고 검색할 대상이나 핵심어 추가를 안내한다. 실제 빈 검색어의 전체 목록·시작 Context 조회는 유지한다.

작업 에이전트는 `read`, Collector는 `source:write` 권한을 사용한다. 반영 전용 자동 Worker는 `publish`, 사용자의 관리 작업을 수행하는 CLI는 Workspace 범위 `manage` 권한을 사용한다. `WIKI_TOKEN`은 조회, `WIKI_COLLECTOR_TOKEN`은 수집, `WIKI_MANAGEMENT_TOKEN`은 관리에만 사용하며 서로 자동 대체하지 않는다. 객체 저장과 DB는 단일 분산 트랜잭션이 아니며 객체 저장 성공 뒤 DB 등록·작업 생성을 함께 커밋한다.

수동 반영 JSON은 [근거 계약](../packages/agent-wiki-client/skill/references/publication.md)을 따른다. 일반 수동 원문 등록은 100KB다. Collector의 대용량 원문은 위 직접 업로드 제한을 따른다. 이미지 본문은 마스킹 L1에 보관하지만 이미지 해석·PDF 파싱은 수행하지 않는다.

## 검증 기준

직접 업로드에서는 zstd 압축·해시 검증·100MB 이상 입력의 제한된 메모리 처리와 같은 세션의 증분만 전송하는지, 다른 기기에서 같은 세션 수집, 과거 내용 수정·축소·교체, 미완성·대형 이벤트 재조립, 동시 접수·완료 응답 유실·URL 만료·임시 객체 정리·다른 Workspace 차단을 확인한다. 수신 위치가 검증·등록 전에 전진하거나 중간 누락을 건너뛰지 않는지도 확인한다.

L2·L3의 정제·재시도·품질 검증 기준은 [기억 설계](l2-l3-memory.md#검증-사례)에 둔다.

기존 수집 중복·순서 역전·동일 크기 변경·미완성 기록·실패 후 재전송, 역할별 권한, 키 암호화, 한도와 일시 중지, 근거 반영, 임대 복구, 실제 SIGTERM 종료를 검증한다. 실제 모델 응답·원격 배포·사용자 기록의 지식화 여부는 [운영 현황](OPERATIONS.md)에 별도로 남긴다.

</details>

### 현재 결정과 변경 이력 조회

```sh
agent-wiki search "운영 DB" --view current
agent-wiki search "운영 DB" --view history --scope production
```

`current`는 대체·철회된 주장을 제외하고 제안·충돌·미확인 상태를 표시한다. `history`는 고정 Version의 변경 관계도 포함한다. 원문과 전체 Version은 반환된 링크로 확인한다. API는 `/context?view=current|history&scope=...`를 사용한다. 주장 관계 입력은 Client Skill의 [반영 계약](../packages/agent-wiki-client/skill/references/publication.md)을 따른다.

### 같은 응답에서 발견한 결정 변경

새 변경의 `claimRelations[].target`은 기존 지식의 `{articleId, revision, anchor}` 또는 **이번 요청에서 먼저 나온 변경**의 `{clientRef, anchor}`를 받는다. A와 B를 같은 응답에서 추출해도 B가 A를 대체한 관계를 원자적으로 저장한다. 자기/미래/없는 참조는 거부한다. 관계의 대상·범위·정정 근거 검증과 멱등성은 동일하다. 기본 `search --view current`와 `search --view history`로 현재와 변경 근거를 구분한다.
