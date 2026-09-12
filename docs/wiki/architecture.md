# Agent Wiki 아키텍처

[Wiki 문서와 레퍼런스](README.md)

![Memory·Article·Glossary와 계층을 가로지르는 Lineage를 합성 예제로 설명하는 Wiki 계층도](../assets/wiki-layers.svg)

**주 용례는 에이전트가 질답·작업 중 필요한 근거 자료를 조회하는 것이다.** Wiki는 원천 자료를 축적·정리해 인용 가능한 Context를 제공한다. 웹은 편집·정정·근거 확인을 위한 보조 화면이며 Workspace로 업무·취미를 격리한다.

2026-09-12 기준 첫 버전을 OCI에 배포했다. 실제 구현·자원·검증 상태는 [운영 현황](../OPERATIONS.md)을 따른다. 키워드 검색·Context 조회는 검증했으며 NVIDIA 지식 추출은 실제 성공 검증이 남아 있다. 임베딩과 OpenMetadata 전체 도입은 보류한다.

## 공통 용어: LLM Wiki · OpenMetadata

**계층·작업 이름은 Karpathy의 LLM Wiki, 지식 객체·용어집·계보는 OpenMetadata v2.0.x를 기준으로 통일한다.** 아래 표가 Wiki 문서·그림·향후 API와 스키마의 용어 기준이다. 두 자료의 개념을 조합한 제품 설계이며, L1–L5 자체가 외부 표준은 아니다.

### 계층과 작업

| 위치 | 기준 이름 | 한글·책임 | 출처 |
| --- | --- | --- | --- |
| L1 | **Raw sources** | 원천 자료. 개별 입력은 Source, 업로드한 파일 기록은 Document | LLM Wiki / OpenMetadata Documents |
| L2 | **Ingest** | 지식 반영. 읽기·추출·검증 후 기존 Wiki에 반영하는 작업 | LLM Wiki |
| L3 | **Wiki** | 누적 지식. Memory·Article·Glossary와 연결을 보관 | LLM Wiki + OpenMetadata |
| L4 | **Query** | 질의. 현재 지식을 검색하고 인용할 근거를 선택 | LLM Wiki |
| L5 | **Answers** | 응답·활용. 근거와 함께 답하거나 다음 에이전트 작업에 전달 | LLM Wiki의 Query 산출물에서 차용 |
| 공통 규칙 | **Schema** | 위키의 구조·작성 관례·작업 절차 | LLM Wiki |
| 유지 작업 | **Lint** | 상충·오래된 주장·연결 누락 등을 점검 | LLM Wiki |
| 탐색 | **Index** | 지식 페이지를 찾기 위한 목차 | LLM Wiki |
| 작업 이력 | **Log** | Ingest·Query·Lint의 시간순 실행 기록 | LLM Wiki |

[LLM Wiki 원문](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)의 개념을 제품에 맞게 조합했다. Schema는 작성·운영 관례이며 DB 스키마와 구분한다. Index·Log는 역할 이름으로, 특정 파일 형식을 강제하지 않는다.

### 지식 객체와 관리

| 기준 이름 | 의미 | Wiki 예시·적용 범위 |
| --- | --- | --- |
| **Source · 원천 자료** | Wiki 작성에 사용하는 개별 입력 | `session-demo#e3`로 특정 발언 참조. LLM Wiki의 raw source |
| **Document · 입력 문서** | 업로드한 파일의 관리 기록 | 세션 JSON·메모 파일·PDF. Source 중 파일로 받은 자료에 사용 |
| **Memory · 기억** | 짧고 재사용 가능한 사실·정의·선호 | `m1`: 같은 결제 요청은 같은 멱등 키. 결정 상태는 제품 확장 |
| **Article · 지식 문서** | 지속적으로 작성·개정하는 긴 설명 문서 | `a1@r1`: 결제 재시도 정책. 일별 업무 일지도 Article의 한 유형 |
| **Glossary · 용어집** | 정의와 관계를 관리하는 용어 모음 | 결제 용어집 |
| **Glossary Term · 용어** | 용어집에 속한 개별 개념 | 멱등성, 별칭 idempotency, 관련 용어 |
| **Data Lineage · 데이터 계보** | 입력에서 결과물로 이어지는 변환·사용 관계 | Source → Ingest 실행 → Memory → Article 개정 → Context |
| **Data Governance · 데이터 관리 정책** | 데이터의 접근·분류·보관 등을 통제하는 규칙 | Workspace별 접근 권한·마스킹·정정·삭제 |
| **Folder · 폴더** | 문서를 계층적으로 정리하는 단위 | 프로젝트 / 장애 대응 / 학습 |
| **Tag · 태그** | 여러 항목에 붙이는 분류·탐색 표시 | Redis, 성능, 독서. 권한 경계로 사용하지 않음 |
| **Context · 맥락** | 사람·AI가 작업을 이해하는 데 쓰는 관련 지식 | 요청별 현재 결정·제약·인용. 전달 묶음의 형식은 제품 설계 |

