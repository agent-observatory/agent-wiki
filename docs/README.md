# Agent Wiki 문서

**agent-wiki-client 하나로 설치하고, 조회와 백그라운드 수집·원격 정제를 분리해 실행한다.** 기능별 배포·검증 상태는 [운영 현황](OPERATIONS.md)을 따른다.

| 파일 | 무엇을 보나 |
| --- | --- |
| [architecture.md](architecture.md) | 전체 구성·계층·앱·인프라·조회 |
| [l2-l3-memory.md](l2-l3-memory.md) | L2·L3: 증분·결정 변경·통합(Consolidation, 설계)·에이전트 검토·실험·재생성 |
| [OPERATIONS.md](OPERATIONS.md) | 현재 구현·실제 배포·검증 결과·남은 작업 |
| [client-and-api.md](client-and-api.md) | Client 설치·연결, 접힌 수집·API 계약 |
| [DESIGN.md](DESIGN.md) | UI·문서·SVG 디자인 규칙 |
| [AGENTS.md](../AGENTS.md) | 에이전트 작업 원칙 |
| [레퍼런스](#레퍼런스) | 참고한 외부 자료와 무엇을 가져왔는지 |

## 읽는 순서

**사람은 `architecture.md`의 그림과 표를 먼저 본다.** 구현 에이전트는 관련 상세 계약과 `OPERATIONS.md`의 현재 상태를 이어 읽는다. 설치가 필요할 때만 `client-and-api.md`를 읽는다. 수집·API 상세 계약은 구현 에이전트의 참고다.

## 유지할 원칙

- 주 용례는 에이전트의 근거 조회다. 조회 Skill·Wiki CLI·Collector는 하나의 설치 패키지에 포함되며 수집은 작업 대화와 독립적으로 실행한다.
- Workspace는 격리 단위, Folder·Tag는 분류다. 불변 L1에서 정제 실행과 L3 지식 Version까지 근거를 연결한다.
- 원문은 텍스트·이미지를 분리해 zstd로 보관한다. L2는 텍스트만 처리하고 L4 조회에는 모델을 호출하지 않는다.
- 기존 OCI 단일 VM과 Object Storage를 사용한다. OCI 유료 자원 추가·백업·임베딩 도입은 현재 범위 밖이다.
- 설계는 아키텍처에, 명령·계약은 사용법에, 실제 구현·배포·검증은 운영 현황에 기록한다. 과거 설계는 `archive/`에 보존하며 현재 지침으로 읽지 않는다.

현재는 개발 모드다. 사용자 요청 범위에서 데이터를 재구성할 수 있으며 운영 모드 선언 후 보존 정책을 다시 정한다. 프로젝트 역사와 리니지는 원격 Wiki에 쌓고 로컬 문서에 중복 관리하지 않는다.

## 레퍼런스

사용자가 제공한 외부 자료와 메모를 한곳에 모은다. 자료별로 **무엇을 참고하고 무엇은 참고하지 않는지**는 [아키텍처의 가져올 요소 표](architecture.md#레퍼런스에서-가져올-요소)에 정리한다. 여기 있는 자료의 채택을 뜻하지 않으며, 확인 시점을 함께 남긴다.

### 지식 위키·SSOT

1. [Andrej Karpathy의 LLM Wiki 제안 — Gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). 원본·정리된 위키·운영 규칙의 분리.
2. [LY Corporation — LLM Wiki: 코드 기준으로 자동 최신화되는 도메인 지식 SSOT 만들기](https://techblog.lycorp.co.jp/ko/llm-wiki-code-driven-knowledge-ssot). 윤석범(LINE Plus). 2026-09-17 확인. **Raw 층(원본 맥락·변경 이력)과 Knowledge 층(현재 유효한 문서)의 2층 구조**가 우리 L1/L3와 같은 모양이다. 추출 Skill → ingest·lint Workflow → PR 머지 시 GitHub Actions 자동 실행이고, 서비스 간 추적을 위해 **식별자를 바꾸지 않는다**. 모호한 지점은 기준 문서를 만들 때 사람이 확인하고 명세 PR을 사람이 리뷰한다. 우리와 다른 점: 그쪽 SSOT는 **코드**여서 자동 최신화의 기준이 결정적이지만, 우리 SSOT는 대화 기록이라 기준이 비결정적이다. 그래서 우리는 lint에 해당하는 자리를 검증 게이트와 사람 검수로 채운다.
3. [여기어때 — AI가 내 하루를 기억하게 하는 법 (1/2) · 개인 LLM 위키](https://medium.com/p/dd6a3158d9a0) · [(2/2) 데일리 루프](https://medium.com/p/595f8a2a7c3a). 사람이 탐색할 목차·문서 연결, 일별 기록이 위키로 들어오는 반복 흐름.
4. [sdyckjq-lab/llm-wiki-skill](https://github.com/sdyckjq-lab/llm-wiki-skill). 커뮤니티 LLM Wiki Skill 구현. 추출·추론·미확인의 구분.
5. [Obsidian 커뮤니티 Karpathy Wiki 플러그인](https://community.obsidian.md/plugins/karpathywiki) · [GeekNews 소개](https://news.hada.io/topic?id=28208). 사용자 메모: 그래프 방식을 위해 Obsidian을 차용한 사례.
6. [무신사 — AI Native 조직은 도메인 지식을 어떻게 공유하는가](https://techblog.musinsa.com/ai-native-%EC%A1%B0%EC%A7%81%EC%9D%80-%EB%8F%84%EB%A9%94%EC%9D%B8-%EC%A7%80%EC%8B%9D%EC%9D%84-%EC%96%B4%EB%96%BB%EA%B2%8C-%EA%B3%B5%EC%9C%A0%ED%95%98%EB%8A%94%EA%B0%80-f2e3de607df3). Kyungjae Lee, 2026-08-25. 2026-09-12 확인. 표준 Core + 조직 Overlay의 ID 참조, 코드 검증과 사람 리뷰. **150개 질문의 ON/OFF 비교이며 평면 문서 대비 2층 구조의 우월성을 입증한 실험은 아니다.**

### 메타데이터·맥락 제공

7. [OpenMetadata](https://github.com/open-metadata/OpenMetadata). 제품 전체 도입과 별개로 Memory·Semantics·Lineage 등 지식 구조를 참고.
8. [NAVER D2 발표 소개](https://d2.naver.com/helloworld/7056385) · [영상](https://tv.naver.com/v/101632926). 사용자 메모: Context Provider라는 이름으로 구축하며 OpenMetadata를 활용한 사례. 표에 적은 범위는 공식 발표 소개에서 확인한 것까지다.

### 결정적 파이프라인과 모델 판단의 분리

9. [alibaba/open-code-review](https://github.com/alibaba/open-code-review). 2026-09-16 확인. 파일 선별·묶음·룰 매칭·위치 보정을 **결정적 엔지니어링**이 소유하고 LLM은 그 안에서 판단만 한다. "언어로 지시하는 것보다 안정적이고 예측 가능하다"는 것이 그쪽 주장이다. 우리 정제 하네스(어휘를 코드가 정하고 모델은 고른다)의 직접적인 근거다. 다만 그쪽은 **한 항목을 고정 분류체계에 넣는** 문제고, 우리의 미해결 문제인 대체 판정은 **시간을 가로지르는 쌍 관계**라 그대로 옮겨오지는 않는다.

### 문서 그림

10. [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design). 2026-09-15 확인. 삭제 우선·밀도 상한·4px 그리드·직교 연결선·라벨 간격 규칙을 [DESIGN.md](DESIGN.md#밀도와-연결선)에 옮겼다. 흰 배경 금지·전용 글꼴(한글 미지원)·단일 코랄 강조는 채택하지 않았다.

### 어노테이션·시맨틱 레이어·온톨로지의 구분

11. [요즘IT — 10분 만에 온톨로지(Ontology) 이해하기](https://yozm.wishket.com/magazine/detail/3951/). 김영욱. 2026-09-17 확인. **어노테이션**(낱개 오브젝트의 설명 라벨, 연결도 계산도 없다) · **시맨틱 레이어**(지표를 한 곳에서 한 번 정의해 모든 도구가 같은 계산을 하게 하는 층, 정의하지 않은 사실은 만들지 못한다) · **온톨로지**(클래스·관계·규칙으로 아무도 적지 않은 결론을 스스로 도출한다)의 구분. 판별 한 줄은 "직접 입력하지 않은 결론을 규칙과 사실을 엮어 꺼낼 수 있는가"다. 권고는 시맨틱 레이어로 핵심 지표부터 모으고 온톨로지는 용어집 수준으로 가볍게 시작하라는 것이다. 우리 대응: Claim의 본문·근거가 어노테이션, `scope`·`type`의 닫힌 목록과 관계 게이트·`effectiveClaimState`가 시맨틱 레이어, 저장되지 않은 `superseded`·`conflicted`와 대표 주장을 도출하는 `effectiveClaimState`·`supportClusters`가 아주 작은 온톨로지다. **우리와 다른 점:** 그쪽 규칙은 속성값("매출 100만 초과")에서 결론을 내지만 우리 규칙은 관계의 모양에서만 상태를 내며 시각·유사도로 대체를 도출하지 않는다. 그리고 `subject`는 아직 정의 층이 없는 라벨이고, 이 글이 말하는 "용어집"에 해당하는 `glossary`·`aliases`는 스키마와 검색 경로만 있을 뿐 운영 데이터가 비어 있다.

### 공식 기술 문서

- [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) · [SKOS](https://www.w3.org/TR/skos-primer/). 출처·파생 관계와 개념 어휘의 용어를 참고했다. 제품에 두 표준을 구현하지는 않았고, 우리 `subject` 어휘는 SKOS의 개념 체계가 아니라 주제별 slug 목록이다.
