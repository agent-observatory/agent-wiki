# Agent Wiki 문서

**agent-wiki-client 하나로 설치하고, 조회와 백그라운드 수집·원격 정제를 분리해 실행한다.** 기능별 배포·검증 상태는 [운영 현황](OPERATIONS.md)을 따른다.

| 파일 | 무엇을 보나 |
| --- | --- |
| [architecture.md](architecture.md) | 전체 구성·계층·앱·인프라·조회 |
| [l2-l3-memory.md](l2-l3-memory.md) | L2·L3: 증분·결정 변경·에이전트 검토·실험·재생성 |
| [OPERATIONS.md](OPERATIONS.md) | 현재 구현·실제 배포·검증 결과·남은 작업 |
| [client-and-api.md](client-and-api.md) | Client 설치·연결, 접힌 수집·API 계약 |
| [DESIGN.md](DESIGN.md) | UI·문서·SVG 디자인 규칙 |
| [AGENTS.md](../AGENTS.md) | 에이전트 작업 원칙 |

## 읽는 순서

**사람은 `architecture.md`의 그림과 표를 먼저 본다.** 구현 에이전트는 관련 상세 계약과 `OPERATIONS.md`의 현재 상태를 이어 읽는다. 설치가 필요할 때만 `client-and-api.md`를 읽는다. 수집·API 상세 계약은 구현 에이전트의 참고다.

## 유지할 원칙

- 주 용례는 에이전트의 근거 조회다. 조회 Skill·Wiki CLI·Collector는 하나의 설치 패키지에 포함되며 수집은 작업 대화와 독립적으로 실행한다.
- Workspace는 격리 단위, Folder·Tag는 분류다. 불변 L1에서 정제 실행과 L3 지식 Version까지 근거를 연결한다.
- 원문은 텍스트·이미지를 분리해 zstd로 보관한다. L2는 텍스트만 처리하고 L4 조회에는 모델을 호출하지 않는다.
- 기존 OCI 단일 VM과 Object Storage를 사용한다. OCI 유료 자원 추가·백업·임베딩 도입은 현재 범위 밖이다.
- 설계는 아키텍처에, 명령·계약은 사용법에, 실제 구현·배포·검증은 운영 현황에 기록한다. 과거 설계는 `archive/`에 보존하며 현재 지침으로 읽지 않는다.

현재는 개발 모드다. 사용자 요청 범위에서 데이터를 재구성할 수 있으며 운영 모드 선언 후 보존 정책을 다시 정한다. 프로젝트 역사와 리니지는 원격 Wiki에 쌓고 로컬 문서에 중복 관리하지 않는다.
