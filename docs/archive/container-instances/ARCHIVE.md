# 이전 Container Instances 분리 설계

사용자 요청으로 보존한 이전 설계다. 현재 운영안은 [단일 VM 설계](../../architecture.md)를 따른다. 이 폴더의 사양·자격·운영 지침은 현재 결정이 아니다.

- [배포도](docs/assets/wiki-deployment.svg) · [운영도](docs/assets/wiki-operations.svg) · [계층도](docs/assets/wiki-layers.svg)
- [이전 아키텍처](docs/wiki/architecture.md) · [이전 생성기](scripts/generate-wiki-diagrams.py)
- 이 폴더에서 `python3 scripts/generate-wiki-diagrams.py`를 실행하면 보존한 그림만 재생성한다.

문서·SVG·아이콘과 라이선스·생성기만 보관했다. 인증 정보·실제 데이터·클라우드 자원은 포함하지 않는다. `snapshot-sha256.json`은 보존 시점의 원본 해시다. 운영 데이터 백업을 추가한 것이 아니다.
