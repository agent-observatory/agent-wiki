# Agent Wiki 작업 원칙

## 시작과 범위

- 먼저 [docs/README.md](docs/README.md), [아키텍처](docs/architecture.md)를 읽는다. 정제·청킹·기억 통합 작업 전에는 [L2·L3 기억 설계](docs/l2-l3-memory.md)을 읽는다. 디자인 작업 전에는 [docs/DESIGN.md](docs/DESIGN.md)를 읽는다.
- 제품은 독립 Agent Wiki다. 설계·구현·검증·실제 배포 상태는 `docs/OPERATIONS.md`에 구분해서 기록한다.
- 기존 Agent Observatory의 Sessions는 참고 구현이다. 포털 통합·세션 평가 기능과 기존 Collector·계약·DB·하위 호환성을 새 제품의 제약으로 삼지 않는다.
- 사용자와 정한 독립 제품 방향이 이관 문서의 오래된 전제보다 우선한다. 설계 변경은 관련 문서와 그림에 함께 반영한다.
- 작업 전 관련 파일과 `git status --short`를 확인하고 사용자 변경을 보존한다. 원본 저장소는 수정하거나 삭제하지 않는다.
- 사용자는 2026-09-12에 첫 버전 구현·무료 범위 배포·GitHub push·Actions 구성·문서 수정을 승인했다.
- 현재 첫 배포 작업의 커밋·푸시와 GitHub Actions 구성은 승인되어 있다. 이후 작업은 해당 요청 범위를 따른다.

## 현재 작업 모드

- 웹 UI는 데스크톱 전용으로 설계·검증한다. 모바일 대응·모바일 브라우저 검증은 작업 범위에 두지 않는다.

- 개인 위키의 실제 세션 규모를 기준으로 개선한다. 대규모 서비스 가정·상시 부하 실험·불필요한 분산 구성보다 수집·정제·조회 정확성과 간단한 운영을 우선한다.

- **개발 모드**다. 사용자가 운영 모드라고 선언할 때까지 Wiki DB·원문·지식·개정·큐·API 키를 초기화하거나 새로 설계해도 된다. 데이터 보존·구 API·옛 ID·하위 호환성은 요구하지 않는다. 해당 구현 범위의 초기화를 다시 승인받을 필요는 없다.
- 현재 메뉴는 L3 · Knowledge → L1–L2 · Sources → 설정 순서다. Sources는 Curation·수집 상태·Raw Sources 순서(기본 Curation), Knowledge는 지식 목록·반영 이력을 포함한다. L1·L2 내부 책임은 유지하며 페이지·검색 조건을 URL로 유지한다. UI는 shadcn을 기본으로 한다.
- 현재 구조는 읽기 전용 Collector·원격 Worker 정제·Wiki 저장·조회다. 사용자가 이 구조의 구현을 승인했다. [수집·정제 계약](docs/client-and-api.md)을 따른다. [운영 현황](docs/OPERATIONS.md)을 따른다.
- 개발 모드도 유료 자원 생성·비밀 유출을 허용하지 않는다. VM·인증서·OAuth·모니터링은 재사용하며 공용 버킷의 운영 체크포인트와 로컬 비밀 설정을 Wiki 데이터와 혼동하지 않는다.

## 프로젝트 기억 사용

- 설치 패키지는 `packages/agent-wiki-client` 하나다. 조회 Skill은 사용 지침, Wiki CLI는 검색 실행, Collector는 별도 백그라운드 프로세스다. 설정은 `~/.agent-wiki/config.json`을 공유한다. 설치·연결 명령은 `docs/client-and-api.md`에만 상세히 기록한다.
- Collector 기본 범위는 전체 프로젝트·주기는 10분이다. 현재 검증 환경은 Agent Wiki 프로젝트로 제한하며, 통합·갱신 때 기존 기기 식별자와 전송 상태를 보존한다.

