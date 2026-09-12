# Agent Wiki 작업 원칙

## 시작과 범위

- 먼저 [docs/README.md](docs/README.md), [Wiki 문서 안내](docs/wiki/README.md), [아키텍처](docs/wiki/architecture.md)를 읽는다. 디자인 작업 전에는 [docs/DESIGN.md](docs/DESIGN.md)를 읽는다.
- 제품은 독립 Agent Wiki이며 현재는 문서·그림 중심의 설계 단계다. 앱 구현·OCI 자원 생성·배포 완료로 표현하지 않는다.
- 기존 Agent Observatory의 Sessions는 참고 구현이다. 포털 통합·세션 평가 기능과 기존 Collector·계약·DB·하위 호환성을 새 제품의 제약으로 삼지 않는다.
- 사용자와 정한 독립 제품 방향이 이관 문서의 오래된 전제보다 우선한다. 설계 변경은 관련 문서와 그림에 함께 반영한다.
- 작업 전 관련 파일과 `git status --short`를 확인하고 사용자 변경을 보존한다. 원본 저장소는 수정하거나 삭제하지 않는다.
- 현재 작업 범위는 문서·그림 설계와 정합성 확인까지다. 앱·인프라 구현은 후속 요청에서 진행한다.
- 커밋·푸시는 사용자가 요청할 때 한 번에 한다. 이번 초기 설정에서 PR을 생성하지 않는다.

## 제품과 데이터

- L1 Raw sources → L2 Ingest → L3 Wiki → L4 Query → L5 Answers는 우리 제품 설계이며 외부 공식 표준이 아니다.
- 세션은 여러 원천 자료 중 하나다. 주 용례는 에이전트가 질답·작업 중 근거 자료를 조회하는 것이다. 웹 위키는 지식 편집·정정·근거 확인을 위한 보조 화면이다. 검색 API와 인용 가능한 Context를 우선 설계하며 웹 방문량을 제품 가치의 기준으로 삼지 않는다.
- Workspace는 자료·지식·권한·검색·AI 맥락의 격리 단위다. Folder·Tag는 Workspace 내부 분류이며 권한 경계를 대신하지 않는다.
- 초기 검색은 키워드·Folder·Tag·용어집 별칭·명시적인 문서 연결을 사용한다. 임베딩·pgvector는 후속 후보이며 외부 API 또는 사용자가 제시한 Comsat 모델을 평가한다. 일반 검색·Context 구성과 지식 추출용 LLM 호출을 구분한다.
- 출처·확인 시점·개정·파생 관계를 보존한다. 사용자 결정, 관찰, AI 해석, 미확인 내용을 구분하고 에이전트의 완료 발언을 검증 결과로 취급하지 않는다.
- 앱 코드·인증 파일·환경변수 값·실제 세션·로컬 상태·Vercel 연결 설정·운영 리소스 식별자를 원본에서 복사하지 않는다. 예제와 검증에는 합성 자료를 사용한다.

- 지식 추출·정리용 LLM은 NVIDIA의 Kimi K3를 기본으로, DeepSeek Pro를 대체로 사용한다. 정확한 ID·쿼타 대응·데이터 전송 조건은 아키텍처를 따른다. API 키·실제 추론 검증 여부를 구분한다.

## 인프라

- 앱은 OCI Container Instances를 검토하며 무료 계정 이용 자격은 미확인이다. DB는 별도 Compute VM 1대에 PostgreSQL을 설치한다. 단일 DB·1 OCPU·4GB로 시작하며 OS·DB 관리는 우리가 맡는다.
- PostgreSQL 데이터는 DB VM에 연결한 Block Volume에, 원문과 Caddy 인증서·개인키·ACME 상태는 별도의 비공개 Object Storage 버킷에 둔다. Caddy는 App CI에서 S3 저장 모듈로 상태를 읽고 갱신한다. 이 저장소는 백업이 아니다.
- 무료 범위에서만 운영한다. PAYG 전환·유료 자원·체험 크레딧 사용은 금지한다. 이전 PAYG 허용 결정보다 이 규칙이 우선한다.
- CI의 CPU·메모리 무료량과 DB VM·Block Volume·Object Storage·네트워크·로그 한도를 분리한다. 체험 크레딧은 지속 운영 예산으로 계산하지 않는다.
- 앱 서버 OS·런타임은 OCI가 관리한다. DB VM은 cloud-init과 systemd로 초기 구성하고 이후 OS·DB 업데이트는 우리가 맡는다. Terraform은 OCI 네트워크·DB VM·Block Volume·Object Storage·IAM을, OCI CLI/API는 CI 실행 정의·배포를 관리하며 자원 소유권을 중복시키지 않는다.
- DB 스키마는 앱 마이그레이션으로 관리한다. Supabase·OCI 관리형 DB·FSS는 구성에서 제외한다. API·Worker는 같은 VCN의 DB VM private IP/DNS:5432에 TLS로 연결한다. 앱 3 OCPU·20GB + DB 1 OCPU·4GB는 무료 자격 확인 전 후보 배분이다.
- DataGrip은 DB VM 공인 주소로 직접 접속한다. Bastion·SSH 터널 없이 별도 ID/비밀번호와 TLS 서버 검증을 사용하고, 외부 5432에는 접속 IP 제한을 두지 않는다. 강한 비밀번호를 사용하고 관리 계정은 앱 계정과 분리한다. 실제 관리 접속 정보는 DB 구성 시 `.env.local`에 기록한다.
- Caddy S3 모듈을 포함한 이미지를 사용하며 OCI S3 호환 API의 갱신·잠금 호환성은 구현 시 확인한다. Customer Secret Key는 인증서 버킷 권한만 부여하고 Vault로 전달한다.
- 실제 구축 전 최신 공식 조건·계정 자격·전체 사용량·월 비용을 확인한다. 이번 문서 작업으로 계정 업그레이드·자원 생성 권한이 부여된 것으로 해석하지 않는다.
- 사이드 프로젝트 수준으로 운영한다. 백업·복원 설계는 후속 과제로 미루며 초기 범위에 예약 백업·백업 버킷·백업 알림을 두지 않는다. 정기 복구 훈련·상시 부하 테스트는 하지 않는다.
- 모니터링은 OCI 기본 지표·실패 알림·15분 HTTP 상태 점검으로 시작한다. 앱은 JSON 로그만 남기고 독립 수집기·OCI Logging·Connector Hub·알림 전용 Function이 Slack 전송을 처리한다. API·Worker에는 Slack 토큰·전송 코드를 두지 않는다. 이메일은 사용하지 않는다. 실제 데이터·프롬프트·비밀은 운영 로그에 남기지 않는다.
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
