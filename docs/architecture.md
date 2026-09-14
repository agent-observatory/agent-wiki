# Agent Wiki 아키텍처

**사용자의 작업과 기록의 수집·정제를 분리한다. 수정·검토는 에이전트·CLI로 수행한다. 웹은 지식 뷰어이며 AI 연결 편집·테스트와 자동 정제 중지·재개도 제공한다.** Claude·Codex는 사용자와 작업하고 필요할 때 Wiki를 조회한다. 단일 설치하는 Agent Wiki Client의 백그라운드 Collector가 클라이언트 기록을 읽어 원격에 보관하고, 원격 Worker가 텍스트를 청킹해 정제한다.

읽기 전용 Collector → 불변 원문 → 원격 Worker → 근거가 있는 지식 개정으로 이어진다. 배포·실제 모델 검증 상태는 [운영 현황](OPERATIONS.md), 연결과 API는 [사용법·수집 계약](client-and-api.md), 정제·지식 모델은 [L2·L3 기억 설계](l2-l3-memory.md)를 따른다.

## 계층 이름

| 계층 | 이름 | 역할 |
| --- | --- | --- |
| L1 | Raw Sources | 정제 전 원천 자료 보관 |
| L2 | Curation | 필요한 주장·근거 추출, 기존 지식과 비교·검증·반영 |
| L3 | Knowledge | Claims·Wiki Pages와 근거·변경 이력 관리 |
| L4 | Query | 필요한 지식 검색·Context 구성 |
| L5 | Answers | 에이전트의 답변·작업에 활용 |

이 계층은 Agent Wiki의 제품 설계다. 메뉴·화면 제목·그림에는 위 영어 이름을 그대로 쓰고, 역할 설명은 한국어로 쓸 수 있다. Agent Wiki는 제품명이며 L3의 이름과 구분한다.