- 이전 결정·근거가 작업에 필요하거나 사용자가 요청할 때 Wiki를 조회한다. 시작·종료·컴팩션마다 `recall`을 강제하지 않는다. CLI는 `agent-wiki` 또는 `node packages/agent-wiki-client/cli/agent-wiki.mjs`를 사용한다.
- 활성 작업 대화에서 자동 수집·군집화·정제를 수행하지 않는다. 사용자에게 매번 원문 등록·정제·반영을 시키거나 자동 훅으로 응답을 기다리게 하지 않는다.
- 세션은 Workspace·에이전트 종류·원본 세션 ID로 식별하고 기기·파일 세대별 수신 위치를 분리한다. Collector가 대화·도구 기록을 선별하고 컴팩션 중복·실행 메타데이터를 제외한 증분을 마스킹·zstd 압축해 OCI PAR로 직접 업로드하고 서버가 검증·중복 판정·불변 L1 등록 후 수신 위치를 확정한다.
- 원문 수집은 읽기 전용 Collector, 정제는 별도 백그라운드 실행의 책임이다. 작업 세션과 독립된 프로세스로 실행한다. 명시적으로 현재 대화의 기록을 요청한 경우에만 수동 반영하며 `packages/agent-wiki-client/skill/SKILL.md`의 근거 계약을 따른다.
- 프로젝트 역사·리니지는 원격 Wiki에 쌓는다. 로컬에는 제품 설계·개발·운영 문서와 연결·전송 상태만 두고 같은 역사를 중복 관리하지 않는다. 원격 조회 실패·미반영과 자료 없음·완료를 구분한다.

## 제품과 데이터

- L1 Raw Sources → L2 Curation → L3 Knowledge → L4 Query → L5 Answers는 우리 제품 설계이며 외부 공식 표준이 아니다.
- 세션은 여러 원천 자료 중 하나다. 주 용례는 에이전트가 질답·작업 중 근거 자료를 조회하는 것이다. 웹 위키는 지식·근거·검토 결과·진행 상태를 읽는 뷰어다. 제품 변경·검토 확정은 CLI에서 실행한다. AI 연결 설정·Hello 테스트는 CLI와 웹에서 같은 API로 제공한다. 자동 정제 중지·재개는 CLI와 웹 Curation에서 같은 API로 실행한다. 검색 API와 인용 가능한 Context를 우선 설계하며 웹 방문량을 제품 가치의 기준으로 삼지 않는다.
- L3의 Claim은 근거·상태·적용 범위 단위이며 Decision은 사용자 결정 Claim이다. Wiki Page는 세션과 독립된 주제별 Claim·Decision History를 모은 불변 Version이다. 웹 목록은 Wiki Page, 조회·검토는 근거가 연결된 Claim을 기준으로 한다. 자동 조립을 검토 완료로 확정하지 않는다.
- Workspace는 자료·지식·권한·검색·AI 맥락의 격리 단위다. Folder·Tag는 Workspace 내부 분류이며 권한 경계를 대신하지 않는다.
- L4 단계적 조회는 `query search/claim/source/trace`를 사용한다. 필드별 BM25 후보 → Claim의 고정 Version·상태·관계 → 원문 구간 순으로 필요한 만큼 읽는다. 같은 질문은 traceId를 유지하고 최대 12단계·64,000자 한도를 새 ID로 우회하지 않는다. 서버 반환량과 L5 토큰을 구분하며 조회로 정제·검토 확정을 시작하지 않는다.
- 초기 검색은 키워드·Folder·Tag·용어집 별칭·명시적인 문서 연결을 사용한다. 임베딩·pgvector는 후속 후보이며 외부 API 또는 사용자가 제시한 Comsat 모델을 평가한다. 일반 검색·Context 구성과 지식 추출용 LLM 호출을 구분한다.
- 출처·확인 시점·개정·파생 관계를 보존한다. 사용자 결정, 관찰, AI 해석, 미확인 내용을 구분하고 에이전트의 완료 발언을 검증 결과로 취급하지 않는다.
- 앱 코드·인증 파일·환경변수 값·실제 세션·로컬 상태·Vercel 연결 설정·운영 리소스 식별자를 원본에서 복사하지 않는다. 예제와 검증에는 합성 자료를 사용한다.

- 지식 정제·추론은 작업 대화와 별도 실행에 둔다. 원격 Worker가 외부 AI API를 호출하며 사용자가 연결한 BYOK 모델로 텍스트를 대화 구조·토큰 예산에 맞춰 정제한다. DeepSeek Pro 재검토·Kimi K3 교체는 설정으로 선택하며 모든 청크를 자동 이중 호출하지 않는다. 이미지 본문·URL은 AI에 보내지 않고 분석 생략 범위를 남긴다. Workspace별 키·모델·한도·활성 여부와 당시 실행 설정을 보존한다. 일반 조회는 모델을 호출하지 않는다.

