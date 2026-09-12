# Agent Wiki 디자인 규칙

[문서 안내](README.md) · [아키텍처](wiki/architecture.md)

에이전트 질답·작업에 필요한 근거 조회가 주 용례다. 웹은 지식을 편집·정정하고 출처를 확인하는 보조 화면이다. 현재는 문서·그림 설계 단계다. 아래 UI 방향은 구현 기준 초안이며 검증된 앱 화면을 뜻하지 않는다.

## 기존 제품에서 가져온 범위

| 구분 | 처리 |
| --- | --- |
| 공통 정보 표현 | 타이포·간격·의미별 상태색·키보드 접근성·근거와 상태 구분을 참고 |
| Wiki 설계 그림 | 계층도·배포도·운영도와 생성기 규칙을 유지 |
| Sessions 전용 규칙 | 세션 목록·분석 결과·개선 작업·Collector 운영 화면은 제외 |
| 포털 전용 규칙 | Wiki/Sessions 전역 탐색·기존 URL·루트 리다이렉트·기존 컴포넌트 경로는 제외 |
| 기존 화면 검증 | Atlas 스크린샷·Overview 순환도·CI 검증 결과는 새 제품의 증거로 가져오지 않음 |

기존 `docs/DESIGN.md`의 공통·Wiki 기준을 독립 제품에 맞게 정리했다. 기존 색상 토큰은 출발점이며 웹 편집기와 최종 화면 구성은 아직 확정하지 않았다.

## 웹 Wiki의 시각 방향

- Article 본문·목차·문서 연결을 중심에 둔다. Workspace 선택과 Folder·Tag 분류를 구분하고 현재 Workspace를 명확히 보인다.
- 사용자가 원천 자료·Memory·Article 개정·근거로 이동할 수 있어야 한다. 그래프는 관련 문서를 탐색하는 보조 화면이다.
- 한국어 우선으로 설계하고 언어·라이트/다크/시스템 테마 선택은 설정에 둔다. 다크 기본은 기존 공통 방향을 참고한 초안이다.
- Noto Sans KR을 기본 글꼴로 사용하고 코드·객체 ID는 시스템 고정폭으로 표시한다. 읽는 본문은 720px 안팎을 출발점으로 실측한다.
- 어두운 잉크 캔버스와 청색 계열 표면을 사용하고 라이트 테마는 밝은 공통 토큰으로 전환한다. 색은 역할을 전달하는 데 사용한다.
- 패널은 8–10px 반경과 1px 경계선을 기본으로 한다. 문서 절을 모두 카드로 감싸지 않고 제목·구분선·여백으로 구분한다.
- 주 행동은 한 구역에 하나의 파란 채움 버튼으로, 보조 행동은 테두리 버튼으로 표현한다. 화면을 변경할 때 관련 토큰과 이 문서도 함께 갱신한다.

## 색상 역할

| 역할    | 다크      | 라이트    | 사용처                       |
| ------- | --------- | --------- | ---------------------------- |
| Canvas  | `#090B12` | `#F4F7FB` | 페이지 배경                  |
| Surface | `#111521` | `#FFFFFF` | 패널과 사이드바              |
| Raised  | `#181E2D` | `#E9F0F8` | 입력과 선택 가능한 보조 표면 |
| Cobalt  | `#6699FF` | `#2563EB` | 주 행동, 링크, 진행 중       |
| Teal    | `#39C6B3` | `#087F76` | 브랜드, 탐색 선택, 성공 계열 |
| Violet  | `#A78BFA` | `#6D4BD1` | AI 발견 사항과 근거 연결     |
| Amber   | `#F0B95B` | `#A15C08` | 개선 후보                    |
| Rose    | `#FB7185` | `#C42F45` | 실패와 삭제                  |

색상만으로 상태를 전달하지 않는다. 상태점에는 텍스트를 붙이고, 선택 행에는 색면과 왼쪽 선을 함께 쓴다.

## 타이포그래피와 간격

| 요소              |      크기 |    굵기 |
| ----------------- | --------: | ------: |
| 페이지 제목       |      28px |     700 |
| 섹션 제목         | 14px 이상 |     600 |
| 본문과 버튼       |      14px | 400–600 |
| 캡션과 메타데이터 | 12px 이상 | 400–600 |
| 코드              |   12–14px |     400 |

기본 간격 단위는 4px이다. 조밀한 목록은 8–12px, 패널 내부는 16–24px, 페이지 구간은 24–32px을 사용한다. 설명을 추가해 밀도를 낮추기보다 레이블과 열 정렬을 명확하게 한다.

## 상태·근거·접근성

