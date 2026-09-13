# Agent Wiki 디자인 규칙

[문서 안내](README.md) · [아키텍처](architecture.md)

**데스크톱 웹 전용이며 모바일 대응·검증은 범위에 두지 않는다.**

**웹 UI의 기본은 shadcn/ui다. 공식 컴포넌트·블록·테마를 먼저 사용하고 Wiki에 필요한 부분만 조합한다.** 에이전트의 근거 조회가 주 용례이며 웹은 지식·원문·검토 결과·진행 상태를 읽는 뷰어다. 변경은 CLI에서 수행한다.

2026-09-12 공식 [저장소](https://github.com/shadcn-ui/ui)·[소개](https://ui.shadcn.com/docs)·[컴포넌트](https://ui.shadcn.com/docs/components)·[테마](https://ui.shadcn.com/docs/theming)를 확인해 기본 기준으로 선택했다. 공식 shadcn CLI 4.21.0으로 생성한 Neutral·Radix 계열 컴포넌트를 사용한다. Tailwind 4 의미 토큰과 아이콘 전용 다크/라이트 토글을 적용했다. 컴포넌트 소스는 `apps/agent-wiki-web/components/ui`에 있으며 원본은 MIT 라이선스다. 운영 배포 상태는 `OPERATIONS.md`를 따른다.

## 기본 선택

| 항목 | 기준 |
| --- | --- |
| 컴포넌트 | shadcn/ui 공식 소스와 공식 Blocks 우선. 필요한 것만 가져옴 |
| 기반 | Next.js + Tailwind CSS + shadcn의 Radix 계열로 통일 |
| 색상 | Neutral 기본 테마. 중성 검정·회색 / 흰색·회색 |
| 모드 | 다크 기본, 라이트/다크 2상태 토글. 브라우저에 저장, 시스템 자동 전환 없음 |
| 아이콘 | 공식 예제에서 사용하는 Lucide. 16px·20px 중심, 기능별 같은 아이콘 재사용 |
| 글꼴 | 한국어 Noto Sans KR, 코드·ID는 시스템 고정폭 |
| 형태 | 공식 컴포넌트의 variant·size·간격·radius 우선 |
| 화면 | 문서 중심의 평면 구성. Sidebar + 문서 목록 + 본문 |

shadcn/ui는 수정 가능한 컴포넌트 소스를 프로젝트에 가져와 사용하는 방식이다. 우리 공통 컴포넌트를 그 소스로 구성하고 화면마다 별도 버튼·입력·메뉴 스타일을 만들지 않는다. [공식 설명](https://ui.shadcn.com/docs)

기본 UI는 이 범위로 충분하다. 외부 UI 키트·장식용 이미지·유료 템플릿을 추가하지 않는다. 도메인 기능은 공식 컴포넌트를 조합한다. 초기 편집은 Markdown Textarea와 미리보기로 시작하고, 리니지는 원문·주장·개정 목록과 상세 보기로 표현한다. 고급 편집기·노드 그래프는 실제 필요가 확인되면 별도 판단한다.

OpenGateway는 중성 표면·문서 밀도를 참고했던 이전 레퍼런스로 남긴다. 세부 컴포넌트 모양은 shadcn 기본을 우선한다. 이전의 고정 HEX 표, 모든 주 행동을 파란 테두리로 만드는 규칙, 개별 버튼·메뉴 CSS는 새 구현의 제약으로 삼지 않는다.

## 화면별 조합

사이드바는 **L3 · Knowledge → L1–L2 · Sources → 설정** 세 항목이다. Knowledge의 탭은 지식 목록·반영 이력, Sources의 탭은 Raw Sources·Curation·수집 상태다. Sources의 수집·반영 요약은 공통이며 모델 호출·정제 진단은 Curation 탭에만 둔다. 별도 Audit·Curation 메뉴는 두지 않는다. 탭 변경은 해당 목록의 첫 페이지로 이동하며 탭·페이지·검색은 URL로 표현해 뒤로 가기로 복원한다.

| 화면·기능 | 사용할 기본 구성 |
| --- | --- |
| 전체 탐색 | Sidebar·Breadcrumb·Separator, 좁은 화면은 Sheet |
| Workspace·문서 종류·권한 | Select. 검색이 필요하면 Combobox |
| 다중 태그 | Combobox의 검색·선택과 Badge 조합, 복수 선택 상태 표시 |
| 키워드 검색 | Input + 검색 결과 목록, 빠른 찾기는 Command + Dialog |
| 문서·원문 목록 | Item 또는 Table·Badge·DropdownMenu, 행을 눌러 상세 열기 |
| 본문·리니지 | Typography·Separator·Tabs, 근거 구간은 Sheet 또는 본문 상세 |
| 검토 결과 | Badge·Version 선택·주장과 근거 비교 |
| 설정 | 읽기 전용 필드 요약 |
| 변경·삭제 | CLI에서 명시적 범위와 Version을 전달 |
| 빈 상태·로딩·실패 | Empty·Skeleton·Alert, 짧은 완료 피드백은 Toast |
| 테마·복사 등 보조 행동 | 아이콘 Button + Tooltip + 접근성 이름 |

공식 [컴포넌트 목록](https://ui.shadcn.com/docs/components)의 구성을 우선 사용한다. [Radix Select](https://ui.shadcn.com/docs/components/radix/select)처럼 같은 기반의 예제를 선택하고 Base UI·React Aria 계열 코드를 한 컴포넌트에 섞지 않는다.

복사·편집·삭제 버튼을 모든 행에 나열하지 않는다. 문서는 클릭해 열고 부가 행동은 DropdownMenu에 둔다. 본문 전체를 Card로 감싸거나 카드 안에 카드를 반복하지 않는다. 관리자 대시보드 블록의 매출·가입·통계 UI를 개인 Wiki에 그대로 가져오지 않는다.

설정 메뉴에는 **AI 연결 · Client 연결**을 둔다. Curation에는 AI 설정 탭을 두지 않는다.

AI 설정은 **BYOK 단일 연결의 읽기 전용 요약**이다. API 키 원문은 표시하지 않는다. 설정·Hello 테스트·자동 정제 재개는 별도 CLI 명령이다. Free 선택기·저장 폼·웹의 테스트·재개 버튼은 두지 않는다.

AI 연결 요약에는 `model`, `maxInputTokens`, 출력 한도 한 개(`max_tokens` 또는 `max_completion_tokens`), 추론 설정, `requestsPerMinute`, `concurrency`를 표시한다. 추론이 꺼졌거나 설정되지 않은 부가 값·일일 제한은 생략한다. 주소·키 원문·내부 문자 제한·Version·중복 출력 한도·CLI 안내는 표시하지 않는다. 제공자 파라미터는 영문 필드명을 유지하고 Wiki 자체 제한과 구분한다. 호출 이력은 입력/출력과 그 안에 포함된 캐시/추론 토큰을 구분하며 당시 추론 설정을 함께 보여준다.

## 테마 토큰

공식 CSS 변수와 `.dark` 테마 방식을 따른다. HEX 값을 컴포넌트마다 직접 넣지 않는다. 기본 테마의 표면·글자 쌍을 함께 사용한다. [공식 테마 규칙](https://ui.shadcn.com/docs/theming)

| 용도 | 토큰 |
| --- | --- |
| 페이지 | `background` / `foreground` |
| Card·Popover | `card` / `card-foreground`, `popover` / `popover-foreground` |
| 주 행동 | `primary` / `primary-foreground` |
| 보조 행동 | `secondary` / `secondary-foreground` |
| 보조 설명 | `muted-foreground` |
| 선택·호버 | `accent` / `accent-foreground` |
| 경계·입력·포커스 | `border`, `input`, `ring` |
| 삭제·오류 | `destructive` |

`accent`는 선택·호버 표면이며 기존 앱의 파란 링크 색과 의미가 다르다. 기존 `--accent` 값을 이름만 그대로 옮기지 않는다. 파란 링크가 필요하면 별도 `link` 토큰으로 제한하고 기본 표면을 남색·청록색으로 바꾸지 않는다. 사용자 결정·관찰·AI 해석·미확인 상태는 Badge의 문구로 구분한다.

Button은 공식 `default`·`secondary`·`outline`·`ghost`·`destructive` variant를 역할에 맞춰 사용한다. 토글은 Sun/Moon 아이콘만 보이고 한글 모드 설명을 붙이지 않는다. 접근성 이름은 유지한다. 색상만으로 선택·실패·확인 상태를 전달하지 않는다.

## 밀도·접근성

- 사용자 화면은 세션 중심이다. L1은 기록 수·마지막 수집, L2는 상태·고정된 이번 처리 진행률·새 기록 대기·마지막 반영을 표시한다. 조각·청크 개수는 기본 화면에서 숨긴다. 새 증분이 기존 진행률을 낮추지 않으며, 새 수집분이 남아 있으면 최신 반영 완료로 표시하지 않는다.

- 반영 이력은 평면 목록과 가로 문서 링크로 묶고, 원문 목록은 데스크톱에서 이름과 메타데이터를 한 줄로 표시한다. 짧은 날짜에는 연도·월·일·24시간 시각을 표시하고 전체 시각을 title에 보존한다.

- 호출 이력은 상태 배지·모델·실행 지표·시각을 한 줄 중심으로 표시한다. 공통 StatusBadge로 성공·완료는 초록, 실패는 빨강, 진행 중은 파랑, 중단은 주황으로 표시하고 문구를 함께 둔다. 세션·업로드·일별 이력에도 같은 색상을 쓴다. 오류·당시 재시도 정보만 다음 줄에 묶는다.

- 본문은 14–16px, 읽기 폭은 720–800px에서 실제 한국어 문서로 확인한다. 제목은 24–28px 정도로 억제한다.
- 간격은 4px 단위, 기본 구간은 16·24px로 통일한다. 컴포넌트의 기본 크기를 우선하고 픽셀 단위 개별 예외를 반복하지 않는다.
- 공식 키보드 동작·focus·disabled 상태를 유지한다. 메뉴와 대화상자의 Escape·포커스 복귀를 확인한다.
- 아이콘만 있는 버튼에는 접근성 이름을 제공한다. Tooltip을 유일한 이름으로 사용하지 않는다.
- 주요 글자 대비 4.5:1, 다크·라이트 데스크톱 화면의 잘림·가로 넘침을 실제로 확인한다.
- 데이터 없음·검색 결과 없음·요청 실패·권한 없음은 구분한다. 빈 곳에 가짜 지식이나 통계를 넣지 않는다.
- 개정 충돌·근거 삭제·저장 실패는 해당 내용 옆에 표시한다. 에이전트 업로드를 사용자 확인 완료로 표시하지 않는다.
- 로그인 후 첫 Workspace의 Knowledge로 바로 들어가며 중간 선택 화면을 두지 않는다. 다른 Workspace는 사이드바 선택 메뉴로 바꾼다.
- Workspace 전환 시 이전 공간의 입력·자료·Context를 남기지 않는다. 소유자 GitHub 로그인만 제공하고 가입 유도는 두지 않는다.

## 구현할 때

`apps/agent-wiki-web`에 Tailwind·shadcn 설정과 공통 `components/ui`를 구성하고 공식 소스에서 필요한 컴포넌트만 추가한다. 선택한 설정은 `components.json`, 실제 버전은 lockfile에 남긴다. 기본 컴포넌트 변경은 공통 소스에서 처리하고 기존 CSS를 통째로 덮어씌우지 않는다. 소스의 라이선스 고지를 보존한다.

새 API·근거 화면 구현과 함께 기존 직접 스타일링한 버튼·Select·메뉴·대화상자를 교체한다. 소유자 로그인·아이콘 토글·다중 태그·원문 구간·개정 확인 흐름은 유지한다. 설치·빌드 성공과 실제 화면 전환·배포 검증을 구분한다. [Next.js 공식 설치 안내](https://ui.shadcn.com/docs/installation/next)

## 용어 일관성

계층 이름은 **L1 · Raw Sources → L2 · Curation → L3 · Knowledge → L4 · Query → L5 · Answers**로 통일한다. 개별 계층 표기에는 같은 이름을 사용한다. 통합 Sources 메뉴 이름은 `section-names.json`을 웹과 그림 생성기에서 공유한다. 설명 문장의 수집·정제·지식 같은 일반 명사는 한국어로 쓸 수 있다. 제품명 Agent Wiki와 외부 레퍼런스의 LLM Wiki는 바꾸지 않는다.

웹과 그림 생성기는 `apps/agent-wiki-web/lib/layer-names.json`을 공통 이름 정의로 사용한다. 이름을 바꿀 때는 이 파일과 아키텍처의 계층 표를 함께 갱신한다. 문서 안의 과거 검증 기록과 보존용 설계는 당시 이름을 유지한다.

## 문서 그림 공통 기준

- 웹 개정 배지는 `Version 1`로 쓰며 `r1` 같은 약어를 노출하지 않는다.
- 예시 식별자는 원문 A·지식 A처럼 대상을 드러내고, 개정·행 번호·정제 기록은 약자나 기호 조합 대신 풀어 쓴다.
- SVG는 편집 가능한 text/tspan을 유지하고 고정 굵기 Noto Sans KR Regular(400)·Bold(700)를 사용한다.
- 글자 크기는 생성기의 `FONT` 상수로 통일한다. 그림 제목 34px, 그룹 제목 24px, 컴포넌트 제목 20px, 본문 18px, 범례·배지·연결선 라벨 16px, L1–L5 계층 번호 32px다. 제목은 700, 본문은 400이다.
- 이름 접두사·문자 길이에 따라 글자를 줄이지 않는다. 긴 제목은 상자 폭·배치·문구를 조정한다. 컴포넌트의 아이콘과 본문 위치도 공통 `card` 함수를 따른다.
- 계층 배지는 해당 컴포넌트의 오른쪽 상단에 붙인다. 아래쪽이나 상위 설치 그룹에 따로 두지 않는다.
- 설치 패키지 그룹 안에 CLI·Collector를 개별 카드로 배치한다. client와 내부 구성을 같은 수준의 앱으로 나열하지 않는다. 설치된 조회 Skill은 작업 에이전트 안에 둔다.
- 흰 캔버스·파스텔 컴포넌트·남색 글자·직교 연결선을 사용한다. 제품 UI의 다크 테마와 문서 그림 캔버스는 구분한다.
- 리전은 `Osaka · ap-osaka-1`처럼 영문으로 적고 예약 작업 제목에 주기 배지를 표시한다. 구현 상태·선택 이유·확인 날짜는 본문에 둔다.
- 아이콘 출처는 Tech Stack Icons → techicons.dev → Simple Icons 순서다. 일반 기능 기호는 Tabler를 사용한다. [출처와 라이선스](assets/icons/SOURCES.md)를 보존하며 SVG 내부에 벡터로 포함한다.
- 수정은 생성기에도 반영하고 재생성 결과를 확인한다. XML 검사와 실제 렌더링의 누락·겹침·잘림 검사를 구분한다. Codex 오른쪽 미리보기는 자동으로 열지 않는다.

## Wiki 그림

그림은 작업 에이전트와 별도 Collector·백그라운드 정제를 분리한 **목표**를 설명한다. 그림에는 미구현·구현 완료 같은 진행 상태를 붙이지 않는다. 구현 여부는 대화와 운영 현황으로 전달한다. 실제 전환 여부는 `docs/OPERATIONS.md`를 따른다. 과거 정제 설계의 그림은 `docs/archive/server-ingest/`에 보존했다.

- `wiki-layers.svg`: L1은 아래, L5는 위. 계층별 실행 주체와 같은 합성 입력·출력 예시를 나란히 둔다. L1은 서버가 검증·등록한 원문, L2는 텍스트 청킹 → 주장·근거 추출 → 비교·검증, L5는 작업 에이전트 답변이다. Memory·Article·Glossary는 지식 유형이며 직렬 생성 단계가 아니다.
- `wiki-deployment.svg`: 사용자 기기의 작업 에이전트와 단일 설치 패키지를 구분한다. 로컬 배포 묶음은 `agent-wiki-client`, 실행 구성은 `agent-wiki-cli`·`agent-wiki-collector`로 표시한다. 배포도는 실행 시 위치를 보여주므로 설치된 조회 Skill은 Codex·Claude Code 안에 둔다. Skill 원본의 패키지 포함·복사 과정은 설치 안내에만 설명한다. 모든 자체 운영 앱·저장소는 아키텍처의 고유 이름을 제목에 쓴다. `agent-wiki-gateway`·`agent-wiki-web`·`agent-wiki-api`·`agent-wiki-worker`·`agent-wiki-db`가 기본이며 Traefik·Next.js·Fastify·PostgreSQL은 본문과 아이콘으로 구분한다. 같은 프레임워크를 쓰는 앱이 추가되어도 고유 이름으로 구분한다. L2 정제는 원격 VM 내부 Worker, 외부 AI API는 VM 밖에 표시한다. 원격 VM의 K3s와 앱 Pod, 원문 저장소, 연결 볼륨과 DNS·인증서 발급·갱신을 표시한다. 호스트 로그 상자는 전체 배포도에서 생략한다. 전체 배포도 컴포넌트에 L1 · Raw Sources부터 L5 · Answers까지 계층 라벨을 붙인다.
- `wiki-lineage.svg`: L1 불변 원문 → L2 정제 기록 → L3 지식 Version과 L4 검색어 준비·후보 정렬·유효성 확인·Context 반환을 한 그림으로 연결한다. L5 에이전트의 조회·근거 활용은 아래에 두고, 새 정제 완료를 기다리는 순서로 표현하지 않는다. 원문 근거 참조와 검색 흐름은 별도 색으로 구분한다.
- `wiki-decision-history.svg`는 L2의 변경 의도 판단, L3의 과거·현재 주장 보존, L4의 현재 결정·변경 이유·충돌 조회를 계층별로 보여준다. 현재 채택과 사실 검증, 발언·실제 적용·수집 시각을 구분한다.
- `wiki-curation.svg`·`wiki-decision-history.svg`·`wiki-curation-evaluation.svg`·`wiki-curation-rebuild.svg`: 새 증분·세션 맥락·관련 지식의 입력, 원자적 반영, 근거 있는 주장 대체, 청킹/리랭킹 비교 실험, L1을 보존하는 재생성을 각각 한 그림으로 설명한다. 처리 단계는 논리 역할이며 별도 배포 앱으로 오인시키지 않는다. 상위 설명은 짧게 두고 구현 규칙은 L2·L3 기억 설계 문서의 접힌 영역에 둔다.
- `wiki-operations.svg`: 기존 인프라·배포·비용/오류 알림과 별도 수집 경로를 보여준다. 수집 → 원격 원문 보관 → 별도 정제를 사용자 작업 절차처럼 표현하지 않는다. 앱은 로그만 남긴다. 오류는 OCI Logging → Connector Hub → Monitoring 경보 → Notifications → Slack, 비용·사용량은 GitHub Actions → Slack으로 구분한다.

그룹은 중성 회색 `#F1F2F4`와 진한 테두리 `#596679`, 제목 띠는 `#344256`·흰 글씨로 구분한다. 컴포넌트는 조회/API 파랑 `#DBEAFE`, Collector·백그라운드 정제 살구 `#FDE7C2`, 데이터 민트 `#D4EDE4`, 근거 연보라 `#EBDFFA`, 운영 회색 `#E3E7ED`, 웹 흰색을 사용한다.

화살표는 원문·지식 반영 `#B35C00`, 조회·응답 `#245CC5`, 인증·운영 `#68778B`, 근거 참조 `#8054A3`로 구분한다. 범례는 제목 옆에 둔다. 반복하는 회색 부제는 넣지 않는다. 요청·응답은 양방향, 저장·반영은 단방향이며 긴 왕복 경로 대신 나란한 직교선을 쓴다.

컴포넌트 간에는 최소 32px, 그룹 경계 안쪽에는 최소 32px 여백을 둔다. 카드 높이는 내용에 맞추고 그룹 제목과 내용을 분리한다. Traefik → API → PostgreSQL은 같은 높이의 직선, Web → API는 세로선으로 둔다. 볼륨과 원문 저장소는 연결선이 다른 컴포넌트를 관통하지 않는 위치에 배치한다. K3s 상태와 PostgreSQL 데이터는 같은 연결 볼륨의 별도 경로임을 표시한다. DuckDNS 도메인은 웹에 표시하고 VM IP로 연결됨을 명시한다. DNS·인증서 발급 기관을 HTTP 요청이 통과하는 중계 서버처럼 그리지 않는다. 작업 에이전트의 조회와 Collector의 수집 선을 분리한다. Collector → Traefik/API는 위치 확인·업로드 허가·완료 통지, Collector → Object Storage는 압축 증분 본문의 직접 전송으로 구분한다.

현재 그림은 `python3 scripts/generate-wiki-diagrams.py`로 함께 재생성한다. XML·상대 링크·재생성 일치와 실제 렌더링의 글자·겹침·잘림을 각각 확인한다. Codex 오른쪽 미리보기는 자동으로 열지 않는다.
