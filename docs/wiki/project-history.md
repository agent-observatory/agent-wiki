# 첫 지식 묶음: Atlas에서 Agent Wiki까지

Agent Wiki를 만드는 과정 자체를 첫 실사용 자료로 삼는다. 에이전트가 “왜 이렇게 결정했지?”와 “지금 무엇이 되어 있지?”에 근거를 찾아 답하는 것이 목표다. 2026-09-12 이 초안을 바탕으로 개인 작업 Workspace·개발 기록 폴더에 아래 Article 5개를 직접 등록했다. NVIDIA 추출을 거치지 않았다. 이후 지식 편집은 운영 Wiki에서 이어간다.

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
| 인프라 | A1 VM 1대, 2 OCPU·12GB, Compose 5개 서비스 | Container Instances + 별도 DB VM, 로컬 구성 | 사용자 결정으로 초기 운영을 한곳에 모았다. 짧은 중단은 허용하고 정상 종료·재시도는 필요 |
| DB | 같은 VM의 PostgreSQL | OCI 관리형 DB, Supabase | OCI 무료 관리형 DB를 PostgreSQL로 오인했던 전제를 수정했다. 현재 DB 운영은 직접 담당 |
| 비용 | 승인한 자원·무료 사용 범위 유지 | 사양 확대·유료 자원 | 사용자가 PAYG 업그레이드를 완료했지만 유료 사용 허용을 뜻하지 않는다 |
| 지식 추출 | NVIDIA Kimi·DeepSeek 호출 경로 | 일반 조회 때마다 LLM 호출 | 조회에는 LLM이 필요 없다. 실제 외부 추출 성공은 아직 미확인 |

이 표는 대화에서 선택한 이유를 요약한다. 무료 제공량이나 제공자 조건의 최신 보증으로 사용하지 않는다. 이전 분리 구성은 [설계 보관본](../archive/container-instances/ARCHIVE.md), 현행 실행·검증 상태는 [운영 현황](../OPERATIONS.md)을 따른다. 알림 개선은 별도 작업 중이므로 여기서 완료로 기록하지 않는다.

## Wiki에 넣을 문서 5개

초기에는 검토한 Article을 직접 작성한다. NVIDIA 추출 성공을 기다릴 필요가 없고, 대화 전체·인증 정보·실제 세션을 외부 모델로 보낼 필요도 없다.

| 문서 | 담을 내용 | 태그 예시 |
| --- | --- | --- |
| Atlas에서 Agent Wiki까지 | 위 역사와 각 결정 문서 연결 | `agent-observatory`, `agent-session-atlas`, `sessions`, `agent-wiki` |
| Wiki를 독립 제품으로 분리한 이유 | 포털 전제의 대체, 주 용례, 수집 계약의 자유 | `agent-observatory`, `agent-wiki`, `제품 결정` |
| 임베딩 없이 시작하는 근거 검색 | 현재 조회 방식, 제약, 후속 후보 | `agent-observatory`, `agent-wiki`, `검색` |
| 단일 OCI VM을 선택한 이유 | 이전 대안과 최종 구성, 비용 경계, 허용한 중단 | `agent-observatory`, `agent-wiki`, `oci` |
| 첫 배포에서 확인한 것과 남은 일 | 검증 근거·당시 개정, 현재 미완료 항목 | `agent-observatory`, `agent-wiki`, `운영` |

문서마다 **결정·이유·근거·확인 시점**을 짧게 남긴다. 과거 대안에는 “현재 미채택”을 명시하고 현재 결정을 연결한다. 역사 기록을 새 결정으로 덮어쓰지 않는다. 초기에는 본문과 문서 연결로 표현하고, 자동 대체 관계 해석이 구현됐다고 주장하지 않는다.

레포 문서는 이 초안의 출처다. 실사용 지식은 서버 Wiki에서 편집하며, 이후 Git과 Wiki 사이에 자동 양방향 동기화를 가정하지 않는다. 준비 단계에서 비밀·리소스 식별자를 제외하고 실제 원문 링크와 확인 시점을 남긴다.

## 첫 조회에서 확인할 질문

1. “Atlas와 Sessions가 지금 Wiki와 무슨 관계야?” → 계보와 독립 경계를 함께 설명한다.
2. “왜 임베딩을 안 쓰고 있어?” → 현재 검색 방식과 보류 이유를 인용한다.
3. “왜 Container Instances 대신 VM을 선택했어?” → 당시 대안과 최종 결정을 구분한다.
4. “NVIDIA 추출과 배포가 둘 다 끝났어?” → 배포 확인과 추출 미확인을 구분한다.
5. “백업 복원은 몇 분 걸려?” → 구현·측정 근거가 없다고 답한다.

이후 현재 결정을 한 번 정정하고 다시 조회해 새 개정이 반영되는지 확인한다. 첫 순서는 **지식 5개 작성 → Workspace 전용 조회 키로 에이전트 연결 → 위 질문 검증**이다. 다중 태그 조합 검색·추출 자동화는 이 흐름 다음에 보완한다.