[Documents](https://docs.open-metadata.org/v2.0.x/how-to-guides/context-center/documents) · [Memories](https://docs.open-metadata.org/v2.0.x/how-to-guides/context-center/memories) · [Articles](https://docs.open-metadata.org/v2.0.x/how-to-guides/context-center/articles) · [Glossary](https://docs.open-metadata.org/v2.0.x/how-to-guides/data-governance/glossary) · [Data Lineage](https://docs.open-metadata.org/v2.0.x/how-to-guides/data-lineage) · [Data Governance](https://docs.open-metadata.org/v2.0.x/how-to-guides/data-governance) · [Context Center](https://docs.open-metadata.org/v2.0.x/how-to-guides/context-center)

Document는 입력 파일, Article은 유지·개정하는 위키 페이지다. 추출 결과는 검증 전까지 지식 변경 후보로 취급한다.

Workspace 격리와 `supported_by`·`about`·`supersedes` 관계는 우리 제품 계약이다. Data Lineage는 파생 경로, Log는 실행 이력이다. [W3C PROV-DM](https://www.w3.org/TR/prov-dm/)은 출처 모델 참고 자료로 둔다.

### 갱신과 검색의 책임

1. Ingest가 Raw sources를 읽고 후보를 추출한다. Source와 Memory의 ID를 연결하고 제안·확정·구현 완료를 구분한다.
2. Wiki에 Memory·Article 개정을 반영한다. 이전 결정을 대체할 때는 유효 시점과 `supersedes`를 기록한다.
3. 같은 트랜잭션에 색인 갱신 작업을 등록한다. 키워드 검색 인덱스는 개정 ID로 재생성할 수 있게 관리한다.
4. Query는 Workspace·권한·삭제·유효성 조건을 검색과 관계 확장에 적용한다. Context에 담기 전 현재 개정과 인용을 재검사한다.
5. Lint는 상충·오래된 주장·누락된 연결을 점검한다. 정정·삭제 시 Data Lineage로 영향을 찾고 문서·색인·Context 캐시를 재계산한다.
6. Ingest·Query·Lint의 실행 주체·시각·입력·버전을 Log에 기록한다. Log의 순서만으로 파생 관계를 추론하지 않는다.

Data Lineage는 L1–L4를 가로지르며, Data Governance와 Schema는 전 계층에 적용한다. 원천 자료가 만료·삭제되면 근거 본문을 볼 수 없음을 표시한다. 해시만으로 내용의 진위를 증명했다고 표현하지 않는다.

## 지식 저장·조회와 웹 편집: 무엇을 재사용할까

사람과 에이전트는 같은 Article·Memory·개정을 사용한다. 편집기는 기준 개정을 전송하고 서버의 현재 개정과 다르면 충돌로 처리한다.

| 범위 | 재사용 후보 | 제품에서 구현할 것 |
| --- | --- | --- |
| 저장·검색 | PostgreSQL·pg_trgm | 지식 모델·Workspace 제약·검색 순위 |
| 관계 조회 | SQL JOIN·[재귀 CTE](https://www.postgresql.org/docs/current/queries-with.html) | 근거·주제·대체 관계와 탐색 범위 |
| 그래프 화면 | [Cytoscape.js](https://js.cytoscape.org/) | 노드·간선 선택과 근거 열기 |
| 웹 읽기·편집 | 기존 편집기·Markdown 렌더러, 선정 전 | 문서 URL·목차·링크·개정·권한 통합 |

Obsidian 앱은 사용하지 않는다. Markdown·위키 링크·역방향 참조의 재사용 범위와 웹 편집기는 미확정이다. Cytoscape.js는 시각화 후보이며 관계는 PostgreSQL에 저장한다. [Apache AGE](https://age.apache.org/)는 SQL로 부족한 그래프 질의가 확인될 때 평가한다.

## 초기 검색과 임베딩 보류

**키워드·Folder·Tag·용어집 별칭·문서 연결로 검색한다.** 검색·Context 구성에 AI 호출은 필요하지 않다.

### 키워드에서 Context까지

| 단계 | 초기 동작 | 결과 |
| --- | --- | --- |
| 검색 자료 준비 | Article 제목·본문, Memory 본문, Tag·용어집 이름과 별칭을 정규화 | 검색할 문자열·명시적인 분류와 관계 |
| 키워드 조회 | PostgreSQL에서 제목·본문 부분 일치와 용어·태그 일치를 조회 | 같은 Workspace의 문서 개정 후보 |
| 범위·순위 | Folder·Tag 조건을 적용하고 제목·태그·용어 일치를 본문 일치보다 우선 | 검색된 이유가 드러나는 문서 목록 |
| 연결 확인 | 문서 링크·역방향 참조·근거 관계를 제한된 범위에서 조회 | 관련 Article·Memory·Source |
| Context 구성 | 현재 권한·개정·삭제 상태를 재검사하고 길이 한도 안에서 본문·인용을 선택 | 에이전트에 전달하거나 사람이 복사할 Context |

제목·본문 부분 일치를 `pg_trgm` GIN 인덱스로 가속한다. 키워드 추출은 검색 표현을 고르는 처리, 역색인은 표현에서 문서를 찾는 구조다. 초기에는 별도 AI 키워드 추출 없이 문자열·사용자 태그·별칭을 사용한다.

`pg_trgm`은 문자 조각 색인이며 한국어 형태소·의미 검색은 아니다. 짧은 검색어의 전체 스캔과 조사·띄어쓰기·별칭 누락을 측정한다. 문서량이 늘면 한국어 토큰화·전문 검색을 평가한다. [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html#PGTRGM-INDEX) · [전문 검색 색인](https://www.postgresql.org/docs/current/textsearch-indexes.html)

같은 합성 결제 정책 예제를 검색하면 다음과 같다. 별칭은 동일 용어의 다른 표기이며, `중복 결제`처럼 관련된 표현은 자동으로 동의어로 확정하지 않는다.

| 입력·중간 결과 | 값 |
| --- | --- |
| 요청 범위 | 업무 Workspace · Folder: 결제 · Tag: 재시도 |
| 검색어 | `결제 idempotency` |
| 용어집 별칭 | `idempotency → 멱등성` |
| 조회 단서 | 제목의 `결제`, 연결 용어 `멱등성`, 태그 `재시도` |
| 선택 문서 | `a1@r1` · 결제 재시도 정책 |
| 근거 확인 | `a1@r1 → m1 → session-demo#e3` |
| Context `c1` | 동일 요청은 같은 멱등 키 · 정책 확정/구현 전 · 개정·출처 인용 |

검색 점수는 사실의 확신도가 아니다. 문서가 있어도 표현이 크게 다르면 검색에 실패할 수 있다. 이 실패 사례와 한국어 조사·띄어쓰기·영문 별칭 검색 결과를 모아 검색 개선 순서를 정한다.

### 에이전트 조회가 주 흐름

`사용자 질문 → 현재 에이전트 → 원격 Query API → 근거 Context → 현재 에이전트의 답변·작업`

Wiki는 질문과 관련된 자료를 반환하고, 답변은 사용자가 이미 쓰는 에이전트가 생성한다. 일반 조회에서 Wiki 서버의 NVIDIA LLM을 다시 호출하지 않는다. 이 Context는 모델 학습 데이터가 아니라 질의 시 참고하는 외부 근거다.

혼자 사용하는 초기 구성은 **필요할 때 원격 조회**하는 방식을 권장한다. 로컬 DB·전체 문서 복제·동기화 서버는 두지 않는다. 첫 버전은 Workspace 전용 Bearer 키로 HTTP Context API를 조회한다. MCP 서버는 후속 후보로 둔다.

| 상황 | 조회 방식 |
| --- | --- |
| 프로젝트 작업 시작·이전 결정 질문 | Workspace와 질문을 보내 관련 발췌·문서 ID·개정·출처·조회 시각을 한 번에 받음 |
| 같은 주제의 후속 질문 | 이미 받은 Context를 대화 안에서 재사용 |
| 새로운 주제·근거 부족·정정 후·최신 상태 확인 | 원격에서 다시 조회 |
| 서버에 연결할 수 없음 | 조회 실패를 표시하고 기존 Context는 확인 시점과 함께 사용 |

예: “결제 재시도 정책이 뭐였지?” → `a1@r1`, 같은 멱등 키 사용 결정, `session-demo#e3`, 정책 확정/구현 전 상태를 반환한다. “그럼 테스트는?”에는 이 근거를 재사용하되 최신 구현 상태가 필요하면 새로 조회한다.

응답은 상위 문서의 필요한 발췌와 인용만 길이 한도 안에서 반환한다. 대화에 전달한 자료는 서버에서 정정·삭제해도 자동 회수되지 않으므로 최신 여부를 단정하지 않는다. Workspace 전환은 새 대화·맥락으로 분리한다. 영속 로컬 캐시는 실제 지연·호출량을 측정한 뒤 필요할 때 검토한다.

### 임베딩의 후속 후보

키워드 검색의 누락 사례가 쌓였을 때 다음 두 경로를 평가한다. 작은 모델을 포함한 임베딩 모델을 지금 OCI에 추가 설치하지 않는다.

| 후보 | 도입 전에 확인할 것 |
| --- | --- |
| 외부 임베딩 API | 한국어 검색 품질, 호출료·무료 제한, 데이터 보관·학습 정책, 가용성 |
| 사용자가 제시한 [sionic-ai/comsat-embed-ko-8b-preview](https://huggingface.co/sionic-ai/comsat-embed-ko-8b-preview) 직접 실행 | 실행 위치·메모리·처리 시간·양자화 품질·라이선스 |

Comsat은 8B·4,096차원 모델이며 공개 가중치 라이선스는 CC BY-NC 4.0이다. 맥북 실행은 검토 후보이며 설치·호출·품질 검증을 완료한 것이 아니다. 현재 앱 자원 배분에 모델 실행 자원은 포함하지 않는다. 위 사양·라이선스는 2026-09-12 모델 카드 확인 기준이며 채택 전에 다시 확인한다.

도입 시 문서와 검색 질문에 같은 임베딩 모델·버전을 사용하고, 모델을 바꾸면 기존 자료도 다시 임베딩한다. 외부 API와 직접 실행 모델의 서로 다른 벡터를 한 검색 공간에 섞지 않는다. 맥북에서 처리한다면 새 검색 질문도 맥북 실행에 의존하므로 가동 시간과 연결 방법을 정해야 한다. [pgvector](https://github.com/pgvector/pgvector)는 이때 검토할 벡터 검색 확장이며 그래프 확장이 아니다.

## 단일 Compute VM 배포

**OCI A1 Compute VM 1대 · 2 OCPU·12GB에서 앱과 PostgreSQL을 함께 실행한다.** Docker Compose로 앱 4개·PostgreSQL, 총 5개 컨테이너를 관리한다. CPU를 앱·DB에 1개씩 고정 분할하지 않고 공유한다. OS·Docker·DB 업데이트는 우리가 맡는다.

![A1 VM 1대에서 앱과 PostgreSQL을 함께 실행](../assets/wiki-deployment.svg)

이전 App Container Instance + DB VM 분리안은 [그림·생성기와 함께 보존](../archive/container-instances/ARCHIVE.md)했다. 현재는 단일 VM이며 필요해지면 앱·Worker·DB를 분리한다.

### 실행 단위와 자원 배분

| 컨테이너 | 메모리 상한 초안 | 자원 정책 |
| --- | --- | --- |
| Caddy | 0.25GB | HTTPS·경로 분기, 공식 이미지 |
| Next.js | 2GB | 웹 관리 화면, ARM64 빌드는 외부에서 수행 |
| Fastify API | 2GB | 인증·접수·근거 조회·편집 |
| Worker | 2GB | CPU 최대 0.5개·작업과 AI 호출 동시성 1 |
| PostgreSQL | 3GB | 문서·개정·색인·pg-boss, 연결 수 제한 |

메모리 상한 합계 9.25GB, 나머지 2.75GB는 호스트 OS·Docker·기성 로그 에이전트와 여유분으로 둔다. 상한은 예약량이 아니며 초기 실측 후 조정한다. Worker만 CPU 상한을 두고 웹·API·DB는 공유 CPU를 사용한다. 대량 수집 시 완료까지 오래 걸리는 것은 허용하되 조회 응답 지연을 먼저 확인한다. 모델 직접 실행·VM 안에서 이미지 빌드는 하지 않는다.

### PostgreSQL과 영속 상태

PostgreSQL도 고정 버전 컨테이너로 실행한다. cloud-init은 Docker·Compose 설치와 볼륨 마운트를 준비하며, systemd가 마운트 완료 후 Compose를 기동한다. 앱 배포에서 DB 컨테이너를 재생성하지 않는다. DB 버전 변경은 별도 유지보수로 처리한다.

검색은 `pg_trgm`, 필요한 암호화 기능은 `pgcrypto`, 작업 큐는 `pg-boss`를 사용한다. 앱 역할과 DDL 마이그레이션 역할을 분리한다. [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) · [pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html)

| 저장 대상 | 위치 | 관리 경계 |
| --- | --- | --- |
| OS·Docker·이미지 | Boot Volume 50GB | 오래된 이미지·로그 크기 제한 |
| 문서·개정·관계·큐 | 연결한 Block Volume 50GB의 PostgreSQL 경로 | DB 버전에 맞는 PGDATA 경로로 bind mount |
| Caddy 인증서·개인키·ACME 상태 | 같은 Block Volume의 별도 Caddy 경로 | `/data`·`/config` 영속 마운트, 컨테이너 교체 시 재사용 |
| 마스킹한 원천 자료 | 비공개 Object Storage 원문 버킷 1개 | 불변 객체·해시·Workspace 기록 |
| 업로드 처리·압축 해제·캐시 | 크기를 제한한 임시 공간 | 보관소로 사용하지 않음 |

DB·Caddy는 별도 디렉터리와 권한을 사용한다. 마운트가 없으면 기동을 중단해 부트 디스크에 빈 DB가 생기는 것을 막는다. VM 교체 때 데이터 볼륨은 유지·재연결하며 Terraform에서 삭제를 방지한다. 동일 디스크이므로 VM·볼륨 장애에 앱과 DB가 함께 영향을 받는다. 운영 데이터 백업은 초기 범위에서 제외한다.

### 주소·HTTPS·네트워크

`agent-wiki.duckdns.org`는 VM 공인 IP를 가리키며 Caddy가 80/443에서 HTTPS를 처리한다. 도메인 IP 갱신·Caddy 인증서 발급과 HTTPS 접속을 확인했다. Caddy 공식 이미지의 영속 `/data`를 사용하므로 S3 저장 모듈·Customer Secret Key·인증서 전용 버킷은 필요 없다. [Caddy Docker](https://hub.docker.com/_/caddy) · [자동 HTTPS](https://caddyserver.com/docs/automatic-https)

Compose 네트워크에서 Caddy는 `web:3000`, `api:3001`에 연결하고 API·Worker는 `postgres:5432`로 접근한다. 컨테이너마다 네트워크가 분리되므로 다른 서비스에 localhost로 연결하지 않는다. Next.js·API·Worker 포트는 호스트에 공개하지 않는다. [Compose 네트워크](https://docs.docker.com/compose/how-tos/networking/)

DataGrip은 VM 공인 주소의 5432 포트에 직접 연결한다. Bastion·SSH 터널·접속 IP 제한 없이 관리 계정 ID/비밀번호와 TLS를 사용한다. `pg_hba.conf`는 지정 DB·관리 계정에 대해 외부 IPv4 접속을 허용하고 앱 계정은 Compose 내부 대역으로 제한한다. 강한 비밀번호·`hostssl`·`scram-sha-256`을 사용하며 DataGrip은 신뢰 CA와 `verify-full`로 서버 주소를 검증한다. NSG뿐 아니라 Docker가 게시하는 포트의 호스트 방화벽 동작도 확인한다. [접속 규칙](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html) · [TLS 검증](https://www.postgresql.org/docs/current/libpq-ssl.html)

실제 구성 시 `.env.local`에 `PG_ADMIN_HOST`, `PG_ADMIN_PORT`, `PG_ADMIN_DATABASE`, `PG_ADMIN_USER`, `PG_ADMIN_PASSWORD`, `PG_ADMIN_SSLMODE`, `PG_ADMIN_SSLROOTCERT`를 기록한다. DB TLS 인증서는 웹 HTTPS 인증서와 별도로 관리하며 내부 서비스 이름과 관리 접속 주소를 검증할 수 있게 구성한다. 클라이언트 인증서는 요구하지 않는다.

VM은 Internet Gateway를 통해 GHCR·NVIDIA·OCI API에 접근한다. 별도 NAT Gateway·Load Balancer·FSS는 두지 않는다. 서버 유지보수·배포는 키 인증 SSH를 사용하며 DataGrip 비밀번호 접속과 구분한다. Docker 원격 API는 공개하지 않는다.

## 앱과 지식 처리

| 영역 | 기술 | 책임 |
| --- | --- | --- |
| L5 Answers | Next.js standalone·React | 위키·검색·검토 UI, 맥락 복사, SSR·정적 자산 |
| L4 Query·API | TypeScript·Fastify | GitHub 인증·Workspace 권한, 접수·검색·편집 |
| L2 Ingest·L3 Wiki | TypeScript Worker·pg-boss | AI 추출·근거 검증·문서 갱신·키워드 색인·재시도 |
| 관계·검색 | PostgreSQL·pg_trgm | 문서·개정·근거·링크·키워드 색인·작업 큐 |
| L1 Raw sources | 비공개 Object Storage·원천 자료 접근 모듈 | 마스킹·압축 후 불변 원문 객체 저장 |

[Fastify](https://fastify.dev/docs/latest/) API는 인증·접수·검색을 담당하며 웹·Worker와 독립 컨테이너로 실행한다.

원문 저장소는 별도 서버가 아니라 API·Worker의 접근 모듈이다. `workspace_id/source_id/content_hash` 객체 키와 해시·크기·압축 형식을 기록한다. 작업용 임시 디스크는 보관소가 아니며 크기 제한·정리 정책을 둔다. 마스킹 전 원문을 영속 임시 파일·로그에 쓰지 않는다.

| 단계 | 저장·실패 경계 |
| --- | --- |
| 접수 | 인증·Workspace 검사 → 크기 제한·마스킹 → 압축 원문 객체 저장 |
| 작업 등록 | 객체 저장 확인 후 접수 메타데이터·pg-boss 작업을 같은 DB 트랜잭션에 등록. 그 뒤 ACK |
| 불완전 접수 | 객체와 DB는 하나의 트랜잭션이 아님. 멱등 키로 중복 접수 방지, 미등록 객체는 유예 후 정리 |
| Ingest | AI 호출은 DB 트랜잭션 밖에서 수행. 입력 해시·모델·프롬프트 버전·시도·출처 검증 결과 기록 |
| 관계 갱신 | 문서 개정·링크·근거를 원자적으로 반영하고 동시 개정 충돌 검사 |
| 재시도·교체 | 큐·체크포인트는 DB에 유지. 처리 lease·멱등 반영으로 Worker 또는 VM 중단 뒤 재개 |

pg-boss는 PostgreSQL 기반 큐다. 별도 큐 서버는 두지 않는다. 외부 AI 요청은 중복될 수 있으므로 외부 호출까지 exactly-once라고 표현하지 않는다. [pg-boss](https://github.com/timgit/pg-boss)

### 큐 처리 기준

pg-boss는 Kafka의 파티션 오프셋 대신 **작업 ID와 상태**로 진행을 관리한다. 로그는 관찰 자료이며 완료 확인이나 재처리 기준으로 사용하지 않는다.

| 확인할 점 | 초기 처리 기준 |
| --- | --- |
| 접수·등록 | 접수 레코드와 작업 등록은 같은 DB 트랜잭션으로 커밋한 뒤 접수 ACK. pg-boss의 트랜잭션 adapter를 사용 |
| 완료·실패 | 결과 반영 커밋 후 handler 완료. 재시도 오류는 정제된 로그를 남기고 throw. 로그만 찍고 성공 반환하지 않음 |
| 중복 실행 | Workspace·원문 해시·처리 버전의 멱등 키와 DB 유일 제약으로 결과 중복 반영 방지. 결과 커밋 뒤 큐 완료 전 죽어도 재실행은 기존 결과 확인 |
| 순서·오래된 작업 | 초기 batch 1·동시성 1. 재시도로 완료 순서가 바뀔 수 있으므로 반영 전 문서 개정·삭제 여부 확인. 옛 결과로 최신 문서를 덮어쓰지 않음 |
| timeout·중단 | LLM timeout을 작업 만료보다 짧게 설정. SIGTERM에서는 신규 수신 중지·진행 작업 종료 유예. 만료가 외부 요청 취소를 보장하지 않으므로 AbortSignal과 반영 시 실행 소유권 재검사 |
| 재시도 | 일시 오류는 지수 backoff와 유한 횟수, 429는 Retry-After 준수. 인증·계약 오류는 자동 반복하지 않고 실패 보관. 큐 재시도와 모델 fallback의 총 시도 상한을 함께 제한 |
| 최종 실패·보관 | 실패 작업과 원문 참조를 남기고 원인 수정 후 수동 재등록. 완료 이력은 짧게 정리하되 대기·실패 작업이 보관 만료로 조용히 사라지지 않도록 설정 |
| 외부 호출·DB 부하 | LLM 대기 중 DB 트랜잭션을 유지하지 않음. 외부 호출 중복 가능성을 수용. 큐 연결 수·polling·완료 이력 청소로 공유 CPU와 DB 부하 제한 |

문서의 개념상 상태는 `대기 → 처리 중 → 완료 / 재시도 대기 / 최종 실패`다. pg-boss `work()`의 실패·완료 동작과 heartbeat·expiration·retention 옵션은 버전 고정 후 확인한다. 최종 실패 상태와 경보 로그가 누락되지 않도록 큐 상태 점검도 두며, 프로세스 강제 종료는 외부 상태 점검으로 탐지한다. [Worker 처리](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md) · [작업·트랜잭션](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md) · [큐 옵션](https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md)

구현 시 접수 트랜잭션 실패, 결과 커밋 직후 프로세스 종료, LLM 429/timeout, 오래된 개정 재시도만 작게 검증한다. 반복 장애 훈련은 하지 않는다.

문서·원문 객체·링크·검색 색인·큐·캐시에 Workspace 경계를 적용한다. API·Worker는 제한된 DB 역할과 RLS를 사용한다. 링크의 양쪽 문서가 같은 Workspace에 속하도록 제약을 건다. 검색 후보·별칭 조회·문서 연결 확장 모두 같은 Workspace 안으로 제한한다. 정정·삭제 후 오래된 색인 후보는 현재 개정·권한을 재검사해 제외한다. pg_trgm은 한국어 형태소 분석기가 아니다. [RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) · [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)

인증은 유지관리되는 라이브러리로 구현하며 HttpOnly·Secure 쿠키·CSRF·Workspace 권한을 검증한다. 현재 Sessions의 인증 호환성은 요구하지 않는다.

GitHub OAuth 앱의 홈페이지는 `https://agent-wiki.duckdns.org`, callback은 `https://agent-wiki.duckdns.org/api/auth/github/callback`으로 등록한다. Fastify에서 이 callback을 구현하며 Client ID·secret은 `.env.local`에 보관한다. 로그인에는 저장소 접근 권한을 요청하지 않는다.

### NVIDIA의 Kimi·DeepSeek 호출

**서버 LLM의 초기 역할은 지식 추출·갱신 후보 생성이다.** 검색·Context를 받은 현재 에이전트가 답변하므로 조회마다 서버 LLM을 호출하지 않는다. Wiki 자체 답변 생성은 후속 선택 기능이다.

| 우선순위 | NVIDIA 모델 ID | 용도 초안 |
| --- | --- | --- |
| 기본 | `moonshotai/kimi-k3` | 지식 추출·정리·문서 갱신 후보 |
| 대체 | `deepseek-ai/deepseek-v4-pro-0813` | Kimi의 일시 오류·출력 검증 실패 시 제한된 대체 호출 |
| 선택 | `deepseek-ai/deepseek-v4-flash-0731` | 짧은 일괄 정리의 지연·품질을 비교한 뒤 적용 |

2026-09-12 NVIDIA의 [Kimi K3](https://build.nvidia.com/moonshotai/kimi-k3), [DeepSeek Pro](https://build.nvidia.com/deepseek-ai/deepseek-v4-pro-0813), [DeepSeek Flash](https://build.nvidia.com/deepseek-ai/deepseek-v4-flash-0731) 페이지에서 무료 endpoint와 위 호출 ID를 확인했다. 이 순서는 사용자 선호를 반영한 시작 정책이며 한국어 품질·지연 우열의 실측 결과가 아니다.

호출 endpoint는 `https://integrate.api.nvidia.com/v1/chat/completions`, 인증은 서버의 NVIDIA API 키다. OpenAI 호환 형식을 사용하되 모델별 reasoning·streaming·출력 옵션은 adapter에서 구분한다. OCI에는 모델 가중치를 올리지 않는다. 키는 권한을 제한한 Worker 전용 환경 파일에 보관하며 웹 클라이언트에 전달하지 않는다. [Kimi API](https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer)

초기 호출 동시성은 제공자 전체 1로 제한한다. 429는 Retry-After가 있으면 이를 따르고 큐에 다시 예약한다. 같은 NVIDIA 계정의 모델 교체를 쿼타 우회 수단으로 사용하지 않는다. 일시적 5xx·timeout과 JSON·출처 검증 실패에만 정해진 총 시도 한도 안에서 대체 모델을 사용한다. 인증 실패는 재시도 폭주 없이 설정 오류로 표시한다. 최대 3회 모두 실패하면 Ingest를 실패 상태로 남겨 사용자가 재시도할 수 있게 하고 기존 지식의 읽기·검색은 유지한다.

입력 크기·출력 토큰·전체 실행 시간을 제한하고 기본 모델과 실제 사용 모델, 프롬프트 버전·시도·지연·토큰 사용량·전환 이유를 기록한다. 응답은 JSON 구조·근거 ID·Workspace·현재 개정 충돌을 검증한 뒤 갱신 후보로 반영한다. 추론 텍스트를 사실이나 검증 근거로 취급하지 않는다. 자동으로 다른 유료 제공자로 넘기지 않는다.

무료 endpoint는 프로토타입 제공으로 안내되어 있으며 고정 RPM·영구 무료·운영 SLA를 전제하지 않는다. 현재 연결된 NVIDIA 약관은 별도 계약으로 허용하지 않는 기밀·개인·민감 데이터 전송을 제한한다. 합성·비기밀 자료로 먼저 검증하고 실제 업무 자료는 적용 약관과 전송 가능 범위를 확인한다. 마스킹만으로 모든 자료가 허용된다고 판단하지 않는다. [NVIDIA 이용 조건](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA_Technology_Access_TOU.pdf)

실제 추론·한국어 품질 검증은 구현 단계에서 수행한다.

### OpenMetadata 적합성 계산

**개념·모델을 참고하고 전체 설치는 보류한다.** 문서·기억·용어집을 제공하지만 개인 Wiki에는 검색·수집 서비스 운영이 추가되고, Workspace 격리·지식 갱신·근거 검증은 여전히 구현해야 한다.

| 2026-09-12 공식 사양 | 요구량 | 판단 |
| --- | --- | --- |
| 로컬 Docker 실험 | 4 vCPU·6GiB 이상 | 개발 최소치이며 운영 예산과 구분 |
| 운영 권장 DB + 검색 3노드 | 합계 10 vCPU·40GiB·약 400GB | OpenMetadata 서버·앱·백업을 제외해도 초기 범위가 큼 |
| Airflow 선택 시 | 추가 4 vCPU·16GiB·100GiB | 외부 ingestion을 쓰면 상주 제외 가능 |

[로컬 요구사항](https://docs.open-metadata.org/v2.0.x/quick-start/local-docker-deployment) · [운영 권장 사양](https://docs.open-metadata.org/v2.0.x/deployment/minimum-requirements) · [2.0.1 Compose](https://github.com/open-metadata/OpenMetadata/releases/download/2.0.1-release/docker-compose-postgres.yml) · [외부 ingestion](https://docs.open-metadata.org/v2.0.x/deployment/ingestion)

현재 [Context Center](https://docs.open-metadata.org/v2.0.x/how-to-guides/context-center)의 MCP 검색은 파일 추출 knowledge pills 중심이다. Articles·직접 만든 Memories 전체 검색을 제공한다고 전제하지 않는다. 조직의 DB·BI 카탈로그까지 필요해지거나 기존 OpenMetadata를 공유할 수 있을 때 재검토한다.

## Terraform·Compose와 배포

![외부 빌드 후 변경된 앱만 교체하고 DB와 인증서를 유지](../assets/wiki-operations.svg)

Terraform은 OCI 인프라, cloud-init은 VM 최초 구성, Docker Compose는 컨테이너 실행을 맡는다. 일반 앱 배포는 VM·DB·Caddy를 재시작하지 않는다.

| 도구 | 관리 대상 |
| --- | --- |
| Terraform·Resource Manager | VM·VCN·볼륨·원문 버킷·IAM·로그·알림 인프라 |
| cloud-init / systemd | Docker·Compose 설치, 영속 볼륨 마운트 후 서비스 기동 |
| Docker Compose | 이미지 digest·네트워크·볼륨·메모리/CPU 제한·health check·종료 유예 |
| 앱 마이그레이션 | 스키마·인덱스·역할·RLS, 단일 실행 잠금 |
| GitHub Actions / SSH | ARM64 빌드·GHCR 게시·VM에 릴리스 전달·선택 서비스 교체 |
| Docker syslog·rsyslog·OCI 호스트 에이전트 / GitHub Actions | 기성 도구의 로그 전달 / Slack 알림, 업무 앱과 분리 |

### 배포 순서와 중단 범위

1. 외부에서 이미지를 빌드하고 digest를 고정한다. VM이 새 이미지를 미리 pull하는 동안 기존 서비스는 계속 실행한다. 다운로드 대역폭·디스크 I/O 영향은 확인한다.
2. 배포 잠금을 잡고 필요한 스키마 변경을 한 번 실행한다. 일반 배포는 기존 앱과 호환되는 추가 변경을 우선한다. 긴 잠금·파괴적 변경은 별도 중단 작업으로 분리한다.
3. Worker를 바꾸는 경우에만 새 작업 수신을 중지하고 진행 작업에 종료 유예를 준다. 조회 API와 DB는 이 대기 동안 유지한다.
4. 변경된 서비스만 `docker compose up -d --no-deps --no-build --wait <서비스>`로 교체한다. 전체 `compose down`과 볼륨 삭제를 앱 배포에 사용하지 않는다.
5. health check 뒤 로그인·검색·근거·수집을 확인한다. 앱 오류는 이전 digest로 같은 서비스를 재생성한다. 스키마를 자동 되돌리지는 않는다.

| 변경 | 예상 영향 |
| --- | --- |
| 이미지 빌드·미리 받기 | 기존 서비스 유지, 리소스 경합 가능 |
| 웹/API 컨테이너 교체 | 해당 서비스 종료·기동 동안 짧은 중단 또는 502 가능 |
| Worker만 교체 | 수집 처리 일시 지연, 기존 지식 조회 유지 |
| PostgreSQL 업데이트·긴 스키마 변경 | DB 의존 기능 중단, 별도 유지보수 |
| VM 재부팅·호스트 장애 | 전체 서비스 중단 |

단일 복제본 Compose는 자동 무중단 배포가 아니다. 앱 교체 중단을 짧게 하는 것을 목표로 하되 초 단위 시간을 약속하지 않는다. 실제 배포에서 종료 유예·기동·health check 시간을 측정한다. 무중단·blue-green은 현재 범위에서 제외한다. [Compose 운영](https://docs.docker.com/compose/how-tos/production/) · [선택 서비스 갱신](https://docs.docker.com/reference/cli/docker/compose/up/)

### 그레이스풀 셧다운

단일 구성의 배포 중단은 허용하되 **외부 신규 유입 차단 → 내부 진행 처리 완료 → 의존 서비스 종료** 순서를 지킨다. 정상 종료·재시도·강제 종료 후 재처리는 실제 컨테이너 검증의 필수 항목이다.

계획된 웹/API 배포에서는 Caddy에서 해당 외부 경로를 503·Retry-After로 막고, 이미 접수된 웹 요청과 그 요청이 이어서 호출하는 내부 API는 마칠 수 있게 둔다. 웹 요청이 정리되기 전에 API에 SIGTERM을 보내지 않는다. readiness 실패만으로 Caddy가 자동 차단한다고 가정하지 않고 배포 스크립트가 진입 차단·해제를 명시적으로 수행한다. 계획 밖 SIGTERM·연결 단절은 아래 제한된 재시도로 보완한다.

Worker는 내부 HTTP로 API를 재호출하지 않고 공유 업무 모듈과 PostgreSQL·Object Storage를 직접 사용한다. API만 교체할 때 Worker의 DB 연결까지 끊지 않는다.

| 대상 | 종료 순서 |
| --- | --- |
| 웹·API | 외부 신규 유입 차단 → 진행 웹 요청과 내부 API 호출 완료 → API SIGTERM·readiness 실패·`fastify.close()` → 남은 요청·트랜잭션 완료 → DB pool·로그 정리 |
| Worker | pg-boss 신규 작업 수신 중지 → 실행 작업 종료 유예 → 결과 커밋 뒤에만 완료 → 큐·DB 연결 종료 |
| 제한 시간 초과 | 외부 LLM·작업 요청 취소, 실패/재시도 상태 기록을 시도하고 성공 완료하지 않음. 강제 종료로 상태 기록을 못 해도 작업 만료·재시도와 멱등 키로 복구 |
| 컨테이너·호스트 | Node 프로세스에 신호가 전달되도록 exec 형식·init 사용. 앱을 먼저 종료하고 DB는 마지막에 종료. 일반 앱 배포는 DB 종료 제외 |

초기 종료 예산은 API 30초·Worker 90초, Compose `stop_grace_period`는 각각 45초·120초로 여유를 둔다. HTTP·LLM timeout과 큐 만료는 종료 예산에 맞춰 별도로 제한한다. 신호가 여러 번 와도 종료 처리는 한 번만 실행한다. 즉시 `process.exit()`하거나 DB 연결부터 닫아 진행 작업을 끊지 않는다. Fastify가 진행 중 소켓을 즉시 강제 종료하지 않도록 close 옵션을 고정 버전에서 확인한다. [Fastify close](https://fastify.dev/docs/latest/Reference/Server/#close) · [Compose 종료 유예](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)

구현 검증은 실제 컨테이너에 SIGTERM을 보내 진행 중 HTTP 요청 완료, 신규 요청·작업 차단, Worker 결과 단일 반영을 확인한다. 제한 초과와 강제 종료 뒤에는 미완료 작업 재처리·중복 방지를 확인한다. SIGKILL·호스트 전원 장애에는 정상 종료가 실행되지 않으므로 큐 복구가 따로 필요하다.

### 내부 호출과 재시도

| 호출 | 실패 처리 |
| --- | --- |
| 웹 → API 조회 | 연결 단절·일시 502/503/504만 짧은 backoff+jitter로 최대 2회 추가 시도. Retry-After와 전체 요청 deadline을 우선하며 이미 클라이언트가 취소한 요청은 중단 |
| 저장·수집 요청 | 같은 Workspace·요청 키·payload hash로 재시도하고 동일 키의 다른 payload는 거부. DB 유일 제약·작업 등록 트랜잭션·기존 결과 조회로 중복 반영 방지. 이 계약이 없는 쓰기는 자동 재전송 금지 |
| DB 접속·트랜잭션 | 연결 pool 재연결과 SQL 재실행을 구분. 교착·직렬화 실패는 재실행 가능한 전체 트랜잭션만 제한 재시도. COMMIT 응답 유실은 멱등 키로 결과 확인 후 판단 |
| Worker·외부 LLM | 큐가 작업 재시도의 주체. HTTP client·모델 fallback·큐 재시도의 총 횟수·시간을 제한. 종료 기한 뒤 새 호출 금지. 4xx 인증·검증 오류는 자동 반복하지 않음 |

Caddy·웹·API에 같은 요청의 재시도를 겹겹이 넣지 않는다. 외부 진입점의 쓰기 요청을 프록시가 임의 재전송하지 않도록 한다. `503` 자체가 데이터 손실을 뜻하지 않으며, 쓰기 timeout은 실패가 아니라 완료 여부 미확인일 수 있다.

검증에는 진행 중 웹 요청의 늦은 내부 API 호출, COMMIT 직후 응답 유실과 같은 키 재시도, 재시도 횟수·deadline 초과를 포함한다. 종료 유예 초과 후에도 의존 서비스가 영원히 살아 있어야 한다고 전제하지 않고 큐·멱등 복구로 연결한다. 호스트 전체 종료에서는 웹·API·Worker를 먼저 정리하고 PostgreSQL을 마지막에 멈춘다. Compose 의존 순서와 별도로 배포 스크립트의 drain 완료를 확인한다. [Compose 종료 순서](https://docs.docker.com/compose/how-tos/startup-order/)

### 인증과 비밀

개인 Wiki는 `OWNER_GITHUB_ID`로 지정한 GitHub 소유자만 사용한다. 공개 가입은 제공하지 않으며 OAuth에서 사용자·세션 생성 전에 소유자를 확인한다. 기존 세션과 에이전트 키도 요청마다 소유자를 확인하고, 소유자 설정이 없으면 인증 경로를 닫는다. 조회 키의 Workspace·권한 제한은 그대로 유지한다.

로컬 값은 Git에서 제외한 `.env.local`에 두고 예제에는 이름만 공유한다. 첫 버전은 `.env.local`에서 배포 시 권한 제한 환경 파일을 만들고 필요한 컨테이너에만 제공한다. Vault 도입은 후속 선택지다. 비밀 원문을 Terraform state·Compose 파일·이미지·로그에 넣지 않는다. OCI CLI 인증은 `~/.oci`에서 관리한다.

VM의 instance principal에 원문 버킷·로그 전달 권한을 최소로 부여한다. 같은 VM의 컨테이너를 서로 다른 OCI 신원으로 가정하지 않는다. Slack Webhook은 GitHub Actions의 production secret에만 두고 VM 앱·로그 에이전트에는 제공하지 않는다. [Instance principal](https://docs.oracle.com/en-us/iaas/Content/Identity/Tasks/callingservicesfrominstances.htm)

## 자원 수와 무료 운영 조건

**무료 자원 범위만 사용한다.** 사용자가 PAYG 계정 업그레이드를 직접 완료했지만 유료 자원·한도 초과·체험 크레딧 사용은 승인되지 않았다.

| 자원 | 초기 수·범위 | 확인할 한도 |
| --- | --- | --- |
| A1 Compute VM | 1대 · 2 OCPU·12GB | 앱·DB 총 5개 컨테이너, 호스트 로그 에이전트 별도 |
| Boot / Block Volume | 부트 50GB + 영속 데이터 50GB | 계정 전체 합계 200GB 무료 한도 |
| OCI Object Storage | 비공개 원문 버킷 1개 | 계정 전체 20GB·월 API 5만 회, 원문 목표 16GB 이하 |
| 이미지 저장소 | GHCR | 이미지 보관·빌드 사용량 확인 |
| 네트워크·운영 | VCN·보안 목록·Gateway·Logging·Monitoring·Budget | 서비스별 무료 이용 자격·사용량 확인 |

2026-09-12 공식 Always Free 상세 문서 기준 A1 VM 무료량은 월 1,500 OCPU시간·9,000 GB시간이다. 2 OCPU·12GB를 31일 실행하면 1,488 OCPU시간·8,928 GB시간으로 범위 안이다. 기존 자원과 VM 교체 중 중복 실행량도 합산한다. [OCI Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

Home region은 Osaka · ap-osaka-1이다. 생성 시 A1 용량 확보·계정 전체 사용량·서비스별 무료 자격을 확인한다. 현재 설계에는 Container Instances를 생성하지 않는다. **업그레이드 후 기존 사양으로 VM 생성·볼륨 연결·첫 앱 배포를 완료했다. 실제 검증·미완료 항목은 [운영 현황](../OPERATIONS.md)에 기록한다.**

## 모니터링과 알림

**API·Worker는 구조화된 로그만 남긴다. Slack 전송·필터·중복 억제는 앱 밖의 운영 경로에서 처리한다. 이메일은 사용하지 않는다.** AWS CloudWatch에 해당하는 역할을 여기서는 OCI Logging·Monitoring이 맡는다.

| 알림 | 주기·기준 | 전달 경로 |
| --- | --- | --- |
| 비용·사용량 요약 | 매일 09:13 한국 시각 | OCI Usage API → GitHub Actions → Slack Webhook |
| 비용·사용량 이상 | 6시간마다. 첫 양수 비용, 비용 증가, A1 보수적 월 예산 80% 이상, 일 사용량 급증 | 같은 비용 점검에서 새 이상만 전송 |
| 앱 오류 | 5분마다 `severityNumber >= 17`. INFO·WARN·일반 4xx 제외 | OCI Logging → GitHub Actions → 한국어 Slack 카드 |

비용 집계는 최대 48시간 늦을 수 있다. 전일 금액은 잠정치로 표시하고, 증감은 D-3·D-4의 24개 시간 구간이 모두 수신된 항목만 비교한다. 미집계를 0으로 보거나 다른 단위·통화를 합치지 않는다. 사용량 급증은 2배 이상이면서 CPU 12 OCPU시간·메모리 72 GB시간·해당 스토리지/전송 단위 1 이상의 증가가 있을 때 알린다. A1 운영 예산은 월 1,500 OCPU시간·9,000 GB시간으로 보수적으로 잡고 80%부터 10% 구간마다, 비용은 새 0.01 통화 단위 구간에 도달할 때 다시 알린다.

OCI 월 예산은 청구 통화 SGD 1로 설정했다. **예산과 알림은 자원을 중지하는 상한선이 아니다.** 무료 제공량·집계 지연·다른 자원 사용은 별도로 확인한다. [Cost Analysis 집계](https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/costanalysisoverview.htm)

**자체 로그 수집기 컨테이너는 두지 않는다.** 앱은 stdout/stderr에 한 줄 JSON만 출력한다. 기성 도구 조합을 다음처럼 구성한다.

`stdout/stderr → Docker syslog driver → 호스트 rsyslog → 호스트 로그 파일 → OCI Unified Monitoring Agent → OCI Logging`

Docker syslog 드라이버를 로컬 Unix 소켓에 연결하고 서비스별 tag를 붙인다. 호스트 rsyslog는 전체 메시지를 `apps.jsonl`, OTel 필드가 있는 구조화 로그를 `events.jsonl`에 기록한다. OCI에는 `events.jsonl`만 JSON으로 수집하고 30일 보관한다. OCI의 Custom Logs Monitoring 플러그인(Unified Monitoring Agent)은 공식 Log Directory·JSON parser 설정으로 이 파일을 읽는다. 앱이 파일 쓰기·로테이션·전송을 직접 구현하지 않는다. [Docker syslog](https://docs.docker.com/engine/logging/drivers/syslog/) · [rsyslog 출력 형식](https://docs.rsyslog.com/doc/configuration/templates.html) · [OCI 입력·파서](https://docs.oracle.com/en-us/iaas/Content/Logging/Concepts/log_inputs_and_parsers.htm)

OCI 호스트 에이전트는 Ubuntu 22.04·24.04 ARM을 지원한다. 플랫폼 이미지·플러그인 활성화, 대상 VM dynamic group과 log-content 권한, 수집 파일 접근 권한을 설정한다. UMA의 비공식 커스텀 Fluentd 수신 설정은 사용하지 않는다. Docker 기본 드라이버 목록에는 OCI 전용 드라이버가 없으므로 `awslogs`처럼 바로 연결된다고 가정하지 않는다. [OCI 에이전트·지원 OS](https://docs.oracle.com/en-us/iaas/Content/Logging/Concepts/agent_management.htm) · [설치](https://docs.oracle.com/en-us/iaas/Content/Logging/Task/installing_the_agent.htm) · [Docker 로그 드라이버](https://docs.docker.com/engine/logging/configure/)

호스트 로그 서비스는 컨테이너보다 먼저 시작한다. 로그 드라이버는 bounded non-blocking buffer를 사용하고 파일·spool·로테이션 크기를 제한한다. 버퍼가 차면 로그가 유실될 수 있음을 수용하며 업무 처리를 로그 전송 성공에 묶지 않는다. 기성 에이전트의 메모리·CPU는 호스트 예산에 포함해 실측한다. VM 장애 때 에이전트도 멈춘다. 초기 알림 범위는 기록된 앱 오류이며, 로그가 없는 전체 중단·지표 경보·15분 HTTP 점검은 후속 과제다. JSON 필드 보존과 오류 필터는 합성 로그로 검증한다.

앱 로그는 **OTel Logs Data Model에 매핑되는 한 줄 JSON**으로 통일한다. OTel은 논리 모델이며 이 stdout JSON을 OTLP 전송 형식이라고 부르지 않는다. ECS(Elastic Common Schema)는 별도 스키마이고 AWS ECS는 컨테이너 실행 환경이다. [OTel 로그 모델](https://opentelemetry.io/docs/specs/otel/logs/data-model/) · [Elastic ECS](https://www.elastic.co/docs/reference/ecs)

| OTel 모델 | 기록 기준 |
| --- | --- |
| Timestamp · SeverityText/Number · Body · EventName | 발생 시각·등급·짧은 메시지·이벤트 종류 |
| Resource | `service.name`, `service.version`, `deployment.environment.name` |
| TraceId · SpanId · TraceFlags | 실제 추적 문맥이 있을 때만 기록 |
| Attributes | 제품 필드는 `agent_wiki.*`: `event_id`, `request_id`, `job_id`, `attempt`, `error_code`, `retryable`, `duration_ms` |

제품 필드는 OTel 표준 속성이라고 부르지 않는다. 예: `SeverityText=ERROR`, `SeverityNumber=17`, `EventName=job_failed_terminal`, `Attributes[agent_wiki.job_id]=demo`, `Attributes[agent_wiki.retryable]=false`. Pino 등 로거의 고유 숫자 레벨을 그대로 SeverityNumber로 쓰지 않는다. 일반 6단계 매핑은 TRACE=1·DEBUG=5·INFO=9·WARN=13·ERROR=17·FATAL=21이다.

stdout JSON의 추적 필드는 최상위 `trace_id`, `span_id`, `trace_flags`에 소문자 16진수로 기록한다. HTTP·작업 메타데이터로 추적 문맥을 전달하며 임의의 요청 ID를 trace ID로 대체하지 않는다. 원문·프롬프트·토큰·민감한 예외 메시지는 제외한다. 구현 시 로거의 JSON 매핑과 OCI 필터 경로를 함께 검증한다. [OTel 비 OTLP JSON 추적 필드](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)

재시도 중 일시 오류는 WARN, 최종 실패·API 서버 오류는 ERROR로 기록한다. 오류 점검은 최근 24시간을 다시 조회하며, event ID와 서비스·이벤트·오류 코드별 마지막 알림 시각을 원문 버킷의 운영 체크포인트 한 개에 저장한다. 같은 이벤트는 다시 보내지 않고, 같은 종류의 새 오류는 최대 시간당 한 번 알린다. 전송 실패는 성공으로 기록하지 않는다. 전송 뒤 체크포인트 저장에 실패하면 중복 알림이 생길 수 있다.

### Slack 전달 경계

GitHub Actions가 **한국어 제목·핵심 수치·발생 시각·확인 버튼**을 가진 Block Kit 카드를 Incoming Webhook으로 전송한다. 앱에는 Slack 코드나 비밀을 넣지 않는다. 비밀·원문·프롬프트·예외 본문은 카드에 싣지 않고 허용한 운영 필드만 전달한다. 429·일시 오류는 유한 재시도한다.

OCI 기본 Slack 전달은 원본 JSON 형태여서 한국어 카드에 맞지 않았다. 시험용 Notifications 구독은 유지하되 Connector Hub는 `INACTIVE`로 두어 중복 원본 전송을 막는다. 별도 알림 Function은 만들지 않는다. [OCI 전달 형식](https://docs.oracle.com/en-us/iaas/Content/connector-hub/message-examples.htm)

전용 OCI 계정은 비용 조회·해당 로그 그룹 읽기·운영 체크포인트 한 개의 읽기/쓰기만 허용한다. VM 생성·삭제, Wiki 원문 읽기, 콘솔 로그인 권한은 없다. 비용·오류 Actions는 같은 concurrency 그룹과 객체 조건부 쓰기로 체크포인트 충돌을 막는다. 로컬 비밀은 `.env.local`에서 비공개 설정 파일 경로를 가리키고, 실행 비밀은 GitHub `production` 환경에 둔다.

Actions 예약은 지연되거나 누락될 수 있다. 공개 저장소의 장기 비활동으로 예약이 비활성화될 수도 있다. 오류의 24시간 재조회로 짧은 누락은 보완하지만 실시간·무손실 경보를 보장하지 않는다. 점검 실행 오류도 Slack에 요약하지만 실행 자체가 시작되지 않거나 Slack이 장애면 전달할 수 없다. [Actions 예약 제한](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 백업·복구

초기 범위에서 제외한다. 예약 백업·전용 버킷·백업 알림·복원 절차는 필요해지면 함께 검토한다.

## 규모가 커질 때

| 관찰 | 우선 조정 |
| --- | --- |
| Worker가 웹 응답에 영향 | CPU 상한·동시성·처리 시간대 조정, 필요 시 Worker 실행 호스트 분리 |
| DB·검색 지연 | 쿼리·인덱스·연결 수·PostgreSQL 통계·공유 VM 지표 확인 후 무료 범위 내 사용량 조정 |
| 메모리·저장량 증가 | 입력 크기·보관 정책·로그 조정 |
| 무중단 배포 필요 | 복수 앱 실행·라우팅·추가 자원과 DB 가용성 설계 |
| 처리량이 무료 사용량 초과 | 사용량을 제한하고 무료 범위 내 구성 재검토 |

실증 순서는 **계정·예산 확인 → 합성 자료로 배포·기본 기능 확인 → 사용량 확인 → 개인 원문**이다. Terraform·Compose·배포 스크립트와 앱 코드가 있으며, 첫 앱 배포는 완료했으며 외부 알림 연결 검증은 남아 있다.

## 레퍼런스에서 가져올 요소

2026-09-12 확인 기준이다. 각 사례의 아이디어를 제품에 맞게 조합하며, 해당 도구의 채택을 의미하지 않는다.

| 자료 | 참고할 요소 | 제품에 적용할 방향 |
| --- | --- | --- |
| [Karpathy 원문](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) | 원본·정리된 위키·운영 규칙의 분리, 새 자료에 따른 기존 지식 갱신 | 출처를 보존하고 지식을 누적해서 관리 |
| [여기어때 - AI가 내 하루를 기억하게 하는 법 (1/2)](https://medium.com/p/dd6a3158d9a0) | 사람이 탐색할 목차와 문서 연결, 과거 지식의 현재 유효성 확인 | 읽기 쉬운 지식 구조와 근거·확인 시점 제공 |
| [여기어때 - AI가 내 하루를 기억하게 하는 법 (2/2)](https://medium.com/p/595f8a2a7c3a) | 일별 기록이 위키에 들어오는 반복 흐름, 완료 판단에 대한 사용자 확인 | 기록 수집은 자동화하고 중요한 해석을 확인 |
| [NAVER D2 발표 소개](https://d2.naver.com/helloworld/7056385) | 업무 자산을 수집해 사람과 AI에게 맥락으로 제공 | 다음 작업에 필요한 정보를 찾아주는 Context Provider |
| [Obsidian 플러그인](https://community.obsidian.md/plugins/karpathywiki) | 문서 연결을 통한 탐색과 관련 지식 검색 | 지식 페이지에서 결정의 배경과 관련 기록으로 이동 |
| [커뮤니티 Wiki Skill](https://github.com/sdyckjq-lab/llm-wiki-skill) | 추출·추론·미확인 내용의 구분, 대화에서 재사용할 지식 추출 | 지식의 근거 상태를 표시하고 AI 작업 결과를 다시 검토 |

원본 링크와 사용자 메모는 [레퍼런스 목록](README.md#레퍼런스)에 보존한다. NAVER의 OpenMetadata 활용은 사용자 제공 메모이며, 위 표는 공식 발표 소개에서 확인한 범위다. GeekNews 글은 Karpathy 원문을 소개하는 자료로 함께 참고한다.

## Workspace와 사용자 흐름

하나의 기록·지식 페이지는 하나의 Workspace에 속한다. 수집·DB 권한·검색·관계 확장·AI 대화·캐시 모두 같은 경계를 적용한다. 업무와 취미에 같은 태그가 있어도 자료를 합치지 않으며, 공간 전환 시 이전 대화 맥락을 넘기지 않는다.

Folder는 문서의 기본 위치 하나, Tag는 프로젝트·주제별 다중 분류로 사용한다. 별도 Label 개념은 추가하지 않는다. 첫 예시는 Workspace `개인 작업` / Folder `개발 기록` / Tags `agent-observatory`, `agent-wiki`, `아키텍처`다. `agent-observatory`는 제품 계보를 묶는 태그이며 독립 제품 경계를 바꾸지 않는다. 현재 다중 태그 저장은 구현돼 있고 검색 필터는 태그 하나만 받는다. 여러 태그의 AND 조합 조회는 후속 제안이다. [첫 지식 묶음과 분류 예시](project-history.md#공간과-분류)

웹은 아래 관리·검토 화면을 제공한다. 기본 진입점은 에이전트의 근거 조회이며 웹 방문을 요구하지 않는다.

| 보조 화면 | 역할 | 결제 업무 예시 |
| --- | --- | --- |
| 기록 | 날짜별 작업·남은 일을 Article로 정리 | 결제 재시도 오류 조사·수정 기록 |
| 지식 | 주제별 결정·제약을 읽고 편집 | 결제 재시도 정책과 중복 결제 방지 조건 |
| 확인함 | 미분류 자료·중요 해석·충돌 검토 | 정책 확정과 구현 완료 여부 구분 |

일반 기록은 자동 정리하고 중요한 결정·모순·불확실한 해석을 확인함에 모은다. 사용자 결정·관찰·AI 해석·미확인을 구분하며, 에이전트의 완료 발언이나 같은 주장의 반복을 검증 근거로 삼지 않는다. 일별 Article과 시스템 실행 이력인 Log는 구분한다.

에이전트가 반환받은 인용에서 사용자는 필요할 때 웹의 근거·개정으로 이동한다. 웹에서도 같은 권한으로 Context를 확인할 수 있다. CLI·Skill·MCP 제공 방식은 미확정이다.

## 첫 배포 다음 작업

**다음 우선순위 제안은 실제 질문 → Wiki 조회 → 근거를 인용한 에이전트 답변이다.** 비용·오류 알림은 별도 작업에서 진행하며, 여기서는 제품 사용 흐름을 다룬다. 아래 순서는 후속 구현 제안이며 완료 상태가 아니다.

| 순서 | 작업 | 완료를 확인할 예 |
| --- | --- | --- |
| 1 | 현재 결정·제약·남은 일을 검토해 작은 지식 묶음을 만들고 에이전트 조회 연결 | 웹을 열지 않고 “현재 배포 구성과 선택 이유는?”에 답하고 출처를 인용한다. 우선 기존 HTTP API를 호출하는 얇은 CLI·Skill 구성을 검토한다. |
| 2 | 질문에 맞는 발췌·인용 개정 보완 | 긴 문서 후반부의 근거도 반환하고, 인용을 열면 답변 당시 개정을 확인한다. 자료가 없거나 상충하면 그 상태를 명시한다. |
| 3 | NVIDIA 수집 경로의 실제 성공 확인 | 비기밀 합성 자료 하나가 원문 저장 → 추출 → 인용 검증 → 후보 문서 → 검색까지 이어진다. 응답 지연·타임아웃·모델 대체를 구분해 확인한다. |
| 4 | 선택한 기록을 반복해서 넣는 작은 수집 흐름 | 사용자가 선택한 문서·메모를 중복 없이 접수하고, 웹에서 정정한 결과가 다음 질답에 반영된다. 세션 전체 자동 수집과 자동 병합은 나중에 판단한다. |

현재 코드와 목표의 차이는 다음과 같다.

- 조회 API와 Workspace 전용 `read` 키, 웹의 curl 예제는 있다. 실제 에이전트 도구 연결은 아직 없다. MCP는 여러 클라이언트 연동 필요성이 확인되면 평가한다.
- Context는 검색 상위 6개 문서의 앞 2,000자를 반환한다. 질문 주변 발췌·연결 문서 확장은 아직 없으며, URL은 현재 문서를 연다. 응답에는 개정 번호가 있고 별도 개정 조회 API도 있다.
- NVIDIA 수집은 새 Article·Memory 후보를 만들며 기존 문서를 자동 병합하지 않는다. 실제 외부 추출 성공 전에도 직접 작성한 지식의 검색·조회는 사용할 수 있다.

첫 실사용 자료는 [Atlas → Sessions → 독립 Wiki의 역사와 결정 5개](project-history.md)로 제안한다. 직접 검토한 Article로 시작해 NVIDIA 추출 성공과 별개로 조회 흐름을 확인한다. 대표 질문은 계보·검색 선택·인프라 결정·실제 완료 상태·근거 없음으로 구성하고, 정정 후 재조회도 확인한다. 접근 키는 로컬 비밀 설정에 두고, Workspace 경계를 유지한다. 실제 자료 업로드는 이 문서 작성에 포함되지 않는다.

## 첫 실증의 성공 기준

> 일주일 뒤 프로젝트를 다시 시작할 때 AI가 이전 결정·현재 제약·남은 일을 이해하고, 다른 Workspace의 기록은 전달되지 않는다.

| 확인 | 통과 조건 |
| --- | --- |
| 에이전트 조회 | 웹을 열지 않고 질문에 맞는 근거·현재 결정·출처를 받아 답변과 작업에 사용 |
| 축적·갱신 | 새 기록을 기존 지식에 연결하고 현재 결정·대체 관계 구분 |
| 근거·편집 | 검색 결과에서 Source·실행·개정 추적, 웹 편집 충돌 감지 |
| 격리 | UI·API·검색·관계·AI Context에서 다른 Workspace 자료 제외 |
| 정정·삭제·중복 | 잘못된 완료 판단·중복 접수·삭제가 후속 검색과 Context에 반영 |
| 운영 | 기본 기능·알림 수신·월 사용량 확인 |

구현 전 계정·리전 가용성·전체 비용, 도메인·인증·보관 기간과 NVIDIA 데이터 전송 조건을 확인한다.
