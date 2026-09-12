# 첫 지식 묶음: Atlas에서 Agent Wiki까지

Agent Wiki를 만드는 과정 자체를 첫 실사용 자료로 삼는다. 에이전트가 “왜 이렇게 결정했지?”와 “지금 무엇이 되어 있지?”에 근거를 찾아 답하는 것이 목표다. 2026-09-12 이 초안을 바탕으로 개인 작업 Workspace·개발 기록 폴더에 아래 Article 5개를 직접 등록했다. NVIDIA 추출을 거치지 않았다. 이 글들은 원문 Source·정제 리니지가 없는 초기 초안이다. 새 구조 구현 때 초기화하고 실제 대화 발췌·고정 커밋 문서에서 다시 정제한다. [재작성 계획](agent-memory.md#기존-지식-5개-교체)을 따른다.

## 공간과 분류

| 구분 | 첫 적용 | 역할 |
| --- | --- | --- |
| Workspace | `개인 작업` | 개인 개발 자료의 접근·검색 경계 |
| Folder | `개발 기록` | 문서의 기본 위치. 초기에는 한 문서에 하나 |
| Tag | `agent-observatory`, `agent-wiki`, `아키텍처` 등 | 프로젝트 계보·제품·주제로 여러 개 부여 |
| 문서 연결 | 역사 → 독립 결정 → 현재 구성 | 관련 근거를 따라가는 연결 |

별도 Label·Project 분류를 추가하지 않고 **다중 Tag**를 사용한다. `agent-observatory`는 Atlas·Sessions·Wiki를 함께 찾는 상위 주제다. 같은 태그를 붙여도 독립 제품·저장소를 다시 합친다는 뜻은 아니다. 다른 개인 프로젝트도 같은 Workspace에 두고 프로젝트 태그로 나눌 수 있다. 회사 자료는 별도 Workspace로 격리한다.

태그는 `agent-observatory`처럼 일관된 표기를 사용하고 같은 의미의 새 태그를 반복해서 만들지 않는다. 용어집의 별칭은 검색 표현을 확장하는 용도이며 태그 중복을 합치는 기능은 아니다.

현재 코드는 문서에 태그 여러 개를 저장하고, 편집 화면에서 쉼표로 입력한다. 검색은 **태그 하나 필터**까지 구현돼 있다. 후속으로 여러 태그를 선택하면 모두 포함하는 AND 검색을 기본으로 제안한다. `agent-observatory` + `oci`는 이 프로젝트 계보의 OCI 문서만 찾는다. 현재 Folder는 문자열이며 계층형 폴더 관리 기능으로 설명하지 않는다.

## 역사 초안

아래는 저장소 기록과 사용자 결정을 함께 정리한 것이다. 커밋은 당시 파일 상태의 근거이며, 실행·배포 성공 여부는 별도 검증 기록을 따른다.

| 단계 | 목적과 변화 | 근거 |
| --- | --- | --- |
| AgentSession Atlas | Codex 등 에이전트 세션을 모아 사용량·작업 흐름·개선점을 분석하는 설계에서 출발했다. | [초기 README](https://github.com/agent-observatory/agent-observatory/blob/a74bd36/README.md) |
| Collector와 Sessions | 로컬 수집·전송과 원격 세션 검토·분석을 구현했다. 세션 자료의 수집과 검증을 다루는 참고 구현이 됐다. | [이관 전 Sessions 안내](https://github.com/agent-observatory/agent-observatory/blob/eb270665d43b0523b8ceca9c7331bfa7bfaca4a1/docs/sessions/README.md) · [Collector](https://github.com/agent-observatory/agent-observatory/blob/eb270665d43b0523b8ceca9c7331bfa7bfaca4a1/docs/collector.md) |
| Agent Observatory 포털 | 기존 기능을 Sessions로 두고 Wiki를 미래 지식 작업 영역으로 잡았다. 이때 `/wiki`는 빈 화면 골격이었다. | [포털 전환 당시 README](https://github.com/agent-observatory/agent-observatory/blob/40040ed/README.md) |
| 독립 Agent Wiki | 세션 분석을 넘어 업무 지식을 축적하고 에이전트에 근거를 제공하는 독립 제품으로 분리했다. 기존 Collector·DB·계약의 하위 호환성을 제약으로 삼지 않는다. | 사용자 분리 결정 · [첫 Wiki 구현](https://github.com/agent-observatory/agent-wiki/commit/76a1c58) · [현재 제품 방향](architecture.md) |
| 첫 OCI 배포 | 단일 A1 VM에 앱·DB를 함께 배포하고 HTTPS·소유자 로그인·문서 검색·원격 Context 조회를 확인했다. | [당시 배포 검증 기록](https://github.com/agent-observatory/agent-wiki/blob/abfbb64/docs/OPERATIONS.md) |

핵심 변화는 **세션을 분석하는 도구에서, 여러 원천 자료를 다음 에이전트 작업의 근거로 만드는 제품으로 확장한 것**이다. 세션은 여러 입력 중 하나이며, 웹은 지식의 편집·정정·근거 확인을 돕는다.

## 현재 결정과 이전 대안

| 주제 | 채택한 결정 | 이전 대안·보류 | 이유와 검증 경계 |
| --- | --- | --- | --- |
| 제품 경계 | 독립 `agent-wiki` 저장소 | Observatory 포털의 Wiki 영역 | 세션 분석 구현에 새 지식 모델을 묶지 않기 위해 분리 |
| 조회 | 키워드·Folder·다중 Tag·용어 별칭 | 임베딩·pgvector | 초기 운영 부담을 줄인다. 임베딩은 외부 API나 Comsat 후보를 나중에 평가 |
| 인프라 | A1 VM 1대, 2 OCPU·12GB, 새 Compose 4개 서비스 | Container Instances + 별도 DB VM, 로컬 구성 | 사용자 결정으로 초기 운영을 한곳에 모았다. 짧은 중단은 허용하고 정상 종료·재시도는 필요 |
| DB | 같은 VM의 PostgreSQL | OCI 관리형 DB, Supabase | OCI 무료 관리형 DB를 PostgreSQL로 오인했던 전제를 수정했다. 현재 DB 운영은 직접 담당 |
| 비용 | 승인한 자원·무료 사용 범위 유지 | 사양 확대·유료 자원 | 사용자가 PAYG 업그레이드를 완료했지만 유료 사용 허용을 뜻하지 않는다 |
| 지식 정제 | 개인 에이전트가 정제하고 Wiki에 반영 | 서버 NVIDIA Worker | 사용 중인 에이전트의 모델·사용량으로 처리. 새 코드에서 서버 추론 경로 제거 |

이 표는 대화에서 선택한 이유를 요약한다. 무료 제공량이나 제공자 조건의 최신 보증으로 사용하지 않는다. 이전 분리 구성은 [설계 보관본](../archive/container-instances/ARCHIVE.md), 현행 실행·검증 상태는 [운영 현황](../OPERATIONS.md)을 따른다. 알림의 실제 상태도 운영 현황을 따른다.

## 새로 정제한 첫 지식 6개

이전 수동 지식 5개를 그대로 이전하지 않는다. 커밋이 고정된 README 2개와 사용자가 제공한 대화 발췌 4개를 원문으로 보관하고 현재 시점에 새로 정제했다.

| 문서 | 역할 |
| --- | --- |
| Agent Wiki · 여기서 이어서 시작 | 현재 방향·제약·남은 일과 주제 링크. 프로젝트 시작 문서 |
| Atlas → Observatory → 독립 Wiki | README와 사용자 결정에서 읽는 계보 |
| 독립 제품과 자료의 경계 | Sessions와의 분리·원천 자료 범위 |
| 정제는 개인 에이전트, 보관은 Wiki | 개인 에이전트와 서버의 책임 |
| 단일 VM과 허용한 운영 수준 | 단일 구성·종료 처리·무료 사용·백업 보류 |
| 키워드 우선, 임베딩은 후속 후보 | 현재 검색 방향과 후속 후보 |

작성 주체는 에이전트이고 사람의 검토 완료로 표시하지 않는다. 사용자 결정·문서 관찰·AI 해석별로 보관본의 정확한 줄을 연결했다. 대화 발췌는 전체 세션이나 모든 발언 시각을 복원한 자료가 아니다. 운영 등록 여부는 [운영 현황](../OPERATIONS.md)을 따른다.

고정 커밋의 레포 문서는 당시 설계·파일 상태의 근거다. 과거 사용자 결정의 직접 증거는 실제 대화 발췌로 구분한다. 실사용 지식은 서버 Wiki에서 편집하며, 이후 Git과 Wiki 사이에 자동 양방향 동기화를 가정하지 않는다. 준비 단계에서 비밀·리소스 식별자를 제외하고 실제 원문 링크와 확인 시점을 남긴다.

## 첫 조회에서 확인할 질문

1. “Atlas와 Sessions가 지금 Wiki와 무슨 관계야?” → 계보와 독립 경계를 함께 설명한다.
2. “왜 임베딩을 안 쓰고 있어?” → 현재 검색 방식과 보류 이유를 인용한다.
3. “왜 Container Instances 대신 VM을 선택했어?” → 당시 대안과 최종 결정을 구분한다.
4. “NVIDIA를 아직 호출해?” → 이전 서버 추출 경로와 개인 에이전트 정제 전환을 구분한다.
5. “백업 복원은 몇 분 걸려?” → 구현·측정 근거가 없다고 답한다.

이후 현재 결정을 한 번 정정하고 다시 조회해 새 개정이 반영되는지 확인한다. 첫 순서는 **원문 보관 → 개인 에이전트 정제 → 근거가 있는 지식 반영 → 새 세션 조회**다. 다중 태그 조합 검색은 이 흐름 다음에 보완한다.
