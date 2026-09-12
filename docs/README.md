# Agent Wiki 문서

**첫 버전은 OCI에 배포됐다. 다음은 에이전트의 실제 조회·질답 흐름을 검증한다.** 기능별 검증 상태는 [운영 현황](OPERATIONS.md), 다음 우선순위는 [첫 배포 다음 작업](wiki/architecture.md#첫-배포-다음-작업)을 따른다.

| 읽을 문서 | 내용 |
| --- | --- |
| [그림과 레퍼런스](wiki/README.md) | 계층도·배포도·운영도·원문 링크 |
| [아키텍처](wiki/architecture.md) | 지식 모델·검색 예제·기술 선택·자원 배분·운영 기준 |
| [디자인 규칙](DESIGN.md) | UI·문서·SVG 기준 |
| [작업 원칙](../AGENTS.md) | 범위·데이터 보호·검증·Git |

## 현재 결정

- 독립 제품 `agent-observatory/agent-wiki`. 주 용례는 에이전트 질답·작업의 근거 조회이며, 웹은 편집·정정·근거 확인을 보조한다.
- Workspace로 자료·권한·AI 맥락을 격리하고 Folder·Tag로 분류한다.
- 검색은 키워드·별칭·문서 연결, 지식 추출은 NVIDIA Kimi K3·DeepSeek를 사용한다.
- A1 Compute VM 1대·2 OCPU·12GB에서 앱·PostgreSQL을 Compose로 실행하고 로그는 기성 호스트 에이전트가 전송한다. DB와 인증서는 연결 볼륨에, 원문은 Object Storage에 둔다. 외부 빌드 후 변경된 앱만 교체한다. [이전 분리 구성 보존본](archive/container-instances/ARCHIVE.md).
- 백업·복원은 초기 범위에서 제외하고 나중에 검토한다. 앱은 오류 로그만 남기며 OCI 로그·지표 경로와 별도 알림 Function이 Slack 봇 전송을 맡는다. 이메일은 사용하지 않는다.
- 임베딩·OpenMetadata 전체 도입은 보류한다. 웹 편집기·그래프 재사용 범위는 미확정이다.

세부 결정과 변경 기준은 [아키텍처](wiki/architecture.md)를 따른다. 커밋·푸시는 사용자 요청 시 한 번에 진행한다.

## 이관·검증 기록

2026-09-12, 기존 `agent-observatory/agent-observatory`의 로컬 폴더 `/Users/dan/github/hyune-labs/agent-session-atlas`에서 Wiki 문서·SVG·아이콘과 라이선스·그림 생성기·공통 디자인 규칙을 이관했다. 기존 프로젝트는 세션 분석 참고 구현으로 보존하며, 포털·Sessions·Collector·계약·DB 호환성은 새 제품의 제약으로 삼지 않는다.

앱 코드·기존 Git·환경 및 인증 파일·실제 세션·로컬 상태·Vercel 설정·운영 식별자는 복사하지 않았다. 원본 44개 파일의 SHA-256 불변을 확인했다. 로컬 링크·앵커·SVG XML·그림 재생성 일치를 검사했고, SVG 3개를 PNG로 렌더링해 확인했다. 이후 PostgreSQL 전용 VM 변경도 배포도·운영도 렌더링으로 검증했다. 앱·클라우드 동작 검증은 별도다.

그림 재생성: `python3 scripts/generate-wiki-diagrams.py` (저장소 루트, Python 3 표준 라이브러리).
