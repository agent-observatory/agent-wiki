# Agent Wiki 그림과 레퍼런스

[문서 안내](../README.md) · [아키텍처](architecture.md) · [수집·정제 계약](agent-memory.md)

**그림은 작업 에이전트, 읽기 전용 Collector, 원격 Worker의 역할을 구분한다.** 현재 저장·조회 API·웹의 배포 상태는 [운영 현황](../OPERATIONS.md)을 따른다.

![작업 에이전트·별도 Collector·원격 Wiki와 DNS·인증서](../assets/wiki-deployment.svg)

![수집·정제와 사용자 조회의 분리](../assets/wiki-layers.svg)

![불변 원문·별도 정제 실행·지식 개정의 리니지](../assets/wiki-lineage.svg)

![사용자 작업과 별도 수집·정제의 운영](../assets/wiki-operations.svg)

[프로젝트 역사](project-history.md)는 원격 Wiki에서 관리한다. [서버 Worker 정제](../archive/server-ingest/ARCHIVE.md)와 [Container Instances 구성](../archive/container-instances/ARCHIVE.md)은 과거 설계 보존본이다.

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
