# Agent Wiki 작업 원칙

## 시작과 범위

- 먼저 [docs/README.md](docs/README.md), [Wiki 문서 안내](docs/wiki/README.md), [아키텍처](docs/wiki/architecture.md)를 읽는다. 디자인 작업 전에는 [docs/DESIGN.md](docs/DESIGN.md)를 읽는다.
- 제품은 독립 Agent Wiki다. 설계·구현·검증·실제 배포 상태는 `docs/OPERATIONS.md`에 구분해서 기록한다.
- 기존 Agent Observatory의 Sessions는 참고 구현이다. 포털 통합·세션 평가 기능과 기존 Collector·계약·DB·하위 호환성을 새 제품의 제약으로 삼지 않는다.
- 사용자와 정한 독립 제품 방향이 이관 문서의 오래된 전제보다 우선한다. 설계 변경은 관련 문서와 그림에 함께 반영한다.
- 작업 전 관련 파일과 `git status --short`를 확인하고 사용자 변경을 보존한다. 원본 저장소는 수정하거나 삭제하지 않는다.
- 사용자는 2026-09-12에 첫 버전 구현·무료 범위 배포·GitHub push·Actions 구성·문서 수정을 승인했다.
- 현재 첫 배포 작업의 커밋·푸시와 GitHub Actions 구성은 승인되어 있다. 이후 작업은 해당 요청 범위를 따른다.

## 제품과 데이터

- L1 Raw sources → L2 Ingest → L3 Wiki → L4 Query → L5 Answers는 우리 제품 설계이며 외부 공식 표준이 아니다.
- 세션은 여러 원천 자료 중 하나다. 주 용례는 에이전트가 질답·작업 중 근거 자료를 조회하는 것이다. 웹 위키는 지식 편집·정정·근거 확인을 위한 보조 화면이다. 검색 API와 인용 가능한 Context를 우선 설계하며 웹 방문량을 제품 가치의 기준으로 삼지 않는다.
- Workspace는 자료·지식·권한·검색·AI 맥락의 격리 단위다. Folder·Tag는 Workspace 내부 분류이며 권한 경계를 대신하지 않는다.
- 초기 검색은 키워드·Folder·Tag·용어집 별칭·명시적인 문서 연결을 사용한다. 임베딩·pgvector는 후속 후보이며 외부 API 또는 사용자가 제시한 Comsat 모델을 평가한다. 일반 검색·Context 구성과 지식 추출용 LLM 호출을 구분한다.
- 출처·확인 시점·개정·파생 관계를 보존한다. 사용자 결정, 관찰, AI 해석, 미확인 내용을 구분하고 에이전트의 완료 발언을 검증 결과로 취급하지 않는다.
- 앱 코드·인증 파일·환경변수 값·실제 세션·로컬 상태·Vercel 연결 설정·운영 리소스 식별자를 원본에서 복사하지 않는다. 예제와 검증에는 합성 자료를 사용한다.

- 지식 추출·정리용 LLM은 NVIDIA의 Kimi K3를 기본으로, DeepSeek Pro를 대체로 사용한다. 정확한 ID·쿼타 대응·데이터 전송 조건은 아키텍처를 따른다. API 키·실제 추론 검증 여부를 구분한다.

## 인프라

