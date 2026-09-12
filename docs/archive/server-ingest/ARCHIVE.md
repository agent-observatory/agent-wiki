# 서버 정제 구성 보존본

초기 서버 정제에서 개인 에이전트 정제로 전환을 검토하던 당시의 문서·그림·생성기다. 현재는 다시 원격 Worker를 사용하지만 작업 큐·수집 계약은 이 보존본과 다르다. 현재 목표나 전환 완료 증거로 사용하지 않는다. 운영 데이터 백업도 아니다.

- [당시 아키텍처](architecture.md)
- [계층도](wiki-layers.svg) · [배포도](wiki-deployment.svg) · [운영도](wiki-operations.svg)
- 재생성: 저장소 루트에서 `python3 docs/archive/server-ingest/generate-wiki-diagrams.py`
- [현재 목표](../../wiki/architecture.md) · [실행·배포 상태](../../OPERATIONS.md)

NVIDIA Worker·pg-boss를 포함한 5개 컨테이너 구성을 보존한다. 개인 에이전트 전환 계획을 처음 논의한 안내와 기존 참고 자료도 포함한다.
