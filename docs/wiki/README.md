# Agent Wiki 설계와 레퍼런스

[문서 안내](../README.md) · [아키텍처](architecture.md) · [디자인 규칙](../DESIGN.md)

주 흐름은 에이전트의 질의 → 근거 Context 조회 → 현재 에이전트의 답변·작업이다. 웹 위키는 편집·정정·출처 확인을 보조한다.

첫 실사용 자료는 [Atlas에서 Agent Wiki까지의 프로젝트 역사](project-history.md)로 제안한다. 개인 작업 Workspace·다중 태그와 초기 지식 5개, 조회 검증 질문을 함께 정리했다.

아래 그림은 A1 Compute VM 1대·2 OCPU·12GB에 앱과 PostgreSQL을 함께 두는 설계안이다. Compose로 실행하고 DB·Caddy 상태는 연결 볼륨에 보관한다. 실제 구축·배포 상태는 [운영 현황](../OPERATIONS.md)을 따르며 [이전 분리 구성 그림·생성기](../archive/container-instances/ARCHIVE.md)는 별도로 보존했다.

![원천 자료부터 근거 있는 응답까지의 L1–L5](../assets/wiki-layers.svg)

![단일 A1 VM과 연결 볼륨](../assets/wiki-deployment.svg)

![배포·모니터링](../assets/wiki-operations.svg)

## 레퍼런스

사용자가 제공한 원본 자료와 메모다. 자료별 참고 요소는 [아키텍처](architecture.md#레퍼런스에서-가져올-요소)에 정리한다.

1. [여기어때 - AI가 내 하루를 기억하게 하는 법 (1/2) — 먼저 기억할 곳을 만들었다: 개인 LLM 위키](https://medium.com/gccompany/ai%EA%B0%80-%EB%82%B4-%ED%95%98%EB%A3%A8%EB%A5%BC-%EA%B8%B0%EC%96%B5%ED%95%98%EA%B2%8C-%ED%95%98%EB%8A%94-%EB%B2%95-1-2-%EB%A8%BC%EC%A0%80-%EA%B8%B0%EC%96%B5%ED%95%A0-%EA%B3%B3%EC%9D%84-%EB%A7%8C%EB%93%A4%EC%97%88%EB%8B%A4-%EA%B0%9C%EC%9D%B8-llm-%EC%9C%84%ED%82%A4-dd6a3158d9a0)
2. [여기어때 - AI가 내 하루를 기억하게 하는 법 (2/2) — 오늘이 위키로 들어오기까지: 데일리 루프](https://medium.com/gccompany/ai%EA%B0%80-%EB%82%B4-%ED%95%98%EB%A3%A8%EB%A5%BC-%EA%B8%B0%EC%96%B5%ED%95%98%EA%B2%8C-%ED%95%98%EB%8A%94-%EB%B2%95-2-2-%EC%98%A4%EB%8A%98%EC%9D%B4-%EC%9C%84%ED%82%A4%EB%A1%9C-%EB%93%A4%EC%96%B4%EC%98%A4%EA%B8%B0%EA%B9%8C%EC%A7%80-%EB%8D%B0%EC%9D%BC%EB%A6%AC-%EB%A3%A8%ED%94%84-595f8a2a7c3a)
3. [Andrej Karpathy의 LLM Wiki 제안 — Gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).
4. [NAVER D2 영상 — Context Provider·OpenMetadata 관련 자료](https://tv.naver.com/v/101632926). 사용자 메모: Context Provider라는 이름으로 구축하면서 OpenMetadata를 활용한 사례.
5. [Obsidian 커뮤니티의 Karpathy Wiki 플러그인](https://community.obsidian.md/plugins/karpathywiki) · [관련 GeekNews 글](https://news.hada.io/topic?id=28208). 사용자 메모: 그래프 방식을 활용하기 위해 Obsidian을 차용한 사례.
6. [sdyckjq-lab/llm-wiki-skill](https://github.com/sdyckjq-lab/llm-wiki-skill). 사용자 메모: 커뮤니티에서 만든 LLM Wiki Skill 구현 사례.
7. [OpenMetadata 원본 저장소](https://github.com/open-metadata/OpenMetadata). 사용자 제안: 제품 전체 도입과 별개로 Memory·Semantics·Lineage 등 지식 구조를 참고.

분석에 사용한 공식 기술 문서: [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) · [SKOS](https://www.w3.org/TR/skos-primer/). 구체적인 비교·적용 범위는 아키텍처에 기록한다.