주장·결정과 페이지의 용어 및 상세 그림은 [L3 지식 구성](l2-l3-memory.md#주장과-위키-페이지)에서 함께 설명한다.

## 전체 구성

### 단일 VM · K3s

아키텍처 그림은 이 한 장이다. 사용자 기기의 에이전트·CLI·Collector, 단일 VM 안의 K3s·Traefik·Web·API·Worker·PostgreSQL·영속 볼륨, VM 밖의 Object Storage·AI Provider·DNS·인증서 발급 기관과 그 사이의 조회·수집·저장 경로를 담는다. L1 → L3 정제는 [L1–L5와 지식 모델](#l1l5와-지식-모델), L4 → L5 조회는 [L4 · Query / L5 · Answers](#l4--query--l5--answers)의 그림에 둔다. 그림은 이 세 장이 전부다.

![아키텍처 한 장. 사용자 기기의 Codex·Claude Code·agent-wiki-client와 단일 OCI VM 안의 K3s·Traefik·Web·API·Worker·PostgreSQL·PVC, VM 밖의 Object Storage·AI Provider·DuckDNS·인증서 발급 기관. Collector는 압축 증분을 Object Storage에 직접 올리고 Worker가 검증·등록·정제한다](assets/wiki-architecture.svg)

<details>
<summary>K3s 구성의 책임</summary>

- 기존 A1 VM 한 대에서 K3s server·containerd와 앱을 함께 실행한다. Web·API·Worker는 Deployment, PostgreSQL은 StatefulSet으로 표현한다.
- Traefik이 ServiceLB의 80/443 진입점에서 Ingress 경로 규칙에 따라 내부 Service로 전달한다. DuckDNS는 VM 주소를 가리키며 HTTP 중계 서버가 아니다.
- cert-manager가 ACME 인증서를 발급·갱신하고 TLS Secret을 Traefik에 제공한다. 인증서 발급 기관은 사용자 요청의 중계 경로에 두지 않는다.
- PostgreSQL은 PVC → local PV → 기존 Block Volume의 마운트 경로를 사용한다. PV는 Retain·노드 고정으로 관리하며 K3s 상태(SQLite·Secrets)도 같은 디스크의 별도 경로에 둔다. 물리 볼륨을 Pod마다 새로 생성하지 않는다.
- requests/limits·readiness·정상 종료와 NetworkPolicy를 선언한다. CPU 여유 공유는 VM 자원 안에서만 가능하다. 수치·통신 허용 목록은 [단일 Compute VM 배포](#단일-compute-vm-배포)와 `scripts/render-k3s.py`를 따른다. 일반 Ingress의 경로 라우팅과 NetworkPolicy의 ingress/egress 통신 제어를 구분한다.
- 원문은 기존 Object Storage를 유지한다. Collector 직접 업로드·Worker의 DB 작업 처리·L1–L5 역할은 바뀌지 않는다. 단일 노드 장애와 앱의 멱등성·재시도 책임은 유지한다.

기술 기준: [K3s 단일 노드](https://docs.k3s.io/architecture) · [기본 네트워크 구성](https://docs.k3s.io/networking/networking-services) · [cert-manager](https://cert-manager.io/docs/usage/certificate/).

K3s 제어·실행 상자는 별도 VM이나 새 Wiki 앱이 아니다. 같은 VM의 `k3s server` 서비스가 관리하는 API Server·Scheduler·kubelet·containerd 등을 묶어 표현한다. SQLite는 파일 기반 상태 저장이며 TLS Secret은 Kubernetes 데이터 객체다.

| 구성 | 포트·접속 범위 |
| --- | --- |
| Traefik / ServiceLB | 외부 TCP 80·443 → 내부 Web/API Service |
| Web | Service·Pod TCP 3000, 내부 전용 |
| API | Service·Pod TCP 3001, 내부 전용 |
| PostgreSQL | 내부 TCP 5432. 기존 사용자 선택인 공인 5432/TLS 직접 관리 접속도 유지하는 설계 |
| Worker / Collector / CLI | 수신 서버 없음. API·Object Storage·AI에 요청하는 클라이언트 |
| Kubernetes API Server | TCP 6443, 외부 비공개. 관리 명령은 VM 내부에서 실행 |
| kubelet / Scheduler / Controller Manager | TCP 10250 / 10259 / 10257, 내부 관리용 |
| containerd | 로컬 Unix socket, 실행·로그 스트림은 로컬 TCP 10010 |
| SQLite / TLS Secret / PVC·PV / Block Volume | 애플리케이션 수신 포트 없음 |
| CoreDNS | 내부 UDP·TCP 53 |
| cert-manager | 내부 Webhook Service 443 → Pod 10250, ACME 발급 기관으로 외부 HTTPS 443 요청 |
| Object Storage / AI Provider / 인증서 발급 기관 | 외부 서비스의 HTTPS 443으로 요청 |

이 표는 접속 범위의 설계 기준이다. 실제 개방·차단 검증 결과는 운영 현황에서 구분한다. Web/API/DB는 현재 앱 설정에서 확인한 포트를 유지한다. 게이트웨이 80/443은 외부 Service 포트이며 Traefik Pod의 targetPort와 구분한다. 관리 포트·Webhook·메트릭의 실제 바인딩은 설치 버전의 설정으로 검증한다. **외부에서 앱을 조회하는 진입점은 Gateway지만, DB 직접 관리 접속은 별도 예외다.** Flannel VXLAN 8472/UDP는 다중 노드 통신용이며 인터넷에 공개하지 않는다. 단일 노드 SQLite 구성에는 etcd 2379/2380을 열지 않는다.

포트 기준: [K3s 요구사항](https://docs.k3s.io/installation/requirements) · [Kubernetes 관리 포트](https://kubernetes.io/docs/reference/networking/ports-and-protocols/) · [cert-manager Webhook](https://cert-manager.io/v1.18-docs/troubleshooting/webhook/).

</details>

K3s의 실제 배포·검증 결과는 [운영 현황](OPERATIONS.md#k3s-전환)에서 확인한다.

### 애플리케이션 이름

제품명은 **Agent Wiki**, 로컬 설치 패키지는 **agent-wiki-client**다. 앱 이름은 역할을 나타내고 실제 명령·Kubernetes 리소스는 아래처럼 연결한다.

설치 구성의 상하 관계는 다음과 같다. **CLI와 Collector는 client에 포함된 형제 구성**이며, client가 두 프로세스를 감싸서 실행하는 별도 서버는 아니다.

```text
Agent Wiki (제품)
├─ agent-wiki-client (로컬 설치 패키지)
│  ├─ agent-wiki-cli (명령 실행)
│  ├─ agent-wiki-collector (백그라운드 수집)
│  └─ Agent Wiki Skill 원본 (설치할 지침 파일)
└─ 원격 운영 구성
   ├─ agent-wiki-gateway / web / api / worker
   └─ agent-wiki-db / sources / data
```

설치 후의 조회 Skill은 **Codex·Claude Code가 읽는 위치**에 놓인다. 아키텍처 그림에는 이 실행 시 위치를 표시한다. 앱 이름·실제 명령·기술의 대응은 아래 표를 따른다.

| 이름 | 역할 | 구현·실행 위치 |
| --- | --- | --- |
| `agent-wiki-client` | CLI·Collector·Skill을 함께 배포하는 로컬 패키지 | `@agent-observatory/agent-wiki-client`, `packages/agent-wiki-client` |
| `agent-wiki-cli` | 검색·조회와 연결·수집 관리 명령 | `agent-wiki`, `packages/agent-wiki-client/cli/agent-wiki.mjs` |
| `agent-wiki-collector` | 작업 대화와 독립된 백그라운드 수집 | `agent-wiki collector`, `packages/agent-wiki-client/collector` |
| `agent-wiki` 조회 Skill | 조회 필요성·검색어·근거 활용 지침 | 패키지의 `skill/` → 에이전트가 읽는 프로젝트 폴더 |
| `agent-wiki-gateway` | HTTPS 진입점·웹/API 경로 분기 | Traefik, Helm release `agent-wiki-gateway` |
| `agent-wiki-web` | 웹 UI | Next.js, `apps/agent-wiki-web`, Deployment·Service `agent-wiki-web` |
| `agent-wiki-api` | 수집·검색·권한·지식 API | Fastify, `apps/agent-wiki-api`, Deployment·Service `agent-wiki-api` |
| `agent-wiki-worker` | 수신 검증·텍스트 정제 작업 | `apps/agent-wiki-worker`, Deployment `agent-wiki-worker` |
| `agent-wiki-db` | 지식·근거·수집/정제 상태 저장 | PostgreSQL, StatefulSet·Service `agent-wiki-db` |
| `agent-wiki-sources` | 불변 원문 보관 버킷 | OCI Object Storage |
| `agent-wiki-data` | DB·인증서 영속 데이터 볼륨 | OCI Block Volume |
| `agent-wiki-vm` | 서버 앱 실행 호스트 | OCI A1 Compute VM |

`agent-wiki-client`는 배포 단위다. 별도 상주 서버가 아니며, 내부 CLI·Collector를 각각 설치하지 않는다. 명령은 제품명과 같은 `agent-wiki`를 사용하고 설정은 `~/.agent-wiki/config.json`을 공유한다. Traefik·Next.js·Fastify·PostgreSQL은 각 컴포넌트의 기반 기술로 표시한다. Kubernetes 앱 리소스·컨테이너 이름은 그림의 고유 이름과 같다. API·Worker·Web의 이미지도 각각 같은 이름으로 게시한다. VM의 OCI 표시 이름도 `agent-wiki-vm`으로 맞춘다. 외부 서비스인 DuckDNS·인증서 발급 기관·AI Provider, 사용자 도구인 Codex·Claude Code는 별도로 구분한다. 설정 화면에 AI 연결과 Client 연결을 모은다. AI 설정은 웹·API의 기능이며 별도 앱이 아니다.

Skill 설치 명령은 패키지의 원본을 Codex `.agents/skills/agent-wiki`, Claude Code `.claude/skills/agent-wiki`로 복사한다. 에이전트가 설치된 지침을 발견·참고한 뒤 필요할 때 `agent-wiki-cli`의 검색 명령을 실행한다. [설치 명령](client-and-api.md#연결과-지침).

Skill 설치만으로 CLI가 매번 실행되지는 않는다. 작업 에이전트와 Collector는 별도 프로세스로 둔다. 세션 안에 수집 명령·정제 요청을 넣거나 턴 종료 훅에서 업로드를 기다리게 하지 않는다. Collector·정제 장애는 사용자 작업과 독립적으로 처리한다. 필요한 지식 조회에는 통신 시간이 들지만, 그 조회가 새 수집·정제 완료를 기다리지는 않는다.

기존 지식 후보는 L2에서 BM25와 규칙 재정렬로 선별하고 AI가 대상·범위·변경 의도를 비교한다. L3는 현재 결정만 저장하는 요약본이 아니다. 과거 주장·변경 이유·원문 근거를 관계로 보존하고 L4는 기본 현재 결정, 이력 조회는 변경 경로를 반환한다. [결정의 일대기와 검색 알고리즘](l2-l3-memory.md#결정의-일대기를-보존하는-계약).

Codex·Claude는 공통 수집 형식을 사용하되 원문 세션을 서로 합치지 않는다. 원본 메시지·부모·도구·컴팩션 출처를 L1에 보존하고, L2는 Workspace 전체에서 기존 주장을 비교한다. L3는 대상·범위·주장 중심이며 같은 결정에 양쪽 원문의 근거가 연결된다. 조회 Skill 설치와 클라이언트별 수집 활성화는 독립적이다.

## 세션 식별과 직접 업로드

**세션은 `Workspace + 에이전트 종류 + 원본 세션 ID`로 식별한다.** 에이전트 종류는 Codex·Claude Code다. 기기 ID는 수집 출처로 분리하고, 서버의 연속 수신 위치는 기기·파일 세대별로 관리한다. 같은 세션에 메시지 101~110이 추가되면, 이미 받은 1~100을 다시 보내지 않고 확인된 위치 이후만 전송한다.

Collector의 대화·도구 기록 선별·스냅샷 중복 제거 → API의 위치 확인·업로드 허가 → Collector의 마스킹·zstd 압축 → Object Storage 직접 업로드 → Worker의 검증·불변 L1 등록 → 별도 L2 정제 순서다. 큰 파일 본문은 Gateway·API를 통과하지 않는다. Worker는 정제할 때도 같은 Object Storage에서 원문 텍스트를 직접 읽는다. 임시 파일 도착만으로 적재 완료 처리하지 않으며 **중복 판정·불변 원문 등록·수신 위치 확정은 서버 책임**이다.

내용 해시는 전송 묶음의 동일성, 원본 세션 ID는 대화의 동일성을 판별한다. 일부 겹치는 기록은 서버가 별도로 대조한다. 앞부분 수정·파일 축소·다른 기기 수집에서는 오프셋을 그대로 신뢰하지 않는다. [수집 계약과 1~100 → 101~110 예시](client-and-api.md#세션-식별과-증분-수집).

## 책임과 비용 경계

| 구성 | 책임 | 실행 방식 |
| --- | --- | --- |
| 작업 에이전트 | 사용자 질답·업무, 필요한 지식·근거 조회 | CLI 조회 가능 |
| Collector | 허용 기록 읽기·마스킹·증분 압축·직접 업로드 | Codex·Claude JSONL, macOS 기본 10분 · 주기 설정 |
| 백그라운드 정제 | 원격 텍스트 청킹·기존 지식 비교·근거 연결 | VM Worker, Workspace별 외부 AI 설정 |
| 조회 Skill | 조회 조건·검색어·근거 활용 지침 | 지침만 제공. 프로세스·스케줄러 아님 |
| Wiki CLI | 단일 설치·설정·인증, 조회·반영·백그라운드 수집 관리 | `agent-wiki setup`, 조회 명령, `agent-wiki collector` · 외부 모델 호출은 원격 Worker |
| Wiki API | 업로드 허가·수신 검증 조율·중복/등록 판정·근거·개정·검색 | API와 비동기 수신 검증 |
| PostgreSQL / Object Storage | 지식·개정·정제 기록·근거 / 불변 원문 보관본 | 운영 중 |

Collector 자체는 모델을 호출하지 않는다. 세션·프로젝트·시간에 따른 수집 단위와, 의미에 따른 군집화를 구분한다. 후자는 별도 정제 실행의 일이며 임베딩은 필수가 아니다.

## L2 · Curation

**새 증분 + 세션 맥락 + 관련 Knowledge의 본문·근거**를 함께 읽고, 결정의 추가·정정·취소를 연결한다. 저장 조각과 정제 청크의 경계를 분리하며, 필요한 과거 구간만 추가 조회한다. 주장 관계는 기존 PostgreSQL에 저장한다.

L2는 같은 대상·범위에서 변경 의도를 판단하고, L3는 과거 주장과 대체·철회·충돌 근거를 보존한다. L4는 현재 결정을 묻는 조회와 변경 이유를 묻는 조회를 구분한다. 현재 채택한 결정과 검증된 사실은 별도 상태다.

[L2·L3 기억 설계 · 그림](l2-l3-memory.md)에서 입력 구성·결정 통합·재시도 기준을 본다. 모델·호출 한도도 그 문서에 모았다. 수집·CLI·API 계약은 [client-and-api.md](client-and-api.md), 구현 상태는 [운영 현황](OPERATIONS.md)에 둔다.

## L1–L5와 지식 모델

L1 → L3 정제는 아래 한 장이다. 위에서 아래로 **01 L1 증분 → L2 청크 추출(청킹 → 입력 조립 → AI 추출 → 서버 검증 → 반영, L3 현재 주장의 BM25 후보 되돌림, 출력 오류의 같은 청크 재시도, 관계만 실패한 반영의 대기함 지연), 02 추출이 L3에 남기는 통합 전 주장(같은 subject·scope에 current 둘, 제안, 대기함의 관계), 03 주제마다 관계만 판단하는 Consolidation Job의 gather → model → validate → publish, 04 그 결과인 Wiki Page 새 Version의 현재 주장 목록·클릭한 주장의 리니지 패널·검토와 relation reject**다. 03·04의 점선 테두리는 설계이며 미구현이다. 같은 그림을 [L2·L3 기억 설계](l2-l3-memory.md)가 자세히 설명한다.

![L1부터 L3까지 한 장. 01 세션 증분을 Worker가 청킹·입력 조립·AI 추출·서버 검증·반영으로 정제하고, L3 현재 주장의 BM25 후보를 입력 조립에 되돌리며, 출력 오류는 같은 청크를 다시 보내고, 관계만 실패한 반영은 주장을 반영한 뒤 관계를 통합 대기함에 넘긴다. 02 통합 전 L3에는 같은 subject·scope에 current 주장 A·B가 함께 남고 제안 D와 대기함의 관계가 있다. 03 Consolidation Job이 gather → model → validate → publish 네 Step으로 관계만 판단해 자동 반영하며 Step별 상태를 따로 기록한다. 04 Wiki Page 새 Version은 현재 주장만 나열하고 클릭한 주장의 리니지 패널이 B가 A를 대체한 관계와 이유를 보여준다. 검토의 relation reject는 정정 Version을 발행하고 거절을 기억한다. 점선 테두리는 설계·미구현](assets/wiki-l1-l3-curation.svg)

그림의 NVIDIA → Alibaba는 합성 예시다. **지식은 현재 결정과 변경 이유를 함께 보존하고, 원문 근거까지 역추적한다.** 추출은 청크마다 주장을 만들고, 통합은 주제마다 그 주장들 사이의 현재·이력 관계를 정한다. 리니지 패널은 그 관계를 사람이 읽는 방법이며, 통합이 끝나지 않은 주제는 **통합 대기**로 표시해 완성된 페이지로 오해하지 않게 한다. 통합·리니지 패널·relation reject의 규칙은 [통합 · Consolidation](l2-l3-memory.md#통합--consolidation--설계--미구현)에 있고 구현·배포는 아직 없다. 같은 대상·범위에서 변경 의도를 어떻게 가르는지(명시적인 변경·검토 의견·다른 적용 범위·불명확한 결론·늦게 수집된 발언)는 그림이 아니라 [주장과 관계 표](l2-l3-memory.md#주장과-관계)에 둔다.

L1–L5는 우리 제품의 논리 모델이며 공식 표준이나 실행 순서가 아니다. L2는 작업 세션과 분리된 정제 실행이다. L4는 Wiki 서버의 검색·근거 제공, L5는 작업 에이전트의 답변·작업을 맡는다. 실제 조회는 **L5 에이전트 → Wiki CLI → L4 검색 → 근거 반환 → L5 답변·작업**의 왕복이다. 조회 Skill은 판단 지침, Wiki CLI는 L5 에이전트가 사용하는 조회 도구다.

| 계층 | 역할 | 변경 기준 |
| --- | --- | --- |
| L1 · Raw Sources | 서버가 검증·등록한 대화·문서·코드 보관본 | 불변. 새 기록은 새 원문으로 추가 |
| L2 · Curation | 텍스트 청킹·기존 지식 비교·주장과 근거 연결 | 방법론은 개선 가능. 과거 실행과 입력은 보존 |
| L3 · Knowledge | Claims·Wiki Pages와 개정·관계 | 지식은 새 개정으로 갱신 |
| L4 · Query | 키워드 검색·시작 문서·인용 자료 구성 | 지식 개정과 근거를 고정해 반환 |
| L5 · Answers | 조회한 근거로 답변·작업 | 사용자 요청에 필요한 조회만 수행 |

Claim은 근거·범위·상태를 가진 주장이고 Decision은 사용자 결정 Claim이다. Wiki Page는 여러 Claim의 설명과 결정 변경 이력을 주제로 모은다. 세션 수·Claim 수·페이지 수는 서로 독립적이다.

Schema·Index·Log·Lint는 구조 규칙·목차·실행 이력·점검을 뜻한다. LLM Wiki·OpenMetadata의 용례를 참고하며 제품 전체를 설치하거나 우리 확장을 표준으로 부르지 않는다. 구조 검증과 해석의 타당성을 구분한다.

## 로직이 바뀔 때 개선하는 방법

**기존 원문과 지식을 유지하고 필요한 분석·조립만 다시 한다.** 분석 오류를 고친 개정과 사용자가 A에서 B로 결정을 바꾼 이력은 구분한다. 세 가지 재작업은 L1 → L3 그림의 서로 다른 위치로 다시 들어간다. Retry는 01의 서버 검증 → AI 재시도 루프, Reprocess의 후보는 04의 검토 카드, Reassemble은 04의 Wiki Page 새 Version이다. 설계 중인 Consolidation은 03이며 기존 주장 사이의 관계만 다시 판단한다.

| 변경 | 다시 하는 범위 | 결과 | AI 호출 |
| --- | --- | --- | --- |
| 일시 오류·잘못된 출력 · `Retry` | 실패한 청크부터 다시 실행. 성공한 청크·근거·처리 위치 유지 | 다음 처리 위치로 진행. 같은 청크·세대의 같은 출력 오류가 3회 연속이면 확인 필요로 남김. 인증·할당량 오류는 별도 분류 | 필요 시 |
| 추출·근거·주제 해석 개선 · `Reprocess` | 성공한 실행의 원문 범위를 고정하고 새 분석 또는 저장 출력 재검증 | 검토 후보. 기존 지식을 즉시 덮어쓰지 않고 에이전트가 개념별 차이를 설명한 뒤 사용자 확인으로 고정 Version에 반영 | 새 분석 1회 또는 호환되는 저장 출력 재검증 0회 |
| 제목 묶음·날짜·페이지 구성 개선 · `Reassemble` | 현재 Claims·Evidence를 제목별로 다시 구성 | 내용이 바뀐 주제만 Wiki Page 새 Version. 기존 Claim·검토 상태 유지, 과거 페이지도 조회 가능 | 없음 |

분석 정정은 사용자 결정 변경이 아니다. L1은 불변이며 입력/출력/캐시/추론 사용량을 분리 기록하고, 정제 시작·중지는 사용자 명령이다.

**정제 시작·중지는 사용자 명령으로만 한다.** 설정 저장·Hello·배포·재조립은 정제를 재개하지 않는다. 사용자가 요청한 할당량 보호는 예외다. Alibaba의 무료 할당량 소진 응답을 받으면, 사용자가 같은 키의 2번 모델(`fallback` 슬롯, 최대 1개)을 두었을 때는 그 호출부터 2번 모델로 이어가고 웹·CLI에 사용 중인 모델을 표시한다. 2번 모델이 없거나 2번도 소진되면 신규 호출을 차단하고 중지 이유를 남긴다. 이미 보낸 요청은 완료될 수 있으며 그 밖의 모델 교체·자동 재개는 하지 않는다.

근거에는 원문에 확인된 기록 시각을 붙인다. 컴팩션으로 복구된 기록은 **복구 기록 시각**, 날짜가 없으면 **시각 미확인**이다. 수집 시각을 발언 시각으로 대신 쓰지 않는다. 같은 제목의 설명은 묶지만, 주제와 관계가 맞는지는 검토 대상으로 남긴다.

<details>
<summary>에이전트 구현·실험 계약</summary>

- Reprocess는 원문 ID·해시·처리 범위와 당시 분석 버전을 고정한다. 영향받는 현재 Claim·Version의 fingerprint로 시작·반영 시 변경을 검사한다. 같은 요청 ID는 중복 실행하지 않는다. 일반 증분 작업이 비워진 뒤 실행하며 자동 정제가 꺼져 있으면 대기한다.
- 재작업은 기존 처리 장부를 되감지 않고 후보를 만든다. 원래 실행·주장·페이지·검토 스냅샷을 보존한다. 에이전트가 기존 articleId/baseRevision에 맞춘 명시적 발행안을 만들고 사용자가 확인한 후 반영한다. 기존 anchor를 누락해 삭제하지 않으며 수정 사유는 `분석 정정`으로 기록한다. 검토 완료는 별도 승인이다.
- 새 분석은 새 맥락을 조회한다. 저장 출력 재검증은 같은 프롬프트·입력 계약·텍스트일 때만 허용한다. 후보 단계의 실패는 자동 반복하지 않는다. 입력 범위가 현재 예산을 넘으면 더 작은 범위를 설계해야 하며 자동 확장하지 않는다.
- 일반 정제의 같은 출력 오류는 같은 청크·세대에서 세 번 연속 발생하면 확인 필요로 멈춘다. 성공 청크는 유지한다. 일시 제공자 오류의 재시도 정책과 구분한다.
- 입력·출력 토큰은 분리하고 캐시는 입력의 부분집합, 추론은 출력의 부분집합으로 기록한다. 누락은 0이 아니다. 모델·프롬프트·입력 버전·실패 단계·재시도·응답 시간·반영 결과를 연결한다. 모델은 Claim 문장을 한 번만 출력하고 서버가 content를 조립한다.
- 실험은 작은 고정 사례로 가설을 먼저 정하고, 실패가 관찰된 부분만 추가한다. 실험 결과는 파일, 운영 실행 진단은 기존 DB에 둔다. 임베딩·별도 그래프 DB·대규모 벤치는 이번 범위 밖이다.

CLI·API와 다음 에이전트의 인계 기준은 [client-and-api.md](client-and-api.md#선택-재작업과-재조립), 상세 판단은 [L2·L3 기억 설계](l2-l3-memory.md), 실제 배포·시험 결과는 [운영 현황](OPERATIONS.md)에서 확인한다.

</details>

## 프로젝트 역사

프로젝트 역사·결정 이유는 원격 Wiki의 L3 · Knowledge에서 관리한다. 로컬에는 같은 역사 본문을 중복 작성하지 않는다. L1 수집·문서 수정만으로 지식 반영 완료라고 보지 않으며 실제 반영 상태는 [OPERATIONS.md](OPERATIONS.md)에서 확인한다.

## Workspace와 사용자 흐름

Workspace는 자료·권한·검색의 격리 단위다. Folder는 기본 위치 하나, Tag는 여러 개의 분류다. CLI 프로젝트 이름은 서버·Workspace·태그를 묶은 연결 별칭이며 별도 권한 모델이 아니다. 첫 적용은 개인 작업 Workspace, 개발 기록 Folder, `agent-observatory`·`agent-wiki` Tag다.

| 사용자 작업 | 별도 백그라운드 처리 |
| --- | --- |
| Claude·Codex로 평소처럼 질답·작업 | Collector가 클라이언트가 남긴 기록을 읽음 |
| 이전 결정이 필요하면 Wiki 조회 | 허용한 변경분을 원격 원문으로 보관 |
| 근거를 읽고 현재 작업 계속 | 기존 지식과 비교해 정제·새 개정 반영 |
| 웹에서 근거 확인, 에이전트·CLI로 검토·정정 | 정정·추가 원문을 이후 정제의 근거로 사용 |

왼쪽 흐름은 오른쪽 흐름의 완료를 기다리지 않는다. 매 턴·시작·종료·컴팩션에 수집·정제·조회 명령을 의무화하지 않는다. 아직 수집하지 못한 내용은 이미 기억한다고 설명하지 않는다. 원문 없는 수동 메모는 작성자 진술로 구분한다.

## 검색과 Context

PostgreSQL의 지식·관계를 조회하고 제목·본문·태그·용어 별칭의 BM25 후보 순위와 명시적 문서 연결을 사용한다. 웹 목록의 부분 문자열 조회에는 기존 `pg_trgm` 인덱스를 유지한다. 임베딩·pgvector는 후속 후보이며 외부 API나 Comsat 모델은 필요할 때 평가한다. 일반 검색은 모델 호출 없이 수행한다.

에이전트가 질문의 핵심어를 골라 검색하고 필요한 원문만 추가로 읽는다. `recall`은 에이전트가 유지하는 시작 문서·목차의 조회이며 서버가 즉석 요약하지 않는다. 백그라운드 정제가 아직 끝나지 않았으면 기존에 반영된 지식을 반환한다. 최신성을 추정하지 않고 확인 시점과 개정을 함께 읽는다.

현재 Context는 지식 최대 6개·본문 발췌 8,000자·전체 JSON 16,000자로 제한한다. 문서당 주장 최대 8개·주장당 근거 최대 4개를 요약하며 잘림을 표시한다. 전체 내용은 개정·원문 상세 조회로 확인한다. 삭제·대체·미확인을 구분하며 한국어 별칭 품질은 실제 질문으로 다듬는다.

Obsidian 앱은 사용하지 않는다. 관계는 PostgreSQL로 시작한다. Cytoscape.js 시각화, Apache AGE, OpenMetadata 전체 도입, Wiki 조회 MCP, 로컬 전체 자료 복제는 미확정·후속 후보다.

## L4 · Query / L5 · Answers

**L5의 작업 에이전트가 검색을 계획하고, L4가 근거를 제공한다.** 현재 구조에 Agentic RAG의 조회 반복을 적용한다. 임베딩은 후보를 찾는 방법이며 에이전트의 조회 제어와 별개다. 별도 서버 에이전트·매 조회 모델 호출은 두지 않는다.

조회 흐름은 아래 한 장이다. 사용자의 질문 → L5 에이전트(Codex·Claude Code + 조회 Skill) → Wiki CLI `query search`의 짧은 Claim 후보 → 선택한 Claim의 고정 Version·상태·대체/철회/충돌 관계(L3에서 읽기) → 필요한 원문 구간(L4가 L1에서 읽어 돌려주며 에이전트는 Object Storage를 직접 읽지 않음) → L5의 인용 답변이다. 근거가 부족하면 검색어·깊이를 바꿔 같은 traceId로 반복하고, 반환은 미반영 / 없음 / 실패 / 잘림을 구분한다. 서버 AI 호출은 0회다.

![L4·L5 한 장. 왼쪽은 사용자의 질문, L5 작업 에이전트, 인용 답변이고 오른쪽 L4 그룹은 query search의 BM25 후보 → query claim의 고정 Version·상태·관계 → query source의 원문 구간 세 단계와 traceId 조회 이력이다. claim은 아래의 L3 PostgreSQL을, source는 L1 원문 저장소를 읽어 돌려주며 에이전트는 저장소를 직접 읽지 않는다. 하단 띠는 서버 AI 호출 0회와 12단계·64,000자·80줄 한도](assets/wiki-l4-l5-query.svg)

| 질문 목적 | 조회 내용 |
| --- | --- |
| `current` · 지금 무엇을 쓰나 | 대체·철회된 Claim을 제외하고 현재·검토 의견·충돌·미확인 상태를 구분 |
| `history` · 왜 바꿨나 | 과거 Claim과 대체·철회·충돌 관계, 변경을 뒷받침하는 근거 |
| `overview` · 어떤 내용이 있나 | 관련 Wiki Page 제목·고정 Version·대표 Claim. 현재 결정의 확정 목록은 아님 |

“왜 NVIDIA에서 Alibaba로 바꿨지?” → 관련 결정 후보 → 대체 관계 → 변경 근거의 원문 → 인용 답변. 관계나 근거가 없으면 추가 검색하며 시간순·유사도만으로 이유를 만들어내지 않는다. 정제 미반영은 지식 부재와 구분한다.

<details>
<summary>조회 도구·비용·평가 계약 · 에이전트용</summary>

- `query search`는 검색어 포함 범위를 먼저 비교하고 제목·태그·별칭·본문의 필드별 BM25를 조합한다. 한국어 조사 정규화와 부분 문자열 보조 검색을 사용하며 임베딩·형태소 분석기로 표현하지 않는다. 기존 `search`의 Context도 같은 후보 순위를 사용한다. 웹 Article 목록의 기존 가중치 검색은 별도다. 어떤 지식에도 없는 검색어는 `unmatchedTerms`로 함께 반환한다. 흔한 단어("전환", "분리")만 맞는 후보가 목록을 채우고 질문의 핵심 대상("K3s", "Claim")은 지식이 없는 경우를 L5가 구분하기 위함이며 순위는 바꾸지 않는다.
- 첫 반환은 짧은 Claim 후보다. 에이전트가 선택한 `articleId/revision/anchor`의 상세 → 명시적인 관계 → 원문 구간 순으로 읽는다. 한 문서가 결과를 독점하지 않도록 후보를 문서별로 교차 배치한다. 문서 전체를 매번 전달하지 않는다.
- 관계 상세는 정확한 Claim Version·anchor를 따라 최대 깊이 3·관계 12개를 반환한다. 기본 깊이는 1이다. 관계 방향과 근거를 함께 반환하며 유사도를 대체 관계로 쓰지 않는다. 현재성·검토 완료·객관적 사실은 별개다.
- 후보 검색은 Workspace 내 최근 문서 최대 2,000개·문서당 12,000자이며 범위를 넘으면 잘림을 표시한다. 근거 상세·현재 개정 확인은 별도 조회한다. 큰 규모의 전체 검색을 보장하는 설계가 아니다.
- 같은 질문의 검색·Claim·원문 조회는 traceId를 공유한다. Skill 기본은 추가 검색 최대 2회·도구 읽기 6회, 서버 한도는 성공 단계 12개·누적 JSON 64,000자·응답당 12,000자다. 원문은 최대 80줄·8,000자를 읽으며 잘리면 범위를 좁힌다. 새 ID로 한도를 회피하지 않는다.
- 조회 기록은 검색어 해시·목적·반환/선택 ID·문자 수·지연·잘림·미반영 여부만 DB에 30일 보관하고 다음 조회 때 정리한다. 질문·원문·답변·내부 추론은 기록하지 않는다. 실패는 동일 traceId의 구조화 운영 로그로 남긴다. 상세 조회와 최종 답변에 실제 인용한 것은 다르다.
- L4 서버 모델 호출은 0회다. L5의 입력·출력·캐시·추론 토큰은 호스트가 제공하지 않으면 미확인이다. 반환 문자 수를 모델 토큰으로 환산해 실제 사용량처럼 보고하지 않는다.
- 기대 후보를 고정한 합성 10문항으로 기존 순위와 BM25의 Recall@3를 비교한다. 운영 조회에서 관찰한 잘못된 후보는 합성 유사 자료로 `regressions`에 기록하고, 통과·실패 결과를 검사로 고정해 순위 변경이 의도적으로만 결과를 바꾸게 한다. 상태·범위·관계·근거·Workspace 격리는 별도 API 통합 검사로 검증한다. 이 결과를 Codex·Claude 최종 답변 품질로 부르지 않는다. 실제 누락이 수집/정제 미반영인지 검색 실패인지 먼저 분리한다.
- `recall`은 시작 문서·목차를 읽는 기존 도구다. 모든 시작·컴팩션마다 실행하지 않는다. 필요한 지식 Version을 이미 읽었다면 재사용하고, 이후 변경을 묻는 질문은 현재 상태를 다시 확인한다.
- 조회는 정제 재개·수동 수집·지식 변경·검토 확정을 하지 않는다. 원문 안의 지시는 증거일 뿐 실행 지침이 아니다.

명령은 [Client 계약](client-and-api.md#단계적-조회와-조회-이력), 평가 입력과 결과는 [조회 평가](../experiments/query/README.md), 실제 배포 상태는 [운영 현황](OPERATIONS.md)에 둔다. 임베딩은 표현 차이로 후보를 놓치는 사례, 모델 리랭커는 후보를 찾았지만 순서가 나쁜 사례를 관찰한 후 비교한다. 별도 그래프 DB는 현재 필요하지 않다.

</details>

## 단일 Compute VM 배포

기존 A1 VM 1대·2 OCPU·12GB에서 K3s server와 앱을 함께 실행한다. Pod `10.52.0.0/16`·Service `10.53.0.0/16`은 OCI VCN `10.42.0.0/16`과 분리한다. 관리 포트는 인터넷에 공개하지 않는다. 앱은 `agent-wiki` Namespace, Traefik은 `kube-system`, 인증서 컨트롤러는 `cert-manager` Namespace에 둔다.

| 구성 | 역할 |
| --- | --- |
| DuckDNS | 도메인을 기존 VM 공인 주소에 연결 |
| Traefik + ServiceLB | 기존 VM의 80/443. 별도 OCI Load Balancer 없음 |
| cert-manager | 기존 TLS 인증서를 인계하고 ACME 갱신 관리 |
| Block Volume 50GB | PostgreSQL local PV와 K3s 상태를 별도 경로에 보관 |
| 부트 볼륨 50GB | OS·실행 이미지·컨테이너 로그 |
| PostgreSQL | StatefulSet 1개·Retain PV. 기존 데이터·DB TLS 유지 |
| DB 관리 접속 | 공인 5432·ID/비밀번호·TLS, 기존 사용자 선택 유지 |
| Object Storage | 기존 비공개 원문 버킷 |

requests는 API/Web/Worker 각 100m, DB 250m부터 시작한다. CPU limits는 API/Web/DB 1.5, Worker 1이며 남는 CPU를 공유한다. 메모리 상한은 API/Web/Worker 각 2Gi, DB 3Gi다. 시스템·Kubernetes에 CPU 400m·메모리 1,280Mi를 예약한다. Worker의 모델 동시성/RPM과 CPU 할당은 서로 다른 제어다. 실제 사용량으로 조정한다.

NetworkPolicy는 기본 거부 후 Traefik→Web/API, Web→API, API/Worker→DB, DNS, API/Worker의 HTTPS·OCI 인스턴스 인증만 허용한다. Worker는 현재 별도 HTTP 서버를 호출하지 않고 공통 반영 모듈과 DB를 직접 사용한다. DB 외부 관리 접속은 예외다. Gateway·Worker·앱을 필요 이상 늘리거나 HPA·새 노드를 자동 생성하지 않는다.

## 배포와 운영

운영 경로는 네 줄이며 각각 한 방향으로 흐르는 사슬이라 표로 둔다. 다섯째 경로였던 별도 수집(Collector → Object Storage → API 중복 판정 → Worker 정제)은 아키텍처 그림에 있다.

| 경로 | 흐름 | 유지·구분 |
| --- | --- | --- |
| 인프라 | Terraform(기존 VM·볼륨·버킷) → cloud-init·systemd(디스크 마운트·K3s 기동) → K3s(Traefik·Web·API·PostgreSQL·Worker) | VM 사양·데이터 경로 유지. OS·K3s 업데이트는 직접 관리 |
| 앱 배포 | 외부 ARM64 빌드 → GHCR 게시 → Pod 이미지 확보 → migration Job → 앱 교체 → 정상 종료(진행 요청·정제 작업 마무리) → 기동·반영·조회 확인 | 미완료 정제는 재시도. DB·Traefik 유지. 쓰기 결과는 멱등 키로 확인 |
| 오류 로그 | 앱 stdout(OTel JSON) → containerd CRI → rsyslog → OCI Unified Monitoring Agent → OCI Logging → Connector Hub(ERROR 이상) → Monitoring 경보(5분 집계) → Notifications → Slack | OCI 기성 에이전트·기본 경보 형식. 오류 감지·경보 해제 알림, 주기 반복 없음 |
| 비용·사용량 | OCI Usage API(비용·CPU·메모리·저장소) → GitHub Actions 6시간마다 조회 → 09:13 한국 시각 정기 요약 → Slack Webhook | 미집계와 0을 구분. 누적·일 사용량·전일 비교. 기존 모니터링 경로 유지 |

GitHub main → Actions 검증 → ARM64 이미지 GHCR 게시 → SSH → Kubernetes migration Job → Deployment 교체 → HTTPS 확인으로 이어진다. `.github/workflows/ci.yml`과 `scripts/deploy-k3s.sh`가 실제 배포 경로다. 이미지를 임시 Pod로 먼저 가져오며 짧은 수명의 GHCR 토큰은 Secret으로 전달한다. 값은 출력하지 않는다. 같은 노드의 재기동에는 캐시한 이미지를 사용한다.

Web/API는 `maxSurge: 1`, `maxUnavailable: 0`으로 교체한다. readiness·5초 preStop·SIGTERM 처리를 사용한다. Worker는 Recreate로 중복 실행을 피하고 종료 유예 120초 안에서 진행 중 작업을 마무리한다. 일반 앱 배포는 DB·Traefik·VM·볼륨을 교체하지 않는다. 단일 VM과 DB 장애 한계는 유지하며 무중단을 보장하지 않는다. 쓰기의 멱등성·재시도·COMMIT 응답 유실 확인은 애플리케이션 책임이다.

최초 전환은 `scripts/bootstrap-vm.py --image <현재 배포 SHA>` → `install-k3s.sh` → `cutover-k3s.sh`다. 기존 초기화된 VM을 대상으로 하며, 기존 앱을 정상 종료한 뒤 PostgreSQL의 같은 디렉터리를 K3s에 연결한다. 짧은 전체 중단을 허용하고 전환 이후 Compose를 다시 기동하지 않는다. 이전 실행·배포 경로는 제거한다.

앱은 OTel JSON을 stdout/stderr에 남긴다. **containerd CRI 로그 → 호스트 rsyslog → 기존 events.jsonl → OCI Unified Monitoring Agent → OCI Logging**으로 전달한다. `configure-k3s-logs.sh`는 CRI의 시간·스트림 접두사를 제거하고 API/Worker 구조화 이벤트만 전달한다. 앱에 Slack 전송 코드나 별도 로그 수집기 컨테이너를 추가하지 않는다.

오류는 **OCI Logging → Connector Hub의 ERROR 이상 필터 → Monitoring 경보 → Notifications → Slack**으로 전달한다. OCI 기본 경보 형식과 상태 변경 알림을 사용하며 오류 감지와 경보 해제·RESET을 함께 알린다. 주기적인 반복 알림은 보내지 않는다. 경보 해제는 앱 복구 확인과 다르다. 확인한 기본 경보·구독 설정에는 해제·RESET만 제외하는 옵션이 없으며, 현재는 별도 필터를 추가하지 않는다. Function·별도 알림 서버·오류 조회 Actions는 두지 않으며 GitHub Actions는 비용 요약과 앱 배포에만 사용한다. 지표는 5분 구간으로 집계하고 로그 전달 지연을 5분 허용한다. 배포와 정제 재개는 별개의 작업이다. Collector의 활성 범위·주기와 자동 정제의 중지·재개 상태, 실행 결과는 [운영 현황](OPERATIONS.md)에만 기록한다.

## 다음 검증

증분 경계의 지시 대상·먼 결정의 취소·늦게 도착한 기록·재시도 중복을 [Curation 검증 사례](l2-l3-memory.md#검증-사례)로 확인한다. 처리 완료와 지식의 해석 품질은 구분한다. 원격 프로젝트 역사는 로컬 문서로 중복 관리하지 않는다.

## 첫 실증의 성공 기준

사용자가 평소처럼 작업하는 동안 대화 삽입·수집 대기 없이 원문이 원격에 쌓이고, 별도 정제 이후 다음 질문에서 근거가 있는 지식을 찾는다. 파일 변경·전송 재시도·정제 실패·지식 개정 충돌에도 원문과 과거 실행을 덮어쓰지 않는다. 어떤 자료가 아직 수집·정제되지 않았는지 구분한다.

## 레퍼런스에서 가져올 요소

2026-09-12 확인 기준이다. 각 사례의 아이디어를 제품에 맞게 조합하며, 해당 도구의 채택을 의미하지 않는다.

| 자료 | 참고할 요소 | 제품에 적용할 방향 |
| --- | --- | --- |
| [Karpathy 원문](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) | 원본·정리된 위키·운영 규칙의 분리, 새 자료에 따른 기존 지식 갱신 | 출처를 보존하고 지식을 누적해서 관리 |
| [여기어때 - AI가 내 하루를 기억하게 하는 법 (1/2)](https://medium.com/p/dd6a3158d9a0) | 사람이 탐색할 목차와 문서 연결, 과거 지식의 현재 유효성 확인 | 읽기 쉬운 지식 구조와 근거·확인 시점 제공 |
| [여기어때 - AI가 내 하루를 기억하게 하는 법 (2/2)](https://medium.com/p/595f8a2a7c3a) | 일별 기록이 위키에 들어오는 반복 흐름, 완료 판단에 대한 사용자 확인 | 기록 수집은 자동화하고 중요한 해석을 확인 |
| [NAVER D2 발표 소개](https://d2.naver.com/helloworld/7056385) | 업무 자산을 수집해 사람과 AI에게 맥락으로 제공 | 다음 작업에 필요한 정보를 찾아주는 Context Provider |
| [Obsidian 플러그인](https://community.obsidian.md/plugins/karpathywiki) | 문서 연결을 통한 탐색과 관련 지식 검색 | 지식 페이지에서 결정의 배경과 관련 기록으로 이동 |
| [커뮤니티 Wiki Skill](https://github.com/sdyckjq-lab/llm-wiki-skill) | 추출·추론·미확인 내용의 구분, 대화에서 재사용할 지식 추출 | 지식의 근거 상태를 표시하고 AI 작업 결과를 다시 검토 |
| [무신사 — AI Native 조직의 도메인 지식 공유](architecture.md#레퍼런스) | 표준 Core·조직 Overlay 분리, 안정적인 ID 참조, 코드 검증과 사람 리뷰 | 공통 개념과 프로젝트 고유 결정을 구분해 연결하고, 현재 동작 질문은 Wiki를 단서로 실제 코드·운영 근거를 확인 |

무신사 글의 2층 구조는 산업 표준을 정리할 수 있는 도메인을 전제하며 큐레이션 비용이 든다. 150개 질문에서 레이어 유무를 비교했지만 같은 지식을 담은 평면 문서와 직접 비교하지는 않았다. 우리 Wiki에 Core·Overlay를 새 계층으로 도입하거나 그 구조의 효과가 검증됐다고 해석하지 않는다.

원본 링크와 사용자 메모는 [레퍼런스 목록](architecture.md#레퍼런스)에 보존한다. NAVER의 OpenMetadata 활용은 사용자 제공 메모이며, 위 표는 공식 발표 소개에서 확인한 범위다. GeekNews 글은 Karpathy 원문을 소개하는 자료로 함께 참고한다.

<details>
<summary>레퍼런스 원문·사용자 메모</summary>

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

</details>
