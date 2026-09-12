# Agent Wiki 문서

**Wiki 저장·조회·근거 연결은 배포되어 있다. 새 목표는 작업 세션과 분리된 Collector·백그라운드 정제이며 이 자동 경로는 아직 미구현이다.** 기능별 검증 상태는 [운영 현황](OPERATIONS.md), 다음 우선순위는 [첫 배포 다음 작업](wiki/architecture.md#첫-배포-다음-작업)을 따른다.

| 읽을 문서 | 내용 |
| --- | --- |
| [그림과 레퍼런스](wiki/README.md) | 계층도·배포도·운영도·원문 링크 |
| [아키텍처](wiki/architecture.md) | 지식 모델·검색 예제·기술 선택·자원 배분·운영 기준 |
| [에이전트 사용법·계약](wiki/agent-memory.md) | 사용자 조회와 별도 수집·정제의 경계, 원문·반영 계약 |
| [디자인 규칙](DESIGN.md) | UI·문서·SVG 기준 |
| [작업 원칙](../AGENTS.md) | 범위·데이터 보호·검증·Git |

## 현재 결정

- 독립 제품 `agent-observatory/agent-wiki`. 주 용례는 에이전트 질답·작업의 근거 조회이며, 웹은 편집·정정·근거 확인을 보조한다.
- Workspace로 자료·권한·AI 맥락을 격리하고 Folder·Tag로 분류한다.
- 작업 에이전트는 필요할 때 조회한다. Collector는 별도 프로세스로 기록을 읽고, 군집화·정제도 별도 실행으로 둔다. 실행 위치·모델 연결·사용량 정책은 미정이다. 현재 서버에는 모델·Worker·큐가 없다.
- A1 Compute VM 1대·2 OCPU·12GB에서 앱·PostgreSQL을 Compose로 실행하고 로그는 기성 호스트 에이전트가 전송한다. DB와 인증서는 연결 볼륨에, 원문은 Object Storage에 둔다. 외부 빌드 후 변경된 앱만 교체한다. [이전 분리 구성 보존본](archive/container-instances/ARCHIVE.md).
- 백업·복원은 초기 범위에서 제외하고 나중에 검토한다. 앱은 오류 로그만 남기며 오류는 OCI 기본 경보·Notifications가, 비용·사용량은 GitHub Actions가 Slack Webhook으로 보낸다. 이메일은 사용하지 않는다.
- 임베딩·OpenMetadata 전체 도입은 보류한다. 웹 편집기·그래프 재사용 범위는 미확정이다.

세부 결정과 변경 기준은 [아키텍처](wiki/architecture.md)를 따른다. 현재는 개발 모드이며 Wiki 데이터·API·키를 초기화하고 하위 호환성 없이 재구성할 수 있다. 사용자가 운영 모드라고 선언하면 보존 정책을 다시 정한다. 이번 문서 정비에서 데이터·토큰을 바꾸거나 수집·정제를 실행하지 않는다. 프로젝트 역사와 리니지는 원격 Wiki에 보관한다.