## 인프라

- OCI A1 Compute VM 1대·2 OCPU·12GB는 유지한다. K3s가 Traefik·Web·API·Worker·PostgreSQL을 관리한다. CPU는 공유하며 Worker는 최대 1 CPU·2GiB, BYOK는 Workspace별 최대 5로 제한한다.
- 부트 50GB·별도 Block Volume 50GB를 사용한다. 영속 볼륨의 별도 경로에 PostgreSQL local PV와 K3s 상태(SQLite·TLS Secrets)를 둔다. 원문은 비공개 Object Storage 버킷 1개에 저장한다. TLS는 cert-manager와 Kubernetes Secret으로 관리하며 인증서 버킷은 두지 않는다.
- 무료 범위만 사용한다. 사용자가 PAYG 업그레이드를 직접 완료했다. 유료 자원·무료 한도 초과·체험 크레딧 사용은 승인되지 않았다. 월 A1 1,500 OCPU시간·9,000 GB시간과 계정 전체 스토리지·네트워크·운영 서비스 한도를 확인한다.
- Terraform은 OCI 인프라, cloud-init은 OS·마운트 최초 구성, systemd는 K3s 기동, K3s는 컨테이너 실행을 관리한다. OS·K3s·DB 업데이트는 우리가 맡는다. Pod 10.52/16·Service 10.53/16은 OCI VCN 10.42/16과 분리한다.
- 외부에서 ARM64 이미지를 빌드·게시하고 VM이 미리 pull한다. 일반 배포는 `scripts/deploy-k3s.sh`로 migration Job·Deployment 교체·HTTPS를 확인한다. Web/API는 롤링 교체, Worker는 Recreate다. VM·DB·Traefik·PVC/PV를 유지한다. 짧은 앱 중단은 허용하고 DB 변경의 잠금을 판단한다. 개발 모드의 일괄 교체는 데이터 초기화를 허용한다.
- Pod 간에는 Kubernetes Service 이름을 사용하며 localhost를 공유한다고 가정하지 않는다. 웹·API 포트는 내부 전용이다. DB 관리 도구는 VM 공인 5432에 IP 제한·Bastion·SSH 터널 없이 별도 ID/비밀번호·TLS로 연결한다. 실제 정보는 구성 시 `.env.local`에 기록한다.
- 이전 분리 설계는 `docs/archive/container-instances/`에 보존한다. 그 폴더의 사양·지침은 현재 운영안이 아니다. 운영 데이터 백업과 구분한다.
- 실제 구축 전 최신 공식 조건·계정 자격·전체 사용량·월 비용을 확인한다. PAYG 계정 전환과 자원 과금 승인을 구분한다. 자원 생성은 사용자가 승인한 첫 배포의 무료 범위만 허용한다.
- 사이드 프로젝트 수준으로 운영한다. 백업·복원 설계는 후속 과제로 미루며 초기 범위에 예약 백업·백업 버킷·백업 알림을 두지 않는다. 정기 복구 훈련·상시 부하 테스트는 하지 않는다.
- 초기 모니터링은 비용·사용량 정기 요약과 앱 오류 알림이다. 앱은 OTel Logs Data Model에 매핑되는 JSON을 stdout/stderr에 출력한다. 제품별 속성은 `agent_wiki.*`로 구분하며 ECS·OTLP와 혼동하지 않는다. containerd CRI 로그·호스트 rsyslog·OCI Unified Monitoring Agent가 구조화 로그를 OCI Logging으로 보낸다. 오류는 OCI Logging → Connector Hub의 ERROR 이상 필터 → Monitoring 경보 → Notifications → Slack으로 전달한다. 사용자 선택에 따라 OCI 기본 경보 형식과 오류 감지·경보 해제·RESET 상태 변경을 사용하고 주기적인 반복은 보내지 않는다. 경보 해제를 앱 복구 확인으로 표현하지 않는다. 오류 알림용 GitHub 예약 조회는 사용하지 않는다. GitHub Actions는 비용을 6시간마다 조회하고 매일 09:13 한국 시각에 비용·사용량 요약을 보낸다. 자체 수집기 컨테이너·알림 Function·알림 전용 서버는 두지 않는다. 실제 배포 상태는 운영 현황을 따른다. 원본 JSON을 Slack에 직접 전달하지 않는다. API·Worker에는 Slack 토큰·전송 코드를 두지 않는다. 이메일은 사용하지 않는다. 실제 데이터·프롬프트·비밀은 운영 로그에 남기지 않는다. 예산은 강제 차단이 아니며 집계와 예약 실행은 지연될 수 있다. 전체 중단·CPU·디스크·HTTP 상태 경보는 후속 과제다.
- Web/API는 readiness와 5초 preStop 이후 SIGTERM에서 진행 요청·DB 연결 순으로 종료한다. Worker는 신규 작업 수신을 멈추고 최대 90초 동안 결과를 마친다. K3s Worker 종료 유예는 120초, API/Web은 45초다. 개인 개발 서비스는 전체 중단을 허용한다. K3s 전환 이후 Compose 호환·복귀 경로를 유지하지 않는다. 일반 배포는 DB를 교체하지 않는다.

