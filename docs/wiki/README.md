# Agent Wiki 설계와 레퍼런스

[문서 안내](../README.md) · [아키텍처](architecture.md) · [디자인 규칙](../DESIGN.md)

주 흐름은 에이전트의 질의 → 근거 Context 조회 → 현재 에이전트의 답변·작업이다. 웹 위키는 편집·정정·출처 확인을 보조한다.

[개인 에이전트 사용법·계약](agent-memory.md)에 계약·CLI·Skill·초기화·검증 순서를 정리했다. 그림에 맞춘 새 코드의 로컬 검증을 완료했으며 운영 전환은 진행 중이다. 실제 동작은 [운영 현황](../OPERATIONS.md)을 따른다.

개발 모드에서는 DB·원문·기존 지식을 초기화하고 하위 호환성 없이 새로 만든다. 첫 실증은 [Atlas에서 Agent Wiki까지의 역사](project-history.md)를 실제 원문에서 다시 정제하는 것이다. 메뉴별 URL에서 지식·원문·반영 이력·연결·사용법을 연다.

![개인 에이전트 정제와 L1–L5](../assets/wiki-layers.svg)

![개인 에이전트와 원격 Wiki 4개 컨테이너](../assets/wiki-deployment.svg)

![원문·정제·지식 개정의 리니지](../assets/wiki-lineage.svg)

![Worker 없는 운영과 기존 모니터링](../assets/wiki-operations.svg)

이전 구성: [서버 Worker 정제](../archive/server-ingest/ARCHIVE.md) · [Container Instances 분리 구성](../archive/container-instances/ARCHIVE.md). 보존본은 설계 이력이며 현재 목표나 운영 데이터 백업이 아니다.

## 레퍼런스

사용자가 제공한 원본 자료와 메모다. 자료별 참고 요소는 [아키텍처](architecture.md#레퍼런스에서-가져올-요소)에 정리한다.

1. [여기어때 - AI가 내 하루를 기억하게 하는 법 (1/2) — 먼저 기억할 곳을 만들었다: 개인 LLM 위키](https://medium.com/gccompany/ai%EA%B0%80-%EB%82%B4-%ED%95%98%EB%A3%A8%EB%A5%BC-%EA%B8%B0%EC%96%B5%ED%95%98%EA%B2%8C-%ED%95%98%EB%8A%94-%EB%B2%95-1-2-%EB%A8%BC%EC%A0%80-%EA%B8%B0%EC%96%B5%ED%95%A0-%EA%B3%B3%EC%9D%84-%EB%A7%8C%EB%93%A4%EC%97%88%EB%8B%A4-%EA%B0%9C%EC%9D%B8-llm-%EC%9C%84%ED%82%A4-dd6a3158d9a0)
2. [여기어때 - AI가 내 하루를 기억하게 하는 법 (2/2) — 오늘이 위키로 들어오기까지: 데일리 루프](https://medium.com/gccompany/ai%EA%B0%80-%EB%82%B4-%ED%95%98%EB%A3%A8%EB%A5%BC-%EA%B8%B0%EC%96%B5%ED%95%98%EA%B2%8C-%ED%95%98%EB%8A%94-%EB%B2%95-2-2-%EC%98%A4%EB%8A%98%EC%9D%B4-%EC%9C%84%ED%82%A4%EB%A1%9C-%EB%93%A4%EC%96%B4%EC%98%A4%EA%B8%B0%EA%B9%8C%EC%A7%80-%EB%8D%B0%EC%9D%BC%EB%A6%AC-%EB%A3%A8%ED%94%84-595f8a2a7c3a)
3. [Andrej Karpathy의 LLM Wiki 제안 — Gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).
4. [NAVER D2 영상 — Context Provider·OpenMetadata 관련 자료](https://tv.naver.com/v/101632926). 사용자 메모: Context Provider라는 이름으로 구축하면서 OpenMetadata를 활용한 사례.
5. [Obsidian 커뮤니티의 Karpathy Wiki 플러그인](https://community.obsidian.md/plugins/karpathywiki) · [관련 GeekNews 글](https://news.hada.io/topic?id=28208). 사용자 메모: 그래프 방식을 활용하기 위해 Obsidian을 차용한 사례.
6. [sdyckjq-lab/llm-wiki-skill](https://github.com/sdyckjq-lab/llm-wiki-skill). 사용자 메모: 커뮤니티에서 만든 LLM Wiki Skill 구현 사례.
7. [OpenMetadata 원본 저장소](https://github.com/open-metadata/OpenMetadata). 사용자 제안: 제품 전체 도입과 별개로 Memory·Semantics·Lineage 등 지식 구조를 참고.
8. [무신사 기술 블로그 — AI Native 조직은 도메인 지식을 어떻게 공유하는가](https://techblog.musinsa.com/ai-native-%EC%A1%B0%EC%A7%81%EC%9D%80-%EB%8F%84%EB%A9%94%EC%9D%B8-%EC%A7%80%EC%8B%9D%EC%9D%84-%EC%96%B4%EB%96%BB%EA%B2%8C-%EA%B3%B5%EC%9C%A0%ED%95%98%EB%8A%94%EA%B0%80-f2e3de607df3) — 표준 위에 얹는 시맨틱 레이어. Kyungjae Lee, 2026-08-25. 2026-09-12 브라우저에서 본문 확인. 표준 기반 Core와 조직 특화 Overlay의 ID 참조, 현재 동작의 코드 검증, 생성 지식의 검증·사람 리뷰를 참고한다. 150개 질문의 ON/OFF 비교이며, 평면 문서 대비 2층 구조의 우월성을 입증한 실험은 아니다.

분석에 사용한 공식 기술 문서: [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) · [SKOS](https://www.w3.org/TR/skos-primer/). 구체적인 비교·적용 범위는 아키텍처에 기록한다.
