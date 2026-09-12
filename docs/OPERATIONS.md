# 구현·배포 현황

## 작업 세션과 수집·정제 분리 · 문서·그림 정비

2026-09-12, 별도 Collector가 클라이언트 기록을 읽고 원격에 보관하며 별도 백그라운드 실행이 군집화·정제하는 방향으로 설계를 수정했다. **Collector·자동 군집화·백그라운드 정제는 아직 미구현**이며 실행 위치·모델 연결·사용량 정책은 미정이다. 아래 개인 에이전트 정제 기록은 이전 구현 당시의 사실이다.

아키텍처·사용법·작업 지침·CLI Skill에서 활성 대화의 시작·종료·매 턴에 수집·정제를 요구하는 흐름을 제거했다. 프로젝트 역사 파일은 원격 Wiki 링크로 축소했다. 원격 원문·지식은 수정하지 않았다. 그림 4개와 생성기를 갱신했고, 전체 배포도에서 호스트 로그를 생략하고 DNS·인증서 발급·보관을 분리했다. XML·재생성 일치·문서 링크·PNG 렌더링을 확인했다. 웹 사용법 문구는 수정·타입 검사 후 앱 `ef43ac3`의 [CI·배포](https://github.com/agent-observatory/agent-wiki/actions/runs/34697700073)가 성공했다. 운영 Edge에서 필요할 때 조회·자동 수집 미구현 안내와 매 작업 기록 요청 절차의 제거를 확인했다. 수집·정제 실행이나 데이터 초기화는 하지 않았다.

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

2026-09-12, 개인 에이전트가 정제하고 Wiki는 저장·근거 검증·조회하는 방향으로 문서와 그림을 변경했다. [실행 계획](wiki/agent-memory.md)과 목표 4개 컨테이너 그림은 구현 완료 증거가 아니다. 이 작업에서는 앱 코드·운영 DB·원문·키·클라우드 자원·배포를 변경하지 않았다. 기존 Worker·NVIDIA 경로와 수동 등록 지식 5개는 전환 전 상태로 남아 있다.

사용자는 **개발 모드에서 DB·원문·기존 지식·키 초기화와 하위 호환성 없는 재구성**을 허용했다. 사용자가 운영 모드로 선언하기 전까지 적용한다. 다음 구현에서는 새 구조를 검증한 뒤 일괄 교체하고 실제 근거에서 프로젝트 역사를 다시 작성한다.

계획 검증: 계층·배포·리니지·운영 SVG 4개를 재생성하고 XML·편집 가능한 텍스트·재생성 일치·문서 상대 링크와 앵커를 검사했다. PNG로 실제 렌더링해 겹침·잘림을 확인했다. 앱 테스트·배포는 이번 문서 작업의 검증에 포함하지 않는다.

## 개인 위키 테마·접근 제한 갱신

2026-09-12, 앱 커밋 `3f8ce7f93dee6440144d7afe88500155c8bf3727`을 [GitHub Actions](https://github.com/agent-observatory/agent-wiki/actions/runs/34683743055)로 배포했다. CI 검증·ARM64 이미지 게시·배포가 모두 성공했다(2분 31초). 다크가 기본이며 로그인 화면과 앱 헤더에서 라이트로 전환할 수 있다.

- 로컬: typecheck·production build·테스트 11개 통과. 합성 OAuth 응답으로 비소유자 사용자·세션 생성 차단, 기존 비소유자 세션·API 키 거부, 소유자 설정 누락 시 접근 차단을 확인했다. 390px 화면·문서 편집·테마 유지도 확인했다.
- 운영: Edge의 기존 소유자 세션으로 정상 접근, 다크 화면, 라이트 전환 후 새로고침 유지와 다크 복귀를 확인했다. 다른 사람의 실제 GitHub 계정으로 로그인하지는 않았다.
- 첫 실사용 자료는 [Atlas에서 Wiki까지의 역사 초안](wiki/project-history.md)을 바탕으로 개인 작업 Workspace·개발 기록 폴더에 문서 5개를 직접 등록했다. 각 문서에 여러 태그와 근거 링크를 넣었다. NVIDIA 추출 경로를 사용한 것이 아니다.

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

이 문서는 실제 수행 상태다. [아키텍처](wiki/architecture.md)와 그림은 목표 구조를 설명하며, 구현·배포 검증의 증거를 대신하지 않는다.

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

2026-09-12, 오류 알림만 다음 경로로 전환했다. 앱·VM·DB와 비용·사용량 알림은 변경하지 않았다.

`stdout → Docker syslog → rsyslog → OCI Unified Monitoring Agent → OCI Logging → Connector Hub → Monitoring 경보 → Notifications → Slack`

- 기존 Connector Hub와 확인된 Slack 구독을 재사용한다. `data.severityNumber >= 17`만 `agent_wiki_errors / ErrorLogCount` 지표로 보낸다. 원본 JSON은 Slack에 전달하지 않는다.
- 경보는 `ErrorLogCount[5m].grouping().count() > 0`, 평가 간격 1분·발동 대기 1분·집계 대기 5분이다. 로그 전송 지연을 포함하므로 즉시 알림은 아니다.
- 한국어 제목·요약·본문과 오류 로그 링크를 사용한다. 상태 변경 시 알리며 정기 반복은 없다. 오류 종류별 중복 제거는 하지 않는다. `OK`는 경보 해제이며 앱·로그 수집 정상의 증명이 아니다.
- 원격 `Application error monitor` 워크플로는 중지했다. 로컬 오류 조회 워크플로·포매터·전용 테스트를 제거했다. 비용 Actions와 공유 운영 체크포인트는 유지한다.
- Terraform 적용: 경보 1개 생성·기존 권한/커넥터 2개 수정, 삭제 없음. 실제 Docker stdout의 INFO·WARN·ERROR 합성 로그 3개가 OCI Logging에 수집됐고, 오류 지표는 1건이었다. 22:21 한국 시각에 경보 발동과 Slack 도착을 확인했다. 최초 시험의 JSON 표시를 발견해 `ONS_OPTIMIZED` 기본 서식으로 수정했으며 표시를 재검증 중이다.

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
