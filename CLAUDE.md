@AGENTS.md

# Claude Code에서 이어서 작업하기

이전 대화를 전제로 하지 않는다. [docs/README.md](docs/README.md)에서 현재 범위와 미결 사항을 확인한 뒤 [Wiki 문서 안내](docs/wiki/README.md)와 [아키텍처](docs/wiki/architecture.md)를 읽는다.

공통 작업 원칙은 위의 `AGENTS.md`를 따른다. 저장·조회 앱은 배포되어 있다. 별도 Collector·백그라운드 정제는 미구현 설계다. 활성 대화의 시작·종료·매 턴에 수집·정제를 자동 실행하지 않는다. 필요한 근거 조회와 명시적인 수동 기록 요청만 현재 대화에서 수행한다. 현재 개발 모드에서는 사용자 승인에 따라 Wiki 데이터를 초기화하고 하위 호환성 없이 교체할 수 있다. 이번 작업 범위와 실제 상태는 `AGENTS.md`와 `docs/OPERATIONS.md`를 따른다.
