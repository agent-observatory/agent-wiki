# Agent Wiki 문서

**개인 에이전트 정제·Wiki 저장/조회 구조와 메뉴별 페이지를 구현했다. 로컬 검증을 마쳤으며 OCI 전환은 진행 중이다.** 기능별 검증 상태는 [운영 현황](OPERATIONS.md), 다음 우선순위는 [첫 배포 다음 작업](wiki/architecture.md#첫-배포-다음-작업)을 따른다.

| 읽을 문서 | 내용 |
| --- | --- |
| [그림과 레퍼런스](wiki/README.md) | 계층도·배포도·운영도·원문 링크 |
| [아키텍처](wiki/architecture.md) | 지식 모델·검색 예제·기술 선택·자원 배분·운영 기준 |
| [에이전트 사용법·계약](wiki/agent-memory.md) | 에이전트 정제·리니지·세션 재개 조회. CLI 설치·조회·원문·반영 계약 |
| [디자인 규칙](DESIGN.md) | UI·문서·SVG 기준 |
| [작업 원칙](../AGENTS.md) | 범위·데이터 보호·검증·Git |

## 현재 결정

- 독립 제품 `agent-observatory/agent-wiki`. 주 용례는 에이전트 질답·작업의 근거 조회이며, 웹은 편집·정정·근거 확인을 보조한다.
- Workspace로 자료·권한·AI 맥락을 격리하고 Folder·Tag로 분류한다.
- 정제·추론은 개인 에이전트의 모델·사용량으로 처리하고 Wiki는 근거·개정·검색을 맡는다. 새 코드에는 서버 LLM·Worker·큐가 없다. 검색은 키워드·별칭·문서 연결을 유지한다.
- A1 Compute VM 1대·2 OCPU·12GB에서 앱·PostgreSQL을 Compose로 실행하고 로그는 기성 호스트 에이전트가 전송한다. DB와 인증서는 연결 볼륨에, 원문은 Object Storage에 둔다. 외부 빌드 후 변경된 앱만 교체한다. [이전 분리 구성 보존본](archive/container-instances/ARCHIVE.md).
- 백업·복원은 초기 범위에서 제외하고 나중에 검토한다. 앱은 오류 로그만 남기며 오류는 OCI 기본 경보·Notifications가, 비용·사용량은 GitHub Actions가 Slack Webhook으로 보낸다. 이메일은 사용하지 않는다.
- 임베딩·OpenMetadata 전체 도입은 보류한다. 웹 편집기·그래프 재사용 범위는 미확정이다.

세부 결정과 변경 기준은 [아키텍처](wiki/architecture.md)를 따른다. 현재는 개발 모드이며 Wiki 데이터·API·키를 초기화하고 하위 호환성 없이 재구성할 수 있다. 사용자가 운영 모드라고 선언하면 보존 정책을 다시 정한다. 이번 전환은 새 코드 배포 시 기존 지식·개정·원문 메타데이터·API 키·큐를 한 번 초기화한다. 로그인·Workspace는 유지한다.

## 이관·검증 기록

2026-09-12, 기존 `agent-observatory/agent-observatory`의 로컬 폴더 `/Users/dan/github/hyune-labs/agent-session-atlas`에서 Wiki 문서·SVG·아이콘과 라이선스·그림 생성기·공통 디자인 규칙을 이관했다. 기존 프로젝트는 세션 분석 참고 구현으로 보존하며, 포털·Sessions·Collector·계약·DB 호환성은 새 제품의 제약으로 삼지 않는다.

앱 코드·기존 Git·환경 및 인증 파일·실제 세션·로컬 상태·Vercel 설정·운영 식별자는 복사하지 않았다. 원본 44개 파일의 SHA-256 불변을 확인했다. 로컬 링크·앵커·SVG XML·그림 재생성 일치를 검사했고, SVG 3개를 PNG로 렌더링해 확인했다. 이후 PostgreSQL 전용 VM 변경도 배포도·운영도 렌더링으로 검증했다. 앱·클라우드 동작 검증은 별도다.

그림 재생성: `python3 scripts/generate-wiki-diagrams.py` (저장소 루트, Python 3 표준 라이브러리).