- 내부 조회는 일시 오류에만 deadline·backoff+jitter·최대 2회 추가 시도를 적용한다. 쓰기는 멱등 키·payload 일치·기존 결과 확인 없이 재전송하지 않는다. DB 연결 재생성과 트랜잭션 재실행을 구분하고 COMMIT 응답 유실은 결과부터 확인한다. 중첩 재시도와 종료 기한 뒤 새 호출을 막는다.
- 정제 큐는 PostgreSQL 작업 테이블의 상태·임대로 관리한다. 모델 호출 제한(`timeoutSeconds`)은 모델 1·모델 2 슬롯마다 60~900초 범위에서 독립적으로 설정하며 기본값은 330초다. 임대 시간은 호출 중인 슬롯의 `timeoutSeconds`에 여유 120초를 더한 값과 420초 중 더 큰 쪽으로 자동 계산해 항상 호출 제한보다 길게 유지한다. requestsPerMinute·concurrency(최대 5)·retryDelaySeconds·dailyCalls는 두 모델이 공유하며 BYOK만 제공하고 현재는 20 RPM·최대 5·30~36초다. 같은 세션은 순차 처리하고 서로 다른 세션만 병렬 처리한다. 키별 호출 간격에는 결과 폴링도 포함한다. 일시 오류는 키 전체가 설정된 시간만큼 대기한 뒤 계속 재시도한다. 실패 횟수로 지수 증가시키지 않으며 제공자 Retry-After에 5초를 더한 시각과 기본 대기 중 더 늦은 시각을 지킨다. 일일 한도도 지킨다. 키별 대기 시각과 청크 진행 위치는 DB에 보관한다. 모델 인용 불일치·잘못된 JSON·주장 범위 불일치는 검증을 유지하고 해당 청크의 출력 캐시를 비운 뒤 120~144초 후 새 응답으로 재정제한다. 같은 청크·세대의 동일 출력 오류가 3회 연속이면 확인 필요로 남긴다. 이전 실패 인용을 참고 정보로 전달하고 실행 이력·성공 청크는 보존한다. 제공자 장애와 달리 키 전체를 대기시키지 않는다. 인증·원문 무결성·기타 입력 오류는 확인 필요 상태로 남긴다. 같은 세션의 미처리 원문은 최대 32개·4,096행 묶음으로 고정해 청킹하며 새 도착분은 다음 묶음으로 보낸다. 원문별 행은 처리 범위 장부로 유지하고 대표 작업만 실행한다. 모델 호출 생략·반영 재실행은 호출 목록·호출 수에서 제외한다. Collector 기록 위치와 정제 작업 상태를 구분하고 결과 커밋 뒤 완료, 멱등 반영, 종료 유예를 지킨다. 로그만 남기고 작업 오류를 삼키지 않는다. 관계만 실패한 반영(대상 Version 변경·이미 대체됨)은 추출을 버리지 않고 주장을 반영한 뒤 그 관계를 주제의 통합 대기함에 명시적으로 넘겨 다음 Consolidation에서 판단한다. 조용히 버리거나 몰래 재생성하지 않는다. Consolidation·리니지 패널·`relation reject`는 `docs/l2-l3-memory.md`의 설계대로 구현·배포했다. 실제 세션 자료로의 운영 검증과 그림 갱신은 아직이며 `docs/OPERATIONS.md`를 따른다.
- 설계, 파일 작성, 로컬 검증, 자원 생성, 배포, 운영 검증을 구분해 보고한다.
- 로컬 서비스 토큰은 루트 `.env.local`에 보관하고 Git에서 제외한다. `.env.example`에는 변수 이름과 비밀이 아닌 기본값만 둔다. 토큰 값을 출력하거나 문서·그림에 넣지 않는다.

