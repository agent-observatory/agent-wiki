# 구현·배포 현황

첫 버전을 OCI에 배포했다. **https://agent-wiki.duckdns.org 에서 HTTPS 접속·GitHub 소유자 로그인을 확인했다.** 외부 알림 연결과 실제 NVIDIA 추출 성공은 별도 미완료 항목이다.

## 현재 상태

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
| 모니터링       | 호스트 JSON 파일 기록 확인. OCI Logging/Function/Slack 자동 알림 연결 전                                 |

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
- MCP 서버, 그래프 시각화, 자동 기존 문서 병합, OCI 경보→Slack 운영 연결은 후속 작업이다. HTTP Context API와 문서 연결 데이터는 구현돼 있다.

같은 Terraform state로 볼륨 부착과 instance principal을 완료했다. `scripts/bootstrap-vm.py --image <검증된 커밋 SHA>`는 런타임 환경 파일·DB TLS 인증서·DNS·Actions 접속 정보를 준비한다. 해당 스크립트와 `ci.yml`로 첫 배포를 수행했다. 배포 검증 결과는 아래 기록을 따른다. 이 스크립트는 VM을 생성하거나 유료 전환하지 않는다.

GHCR 패키지는 조직 정책상 비공개다. Actions가 짧은 수명의 저장소 범위 토큰을 stdin으로 VM에 전달해 이미지를 받고 즉시 임시 Docker 인증 파일을 지운다. 개발자의 GitHub 개인 토큰은 VM에 복사하지 않는다.

2026-09-12 사용자 요청으로 자동 VM 생성·배포 재시도 예약을 삭제했다. 자동 재시도하지 않는다. 이후 사용자 지시로 Terraform을 수동 재실행했다.

## 첫 OCI 배포 확인

- 사용자 요청으로 진행 중이던 로컬 아키텍처 문서·그림 변경을 롤백하고 기존 OCI 구성으로 복귀했다. 클라우드 사양은 늘리지 않았다.
- VM 생성은 약 37초에 성공했다. 볼륨의 PV 전송 중 암호화와 VM 옵션 불일치를 수정했고, 재시작 후 암호화된 볼륨 연결을 확인했다. Terraform `prevent_destroy`는 유지했다.
- 생성 전용 암호화 필드와 cloud-init user data 변경은 기존 VM을 교체하지 않도록 처리한다. 실제 암호화 상태는 `launch_options`, 기존 호스트 설정 갱신은 `scripts/configure-host.sh`가 담당한다. 수정 뒤 Terraform 모의 검사와 실제 `No changes`를 확인했다.
- Ubuntu AppArmor에 로그 소켓 경로만 허용하고 로그 디렉터리 소유권을 수정했다. `configure-host.sh`로 로그 기록·부팅 시 Compose 서비스 등록을 복구했으며 실제 JSON 로그와 systemd active를 확인했다.
- GitHub Actions run `34679399455`에서 테스트·ARM64 이미지 게시·배포가 모두 성공했다. 앱 이미지 기준 커밋은 `0a06948bd5e245fe86976d07a09e3ce646cb1440`이다.
- Caddy·웹·API·Worker·PostgreSQL 5개 컨테이너 실행, API readiness 200, 실제 HTTPS 200과 GitHub 소유자 로그인, 외부 DB TLS 접속을 확인했다. DataGrip 접속 값은 `.env.local`에 저장했다.
- 예산·비용 알림과 OCI Logging→알림 Function→Slack 연결은 아직 완료하지 않았다. 웹훅은 비활성화했으며 기존 봇 토큰을 쓰는 방향을 유지한다. 이 미완료 경로를 운영 중이라고 표현하지 않는다.
