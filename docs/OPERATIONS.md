# 구현·배포 현황

첫 버전 구현 작업 중이다. **공개 앱은 아직 배포되지 않았다.**

## 현재 상태

| 항목 | 상태 |
| --- | --- |
| OCI 계정 | API 인증 성공, Osaka Home region 확인. PAYG 전환 없음 |
| 비용 범위 | A1 2 OCPU·12GB, 부트 50GB + 데이터 50GB만 허용 |
| OCI 자원 | VCN·서브넷·Internet Gateway·보안 목록·원문 버킷·50GB 데이터 볼륨 생성 |
| VM | `Out of host capacity`로 생성 실패, 무료 스펙으로 재시도 중 |
| 앱 | Next.js 웹, Fastify API, pg-boss Worker 작성. 세부 검증 진행 중 |
| DNS·HTTPS | VM 확보 전. 기존 DuckDNS 주소를 아직 서버에 연결하지 않음 |
| 로그인 | GitHub OAuth 설정 준비. 등록한 소유자의 GitHub ID만 허용 |
| GitHub Actions | 테스트 → ARM64 이미지 게시 → 배포 구성. 실제 배포는 `DEPLOY_ENABLED=true`일 때만 실행 |
| 모니터링 | 앱 JSON 로그·호스트 전달 설정 작성. OCI Logging/Function/Slack 운영 경로 연결 전 |

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
- GitHub Actions는 공개 저장소의 기본 러너를 사용한다. 유료 대형 러너·유료 클라우드 자원·PAYG 전환은 하지 않는다.
- 이미지 빌드는 VM 밖에서 실행한다. 배포는 이미지 pull → Caddy 외부 차단 → Web/Worker/API 정상 종료 → 마이그레이션 → 앱 교체 → 상태 확인 → 외부 재개 순서다. Caddy와 PostgreSQL은 일반 앱 배포에서 유지한다.
- 실패한 마이그레이션의 자동 되돌리기는 하지 않는다. 이전 앱과 호환되는 추가 변경만 자동 배포한다.

## 재개 위치

Terraform은 `infra/terraform/`에 있다. 로컬 state에는 생성된 자원이 기록돼 있으므로 새로 중복 생성하지 않고 같은 state로 이어간다. VM·데이터 볼륨·원문 버킷에는 `prevent_destroy`를 적용했다. 운영 환경 변경 전 계정 전체 무료 사용량과 plan을 확인한다.