- 사용자 결정·AI 해석·미확인 상태를 문구로 구분한다. 출처가 없거나 삭제됐다면 근거 누락을 표시하고 해시만으로 진위를 보장하지 않는다.
- Article의 현재 개정과 편집 충돌을 구분하고 저장 중·완료·실패를 명확히 알린다. 데이터가 없을 때 결과를 추정해 채우지 않는다.
- 검색·목록 상태와 문서 주소는 직접 접근·새로고침·뒤로 가기에서도 유지하는 방향으로 설계한다. 구체적인 URL은 구현 전에 정한다.
- hover·focus·selected·disabled를 정의한다. 키보드 focus는 2px cobalt 외곽선을 사용하고 상태를 색상만으로 전달하지 않는다.
- 본문·캡션·버튼 텍스트의 대비는 4.5:1 이상, 캡션은 12px 이상으로 한다. 다크·라이트와 720px 이하 화면에서 실제 길이의 합성 자료로 확인한다.
- 대화상자는 Escape·닫기와 원래 위치로의 focus 복귀를 지원한다. 명령·Context 복사는 성공·실패를 알려야 한다.
- Workspace 전환 시 이전 공간의 자료·입력·AI 맥락을 새 공간에 이어 보내지 않는다.

## 문서 그림 공통 기준

- SVG는 편집 가능한 text/tspan을 유지하고 고정 굵기 Noto Sans KR Regular(400)·Bold(700)를 사용한다.
- 흰 캔버스·파스텔 컴포넌트·남색 글자·직교 연결선을 사용한다. 제품 UI의 다크 테마와 문서 그림 캔버스는 구분한다.
- 리전은 `Osaka · ap-osaka-1`처럼 영문으로 적고 예약 작업 제목에 주기 배지를 표시한다. 구현 상태·선택 이유·확인 날짜는 본문에 둔다.
- 아이콘 출처는 Tech Stack Icons → techicons.dev → Simple Icons 순서다. 일반 기능 기호는 Tabler를 사용한다. [출처와 라이선스](assets/icons/SOURCES.md)를 보존하며 SVG 내부에 벡터로 포함한다.
- 수정은 생성기에도 반영하고 재생성 결과를 확인한다. XML 검사와 실제 렌더링의 누락·겹침·잘림 검사를 구분한다. Codex 오른쪽 미리보기는 자동으로 열지 않는다.

## Wiki 계층도

[wiki-layers.svg](assets/wiki-layers.svg)는 지식 아키텍처의 L1–L5 책임과 워크스페이스 경계를 설명한다. 문서의 개념도이며 제품 화면이나 배포 구성도가 아니다.