- 현재는 OCI A1 Compute VM 1대·2 OCPU·12GB에 앱과 PostgreSQL을 함께 둔다. Docker Compose로 Caddy·Next.js·API·Worker·PostgreSQL 5개를 관리한다. CPU는 공유하고 Worker만 최대 0.5 CPU·동시성 1로 시작한다.
- 부트 50GB·별도 Block Volume 50GB를 사용한다. 영속 볼륨의 별도 경로에 PostgreSQL 데이터와 Caddy `/data`·`/config`를 둔다. 원문은 비공개 Object Storage 버킷 1개에 저장한다. Caddy S3 모듈·인증서 버킷·Customer Secret Key는 필요 없다.
- 무료 범위만 사용한다. PAYG 전환·유료 자원·체험 크레딧 사용은 금지한다. 월 A1 1,500 OCPU시간·9,000 GB시간과 계정 전체 스토리지·네트워크·운영 서비스 한도를 확인한다.
- Terraform은 OCI 인프라, cloud-init은 Docker·마운트 최초 구성, systemd는 부팅 시 기동, Compose는 컨테이너 실행을 관리한다. OS·Docker·DB 업데이트는 우리가 맡는다.
- 외부에서 ARM64 이미지를 빌드·게시하고 VM이 미리 pull한다. 일반 배포는 변경된 앱 서비스만 `up -d --no-deps --no-build --wait`로 교체한다. VM·DB·Caddy는 유지하며 전체 `compose down`·볼륨 삭제는 하지 않는다. 짧은 앱 중단은 허용하고 DB 변경은 호환성·잠금을 별도로 판단한다.
- 컨테이너 간에는 Compose 서비스 이름을 사용하며 localhost를 공유한다고 가정하지 않는다. 웹·API 포트는 내부 전용이다. DataGrip은 VM 공인 5432에 IP 제한·Bastion·SSH 터널 없이 별도 ID/비밀번호·TLS로 연결한다. 실제 정보는 구성 시 `.env.local`에 기록한다.
- 이전 분리 설계는 `docs/archive/container-instances/`에 보존한다. 그 폴더의 사양·지침은 현재 운영안이 아니다. 운영 데이터 백업과 구분한다.
- 실제 구축 전 최신 공식 조건·계정 자격·전체 사용량·월 비용을 확인한다. 계정 업그레이드는 승인되지 않았다. 자원 생성은 사용자가 승인한 첫 배포의 무료 범위만 허용한다.
- 사이드 프로젝트 수준으로 운영한다. 백업·복원 설계는 후속 과제로 미루며 초기 범위에 예약 백업·백업 버킷·백업 알림을 두지 않는다. 정기 복구 훈련·상시 부하 테스트는 하지 않는다.
- 모니터링은 OCI 기본 지표·실패 알림·15분 HTTP 상태 점검으로 시작한다. 앱은 OTel Logs Data Model에 매핑되는 JSON을 stdout/stderr에 출력한다. 제품별 속성은 `agent_wiki.*`로 구분하며 ECS·OTLP와 혼동하지 않는다. Docker syslog·호스트 rsyslog·OCI Unified Monitoring Agent가 OCI Logging으로 보내며 Connector Hub·별도 알림 Function이 Slack 전송을 맡는다. 자체 수집기 컨테이너는 두지 않는다. API·Worker에는 Slack 토큰·전송 코드를 두지 않는다. 이메일은 사용하지 않는다. 실제 데이터·프롬프트·비밀은 운영 로그에 남기지 않는다.
- 계획 배포는 Caddy에서 외부 신규 유입을 먼저 막고 진행 웹 요청과 내부 API 호출을 마친 뒤 API에 SIGTERM을 보낸다. readiness만으로 외부 차단이 된다고 가정하지 않는다. SIGTERM에서 API는 진행 요청·DB 연결 순으로 닫는다. Worker는 새 수신을 멈추고 결과 커밋 후 완료하며, 유예 초과는 재시도로 남긴다. 실제 컨테이너 신호·강제 종료 후 복구를 검증한다. 기본 종료 예산은 API 30초·Worker 90초, Compose 유예는 45초·120초다.
- 내부 조회는 일시 오류에만 deadline·backoff+jitter·최대 2회 추가 시도를 적용한다. 쓰기는 멱등 키·payload 일치·기존 결과 확인 없이 재전송하지 않는다. DB 연결 재생성과 트랜잭션 재실행을 구분하고 COMMIT 응답 유실은 결과부터 확인한다. 중첩 재시도와 종료 기한 뒤 새 호출을 막는다.
- pg-boss는 오프셋 대신 작업 상태로 처리한다. 결과 커밋 뒤 완료, 멱등 반영, 유한 재시도, 종료 유예, 최종 실패 보관을 지킨다. 로그만 남기고 작업 오류를 삼키지 않는다.
- 설계, 파일 작성, 로컬 검증, 자원 생성, 배포, 운영 검증을 구분해 보고한다.
- 로컬 서비스 토큰은 루트 `.env.local`에 보관하고 Git에서 제외한다. `.env.example`에는 변수 이름과 비밀이 아닌 기본값만 둔다. 토큰 값을 출력하거나 문서·그림에 넣지 않는다.

## 문서와 그림

- README는 간결한 영어로, 상세 docs는 한국어로 작성할 수 있다. 문서를 과도하게 나누지 않고 그림·표·구체적인 입력과 출력 예제로 설명한다.
- 상시 설계 문서와 그림 파일명에는 날짜를 넣지 않는다. 외부 자료의 확인 시점과 검증 한계는 본문에 남긴다.
- SVG는 `docs/assets/wiki-*.svg`, 아이콘은 `docs/assets/icons/`에 둔다. 이동 시 상대 링크·이미지·생성기 경로도 함께 갱신한다.
- 흰 캔버스·파스텔 컴포넌트·남색 글자·직교 연결선을 사용한다. SVG의 text/tspan을 편집 가능하게 유지하고 Noto Sans KR 고정 굵기 Regular(400)·Bold(700)를 사용한다.
- 아이콘 출처는 Tech Stack Icons → techicons.dev → Simple Icons 순서다. 일반 기능 기호는 출처가 있는 Tabler 아이콘을 사용하고 출처·라이선스를 보존한다.
- 그림 수정은 `scripts/generate-wiki-diagrams.py`에도 반영한다. 저장소 루트에서 재생성하고 XML·상대 링크 검사와 실제 렌더링의 겹침·잘림 확인을 구분한다.
- Codex 오른쪽 미리보기는 자동으로 열지 않는다.