## 문서와 그림

- 전체 구조는 `docs/architecture.md`, 증분 맥락·청킹·주장 관계·리랭킹 실험 설계는 `docs/l2-l3-memory.md`, 설치·수집/API 계약은 `docs/client-and-api.md`에 둔다. 사람은 그림 중심으로 읽고 구현 에이전트는 접힌 규칙을 읽는다. 실행·검증 상태는 운영 현황에만 기록하고 목표 그림에 진행 상태 배지를 붙이지 않는다.

- 계층 이름은 L1 · Raw Sources, L2 · Curation, L3 · Knowledge, L4 · Query, L5 · Answers로 통일한다. 메뉴·제목·그림에는 같은 영어 이름을 쓰고 설명은 한국어로 쓸 수 있다. 웹·그림의 공통 이름 정의는 `apps/agent-wiki-web/lib/layer-names.json`이며 아키텍처의 계층 표와 함께 갱신한다.

- 웹 UI의 기본은 shadcn/ui 공식 컴포넌트·Blocks·Neutral 테마다. Radix 계열·Lucide·공통 CSS 토큰으로 통일하고 필요한 컴포넌트만 조합한다. 세부 적용은 `docs/DESIGN.md`를 따른다. 아래 SVG 아이콘·색상 규칙은 문서 그림에 적용한다.

- README는 간결한 영어로, 상세 docs는 한국어로 작성할 수 있다. 문서를 과도하게 나누지 않고 그림·표·구체적인 입력과 출력 예제로 설명한다.
- 상시 설계 문서와 그림 파일명에는 날짜를 넣지 않는다. 외부 자료의 확인 시점과 검증 한계는 본문에 남긴다.
- SVG는 `docs/assets/wiki-*.svg`, 아이콘은 `docs/assets/icons/`에 둔다. 이동 시 상대 링크·이미지·생성기 경로도 함께 갱신한다.
- 흰 캔버스·파스텔 컴포넌트·남색 글자·직교 연결선을 사용한다. SVG의 text/tspan을 편집 가능하게 유지하고 Noto Sans KR 고정 굵기 Regular(400)·Bold(700)를 사용한다.
- 아이콘 출처는 Tech Stack Icons → techicons.dev → Simple Icons 순서다. 일반 기능 기호는 출처가 있는 Tabler 아이콘을 사용하고 출처·라이선스를 보존한다.
- 그림 수정은 `scripts/generate-wiki-diagrams.py`에도 반영한다. 저장소 루트에서 재생성하고 XML·상대 링크 검사와 실제 렌더링의 겹침·잘림 확인을 구분한다.
- Codex 오른쪽 미리보기는 자동으로 열지 않는다.

- 현재 사용자 제약: Claude Collector는 전체 비활성화, Codex는 Agent Wiki 프로젝트만 수집한다. 자동 정제는 명시적인 재개 요청까지 중지한다. 검토는 Skill·CLI에서 수행하며 사용자 승인 없이 검토 완료로 확정하지 않는다.

- 분석 개선은 전체 초기화보다 선택 Reprocess 후보·검토·정정을 우선한다. Retry·Reprocess·Reassemble의 계약은 architecture.md와 client-and-api.md를 따른다. 후보 생성은 지식 반영·검토 완료가 아니며 분석 정정과 사용자 결정 변경을 구분한다.
- 사용자 명령 없이 정제 시작·중지하지 않는다. 사용자 요청한 Alibaba 무료 할당량 소진 안전 중지는 예외이며, 사용자가 설정한 2번 모델(`fallback` 슬롯, 최대 1개, 즉 1·2번 합쳐 총 2개 모델까지)로의 전환만 자동이다. 그 밖의 모델·제공자 전환과 자동 재개는 하지 않는다. 배포·설정 저장·Hello·페이지 재조립은 enabled를 변경하지 않는다.