2026-09-12 getdesign.md의 [IBM 분석](https://getdesign.md/ibm/design-md)과 [Together AI 분석](https://getdesign.md/together.ai/design-md), 각 분석의 [IBM 원문](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ibm/DESIGN.md)·[Together AI 원문](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/together.ai/DESIGN.md)을 참고했다. 브랜드 복제 대신 격자 정렬·얇은 경계선·타이포 위계를 적용한다.

- 계층 번호·역할은 왼쪽에, 해당 계층의 실제 내용 예시는 같은 행 오른쪽에 둔다. 세션 원문 → 추출 JSON → 위키 Markdown·연결 그래프 → AI 맥락 → 응답을 하나의 합성 사례로 이어 보여준다. 샘플을 별도 문서로 보내지 않는다.
- L1 Raw sources가 맨 아래다. 이름은 Raw sources → Ingest → Wiki → Query → Answers로 통일한다. 계층 번호·이름·책임을 세 열로 정렬한다. Ingest는 추출·검증·위키 반영, Wiki는 누적 지식, Query는 질의·맥락 구성을 맡는다. 기준은 `docs/wiki/architecture.md`의 공통 용어 표다.
- 흰 캔버스·남색 글자·파스텔 표면을 유지한다. 번호 영역에는 진한 역할색을 사용하며, 큰 둥근 카드와 입체 그림자를 반복하지 않는다.
- L1 slate, L2 amber, L3 teal, L4 cobalt, L5 blue로 구분하며 번호와 이름도 함께 표시한다. 워크스페이스 범위는 그림 상단에 표시하고 다른 공간과의 데이터·맥락 분리를 명시한다.
- 한글은 고정 굵기 Noto Sans KR Regular·Bold를 유지한다. 코드 예제의 고정폭 서체는 필요할 때 검토한다. 제목 37–40px, 계층 이름 28–29px, 본문 18–21px을 출발점으로 하며 실제 렌더링의 읽기 크기와 정렬을 확인한다.
- SVG의 텍스트는 편집 가능하게 유지한다. 렌더링 후 글자 잘림·겹침과 연결 방향을 확인한다.

- L3는 Memory(짧은 주장·결정)·Article(읽는 문서)·Glossary·Glossary Term(용어집·용어)를 분리하고 같은 합성 예제를 유지한다. 기본 문서 링크와 의미가 붙은 관계를 구분한다.
- Data Lineage는 모든 계층을 가로지르는 오른쪽 영역에, Data Governance와 Workspace 경계는 상단에 둔다. `source → ingest run → memory → article revision → context`의 ID가 본문 예제와 일치해야 한다.
- 용어를 장식으로 추가하지 않는다. Data Lineage는 파생 관계, Log는 시간순 작업 이력이다. Schema·Lint는 공통 규칙·점검으로 표시한다. Semantics를 별도 지식 객체명으로 쓰지 않는다. L1–L5 번호·Workspace 격리·관계 속성은 우리 제품 설계이며 외부 표준 준수로 표현하지 않는다.

- L5는 에이전트의 근거 활용을 먼저, 웹 편집·검토를 보조로 배치한다. 답변 주체는 사용자가 이미 쓰는 에이전트다.

- L4에는 키워드·별칭 조회, 제목·태그 우선 정렬, 연결된 근거로 Context를 구성하는 예제를 둔다. Folder·Tag 필터와 Workspace 경계를 표시한다. 임베딩 후보 설명은 본문에 두고 현재 계층도에는 벡터 검색을 넣지 않는다.

## Wiki 배포·운영 그림

- 화살표는 수집·지식 반영 `#B35C00`, 조회·응답 `#245CC5`, 인증·운영 연결 `#68778B`, 근거·계보 관계 `#8054A3`로 구분한다. 그림에 범례와 목적 레이블을 두고 공유 API·DB의 서로 다른 흐름은 병렬 경로로 그린다. 요청·응답은 양방향, 업로드·작업 등록은 단방향으로 표시한다.

- `wiki-deployment.svg`는 로컬 사용자, OCI App Container Instance, PostgreSQL 전용 Compute VM·Block Volume, OCI Object Storage와 외부 AI를 구분한다. App은 Caddy·Next.js·API·Worker 4개와 로그 수집 sidecar 1개다. 앱 3 OCPU·20GB + DB 1 OCPU·4GB는 후보이며 무료 계정 자격 미확인을 표시한다.
- DB VM과 연결된 부트·데이터 디스크는 큰 “DB 서버 구성” 영역으로 묶는다. 내부에서 VM과 볼륨은 별도 컴포넌트로 구분하고 연결·마운트 관계를 표시한다.
- App 내부 통신은 localhost, DB 연결은 같은 VCN의 private IP/DNS·TLS:5432로 표시한다. DataGrip 관리 접속은 별도 공인 주소·TLS·IP 제한 없는 관리 경로로 그리며 Bastion은 두지 않는다. DNS 조회·HTTPS 요청·ACME 발급과 Object Storage 원문 저장을 구분한다.
- PostgreSQL 데이터는 DB VM에 연결한 Block Volume에 둔다. FSS는 제외하며 Caddy에서 S3 저장 모듈·HTTPS를 통해 비공개 인증서 버킷으로 연결하는 경로를 표시한다. 원문 버킷과 인증서 상태 버킷을 구분하며 백업으로 표시하지 않는다. 컨테이너 임시 파일을 DB 저장소로 표현하지 않는다. 무료 운영 조건과 구현 전 확인 사항은 본문에 둔다.
- `wiki-operations.svg`는 Terraform의 OCI 인프라·DB VM과 cloud-init 설정 → CI 실행 정의 → 이미지 배포 → 점검·복구를 보여준다. OCI는 앱 서버를, 우리는 DB VM의 OS·PostgreSQL을 관리하고 우리는 이미지·마운트·자원 제한·health check·데이터를 관리한다.
- 운영도에는 앱 로그 → 독립 수집기 → OCI Logging·Connector Hub → 알림 Function → Slack을 표시한다. OCI 알람·외부 HTTP 점검은 Notifications를 통해 같은 Function으로 전달하며 API·Worker에서 Slack으로 직접 연결하지 않는다. 백업·복원은 후속 과제이므로 운영도에 백업 작업·저장소·알림을 넣지 않는다.
- Terraform과 OCI CLI/API의 실행 자원 소유권을 중복시키지 않는다. 앱 배포와 DB 서비스 유지보수를 분리하고, App CI 재생성과 DB VM 업데이트·스키마 변경을 구분한다. Terraform은 DB VM·볼륨을, cloud-init은 최초 DB 설치를 관리한다.
- PostgreSQL·API·Worker의 검색 책임은 키워드 색인·별칭·문서 연결로 표현한다. 외부 LLM은 NVIDIA의 Kimi K3·DeepSeek로 표시하고 초기에는 지식 추출·갱신 후보 생성에 사용한다. 조회 결과를 받은 현재 에이전트가 답변한다. 임베딩·pgvector·맥북 모델 서버는 후속 후보로 본문에 기록한다.
- 기술 이름과 책임을 함께 적고 예약 작업의 주기는 제목에 표시한다. 아이콘은 출처·라이선스를 보존한 원본을 SVG에 포함한다. DNS·인증서 서비스는 OCI 밖에 두고 점선으로 연결한다.
- 배포도에서 DuckDNS 조회선은 웹 Wiki 클라이언트에 연결하고, DNS 레코드의 대상은 App CI 공인 IP로 표시한다. 아래 에이전트는 주 용례인 HTTPS API 근거 조회를 담당한다. 웹 Wiki는 편집·정정·출처 확인용 보조 클라이언트로 구분한다. Obsidian 클라이언트·Vault 동기화는 제품 구성에 넣지 않는다.
- 계층도는 실행 인프라와 독립적인 L1–L5 개념도로 유지한다. 세 그림은 저장소 루트에서 `python3 scripts/generate-wiki-diagrams.py`로 재생성하고 실제 렌더링을 검증한다.
