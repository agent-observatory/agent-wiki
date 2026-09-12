# Generate editable Wiki architecture SVGs. Run from the repository root.
from pathlib import Path
from html import escape
import re, xml.etree.ElementTree as ET
ET.register_namespace('', 'http://www.w3.org/2000/svg')
p=[]
def a(s):p.append(s)
def box(x,y,w,h,f='#FFFFFF',st='#CDD9E7'):a(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{f}" stroke="{st}"/>')
def text(x,y,s,z=20,b=False,c='#172C4B'):a(f'<text x="{x}" y="{y}" font-size="{z}" font-weight="{700 if b else 400}" fill="{c}">{escape(s)}</text>')
FLOW_COLORS={'ingest':'#B35C00','query':'#245CC5','ops':'#68778B','relation':'#8054A3'}
def path(d,dash=False,flow='ops',both=False):
 c=FLOW_COLORS[flow]
 a(f'<path d="{d}" fill="none" stroke="{c}" stroke-width="2.5" stroke-linejoin="round"'+(' stroke-dasharray="6 5"' if dash else '')+f' marker-end="url(#arrow-{flow})"'+(f' marker-start="url(#arrow-{flow})"' if both else '')+'/>')
def flow_markers():
 return ''.join(f'<marker id="arrow-{k}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4.5 L1 8" fill="none" stroke="{c}" stroke-width="2"/></marker>' for k,c in FLOW_COLORS.items())
def legend(x,y,label,flow,dash=False):
 path(f'M{x} {y} H{x+48}',dash,flow);text(x+62,y+6,label,18,True,FLOW_COLORS[flow])
def icon(n,x,y,z=28):
 s=Path('docs/assets/icons/'+n+'.svg').read_text();ids=re.findall(r'id="([^"]+)"',s);prefix=f'{n}-{x}-{y}-'
 for i in ids:s=s.replace(f'id="{i}"',f'id="{prefix+i}"').replace(f'url(#{i})',f'url(#{prefix+i})')
 r=ET.fromstring(s);r.attrib.update({'x':str(x),'y':str(y),'width':str(z),'height':str(z),'color':'#172C4B'})
 if not r.get('fill'):r.set('fill','#172C4B')
 a(ET.tostring(r,encoding='unicode'))
def start(h,title,desc):a(f'''<svg xmlns="http://www.w3.org/2000/svg" width="1560" height="{h}" viewBox="0 0 1560 {h}" role="img" aria-labelledby="title desc"><title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4.5 L1 8" fill="none" stroke="#59769B" stroke-width="1.8"/></marker></defs><g font-family="Noto Sans KR, sans-serif"><rect width="1560" height="{h}" fill="#FFFFFF"/>''')
def end(file):
 a('</g></svg>');Path(file).write_text(('\n'.join(p)+'\n').replace('</defs>',flow_markers()+'</defs>',1))
# Deployment: application Container Instance and grouped DB VM/storage resources.
start(1510,'Wiki 배포: App CI와 DB VM','에이전트가 원격 API에서 근거 Context를 조회하고 답변과 작업에 활용한다. 웹 Wiki는 편집과 출처 확인을 보조한다. App Container Instance는 앱 컨테이너 4개와 독립 로그 수집기 1개를 실행하고 별도 Compute VM이 단일 PostgreSQL을 실행한다. 앱 3 OCPU 20GB와 DB 1 OCPU 4GB는 무료 자격 확인 전 후보 배분이다. 같은 VCN에서 사설 TLS로 연결한다. DataGrip은 IP 제한 없는 공인 TLS 경로로 ID와 비밀번호를 사용해 직접 연결한다. DB 서버 구성 영역은 Compute VM과 연결한 Block Volume을 묶으며, 각 자원은 구분해 표시한다. Caddy는 S3 저장 모듈로 비공개 Object Storage 인증서 버킷을 읽고 갱신한다. 원문과 인증서 버킷은 분리하며 백업은 초기 범위에서 제외한다.')
text(40,50,'AGENT WIKI',15,True,'#48627F');text(40,112,'OCI App CI + PostgreSQL VM',37,True)
text(1230,65,'OCI · Osaka',23,True);text(1230,103,'ap-osaka-1',18,False,'#526A86')
a('<path d="M40 145 H1520" stroke="#172C4B" stroke-width="2"/>')
box(40,180,430,120,'#EEF7FB');icon('tabler-world',60,198,30);text(104,226,'Duck DNS',25,True);text(60,265,'위키 도메인 → App CI 공인 IP',19)
box(570,180,430,120,'#FFF6E6');icon('letsencrypt',590,198,30);text(634,226,'Let’s Encrypt',25,True);text(590,265,'Caddy · 인증서 발급·갱신',19)
box(1120,180,400,120,'#F2EBFD');icon('tabler-cloud',1140,198,28);text(1184,226,'NVIDIA API',25,True);text(1140,258,'Kimi K3 · DeepSeek',20,True);text(1140,286,'지식 추출 · 갱신 후보',16)
box(40,390,240,750,'#F7F9FC');text(60,431,'LOCAL',18,True,'#526A86')
box(340,390,710,620,'#F5F8FF','#BDD0EA');icon('oracle',360,407,28);text(402,433,'App Container Instance',25,True);text(360,457,'3 OCPU / 20GB 후보 · 앱 컨테이너 4개',18,True,'#214D97');text(735,478,'로그 수집기 1개 · 0.25GB 후보',16,False,'#526A86')
box(1140,390,400,700,'#F5FAF8','#A7D1C5');text(1160,428,'DB 서버 구성',26,True)
box(1150,450,370,260,'#E4F4F0','#A7D1C5');icon('oracle',1170,466,28);text(1210,491,'Compute VM',24,True);text(1170,520,'A1 · 1 OCPU / 4GB 후보',18,True)
box(1150,790,370,280,'#EEF5FE','#BDD0EA');icon('oracle',1170,809,28);text(1212,837,'Block Volume',24,True)
# Request, API and durable-state paths. Crossings do not imply junctions.
path('M155 300 V490',True);text(169,363,'DNS 조회·응답',15)
path('M785 300 V337 H330 V480 H505 V490',True);text(590,333,'ACME',16)
path('M260 555 H365',flow='query',both=True);text(287,539,'HTTPS',15)
path('M260 705 H300 V632 H365',flow='query',both=True)
path('M280 851 H317 V597 H365',flow='ingest');text(65,985,'수집·업로드',16,True,FLOW_COLORS['ingest'])
path('M645 543 H735',flow='query',both=True);text(661,527,'화면',15)
path('M515 650 V765',flow='query',both=True);text(530,720,'조회·응답',16,True,FLOW_COLORS['query'])
path('M475 650 V765',flow='ingest');text(370,735,'수집 접수',16,True,FLOW_COLORS['ingest'])
path('M365 620 H350 V1125 H690 V1140',True)
path('M665 858 H702 V1050 H1100 V551 H1170',flow='query',both=True)
path('M665 915 H716 V1074 H1128 V663 H1170',flow='ingest');text(738,1100,'작업 등록 · pg-boss',16,True,FLOW_COLORS['ingest'])
path('M1025 862 H1115 V625 H1170',flow='ingest',both=True);text(885,730,'작업 수신·지식 반영',15,True,FLOW_COLORS['ingest'])
path('M875 765 V681 H1080 V240 H1120',flow='ingest',both=True);text(785,670,'추출·검증 · LLM',16,True,FLOW_COLORS['ingest'])
path('M1495 710 V790');text(1170,758,'VM에 연결·마운트',18)
path('M510 955 V1140',flow='ingest');text(360,1110,'API · 원문 저장',16,False,FLOW_COLORS['ingest'])
path('M875 955 V1140',flow='ingest',both=True);text(896,1132,'Worker · 원문 읽기',15,False,FLOW_COLORS['ingest'])
# Direct administrator access uses password and TLS without an IP allowlist.
path('M260 1060 H300 V1370 H1545 V580 H1500',True,both=True);text(1140,1400,'관리 접속 · TLS · IP 제한 없음',16,True,FLOW_COLORS['ops'])
# Clients and containers.
box(60,490,200,132);icon('user',77,505,27);text(117,534,'웹 Wiki',23,True)
text(78,574,'보조 · 편집·근거 확인',16);text(78,603,'위키 도메인으로 접속',16)
box(60,652,200,108,'#E1EBFF');icon('tabler-terminal-2',77,665,26);text(115,691,'에이전트',23,True);text(78,720,'주 용례 · 근거 조회',17,True);text(78,747,'질답·작업에 활용',16)
box(60,790,200,170,'#FFF4DF');icon('tabler-cloud-upload',77,808,27);text(117,837,'Collector',23,True);text(78,878,'세션·메모·문서',17);text(78,917,'선택·마스킹·업로드',16)
box(60,1010,200,100);icon('tabler-terminal-2',77,1023,25);text(113,1050,'DataGrip',22,True);text(78,1088,'ID / 비밀번호 · TLS',16)
box(365,490,280,160,'#E1EBFF');icon('caddy',383,508,29);text(426,539,'Caddy',25,True);text(385,578,'HTTPS · /api 경로 분기',18);text(385,627,'0.25GB · S3 저장 모듈',17)
box(735,490,290,160);icon('nextdotjs',753,508,29);text(795,539,'Next.js · 웹 관리',21,True);text(755,578,'편집·정정·출처 확인',18);text(755,627,'4GB · localhost:3000',17)
box(365,765,300,190,'#EAF1FF');icon('fastify',383,783,28);text(425,814,'Fastify API · Query',21,True);text(385,854,'인증·권한·접수·편집',18);text(385,891,'키워드·별칭 → Context',18);text(385,931,'4GB · localhost:3001',17)
box(735,765,290,190,'#FFF3DC');icon('tabler-cpu',753,783,28);text(795,814,'Worker · Ingest',21,True);text(755,854,'추출·검증·Wiki 갱신',18);text(755,891,'키워드 색인 · pg-boss',18);text(755,931,'8GB · 최대 1 vCPU · 동시성 1',16)
text(60,1180,'App 내부: localhost',17,False,'#526A86');text(60,1213,'App → DB: 사설망 · TLS',16,False,'#526A86')
box(1170,537,330,157,'#FFFFFF');icon('postgresql',1188,551,27);text(1230,578,'PostgreSQL',24,True);text(1190,613,'문서·개정·근거·연결',18);text(1190,644,'pg_trgm · 작업 큐',18);text(1190,677,'Private IP/DNS · TLS:5432',16)
text(1170,886,'VM에 마운트 · DB 데이터 50GB',18,True);text(1170,925,'VM 부트 디스크 · 별도 50GB',18);text(1170,967,'VM 교체 시 데이터 볼륨 유지',18);text(1170,1025,'OS·DB 업데이트는 직접 관리',17,True)
box(340,1140,710,210,'#EEF5FE');icon('oracle',360,1160,29);text(404,1192,'Object Storage · 비공개 버킷 2개',25,True)
text(362,1237,'원문 버킷 · 마스킹한 객체와 해시',20);text(362,1276,'인증서 버킷 · Caddy 인증서·개인키·ACME 상태',20);text(362,1320,'Caddy ↔ 인증서 버킷 · S3 호환 API / HTTPS',18,False,'#526A86')
box(1150,1140,370,210,'#F7F9FC');text(1170,1182,'구축 전 확인',22,True);text(1170,1227,'총 4 OCPU·24GB 무료 자격',18);text(1170,1270,'S3 모듈 갱신·잠금 호환성',18);text(1170,1320,'자원 생성·배포 전 설계 단계',17)
legend(60,1395,'수집·지식 반영','ingest');legend(450,1395,'조회·응답','query');legend(790,1395,'인증·운영 연결','ops',True)
text(60,1440,'양방향 화살표: 요청·결과 반환 / 읽기·쓰기 · 교차선은 연결 지점이 아님',17,False,'#526A86')
text(60,1474,'공유 API·DB 경로도 목적별로 분리 표시 · 일반 조회에는 LLM 호출 없음',17,False,'#526A86')
end('docs/assets/wiki-deployment.svg')
# Operations lanes.
p=[];start(1220,'App CI와 DB VM 운영','Terraform과 Resource Manager는 OCI 네트워크, DB VM과 볼륨, 원문·인증서 버킷, IAM을 관리한다. cloud-init과 systemd로 DB VM을 초기 구성한다. 스키마는 앱 마이그레이션으로 관리하고 OCI CLI/API는 App CI 실행 정의를 관리한다. OS와 DB 업데이트는 직접 관리한다. 앱은 로그만 남기고 독립 수집기와 OCI Logging, Connector Hub를 거쳐 별도 알림 Function이 Slack으로 전달한다. 백업은 초기 범위에서 제외한다.')
text(42,50,'OPERATIONS AS CODE',15,True,'#48627F');text(42,112,'App CI + DB VM · 간단한 운영',38,True);a('<path d="M42 149 H1518" stroke="#172C4B" stroke-width="2"/>')
rows=[(204,'01','인프라','#E7ECFC','#6852A4',[
('terraform','Terraform / HCL','네트워크 · DB VM · 볼륨 · IAM','원문·인증서 버킷 · 삭제 보호'),('oracle','OCI Resource Manager','plan → apply · state 보관','OCI 인프라 적용'),('ubuntu','cloud-init / systemd','PostgreSQL 설치 · 볼륨 마운트','DB VM 최초 구성 · 서비스 실행')]),
(395,'02','실행 정의','#FFF3DC','#936522',[
('github','버전 관리 JSON','이미지 digest · 포트 · 마운트','App CI 1개 · 앱 4 + 수집기 1'),('tabler-terminal-2','OCI CLI / API','App CI 생성·관리','Terraform과 실행 소유권 분리'),('oracle','Container Instances','자원 제한 · health check','재시작 정책 · 정상 종료 유예')]),
(586,'03','앱 배포','#E4F4F0','#237964',[
('github','Actions → GHCR','ARM64 · Caddy S3 모듈 포함','외부 빌드 · 단일 배포 잠금'),('tabler-terminal-2','OCI API · 앱 갱신','작업 drain · 스키마 변경 잠금','재시작 / 필요 시 App CI 교체'),('tabler-clipboard-check','배포 검증','DNS · HTTPS · 검색 · 근거','DB VM·데이터 유지 · 앱 복구')]),
(777,'04','오류 로그','#EAF1FF','#28589E',[
('tabler-terminal-2','앱 JSON 로그 → 수집기','공유 파일 · 로테이션 · 읽은 위치','독립 수집 sidecar → OCI Logging'),('oracle','Logging → Connector Hub','최종 실패·서버 오류 필터','재시도 중 warn은 경보 제외'),('tabler-bell','알림 Function → Slack','봇 토큰은 알림 Function만 보유','업무 API·Worker는 로그만 기록')]),
(968,'05','중단·자원','#F0F3F8','#526A86',[
('tabler-chart-bar','OCI 지표 · 외부 HTTP 점검','CPU·메모리 · /readyz 15분','로그 없는 전체 중단도 감지'),('oracle','OCI Notifications','Alarm / 외부 점검 이벤트 수신','알림 Function 구독으로 전달'),('tabler-bell','같은 알림 Function → Slack','배치 중복 제거 · 전송 실패 처리','앱 중단과 독립된 전송 경로')])]


for y,n,label,fill,accent,items in rows:
 text(42,y+31,n,19,True,accent);text(42,y+67,label,26,True)
 for i,(ico,h,b,c) in enumerate(items):
  x=237+i*435;box(x,y,388,146,fill);a(f'<rect x="{x}" y="{y}" width="5" height="146" rx="3" fill="{accent}"/>');icon(ico,x+20,y+16,27);text(x+59,y+40,h,21,True);text(x+24,y+82,b,19);text(x+24,y+119,c,17,False,'#526A86')
  if i<2:path(f'M{x+390} {y+73} H{x+430}')
text(42,1170,'후속 연동 설계 · 로그 수집과 알림은 앱 밖에서 처리 · OCI 서비스별 무료 계정 자격 확인 후 구축',17,False,'#526A86')
end('docs/assets/wiki-operations.svg')

# Logical layers. Same synthetic source throughout; lineage is cross-layer.
p=[]
a('''<svg xmlns="http://www.w3.org/2000/svg" width="1680" height="1650" viewBox="0 0 1680 1650" role="img" aria-labelledby="title desc">
<title id="title">Wiki 지식 계층과 Lineage</title><desc id="desc">아래 L1 Raw sources부터 L2 Ingest, L3 Wiki의 Memory·Article·Glossary, L4 Query, L5 Answers까지 하나의 합성 결제 정책 예제를 따른다. 오른쪽에는 원천 자료에서 Ingest 실행, Memory, Article 개정, Context으로 이어지는 계보를 표시한다. Workspace 권한은 모든 계층에 적용한다. Query는 키워드와 용어집 별칭으로 문서를 찾고 연결된 근거로 Context를 구성한다.</desc>
<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4.5 L1 8" fill="none" stroke="#59769B" stroke-width="1.8"/></marker></defs>
<g font-family="Noto Sans KR, sans-serif"><rect width="1680" height="1650" fill="#FFFFFF"/>''')
text(48,46,'AGENT WIKI / KNOWLEDGE ARCHITECTURE',16,True,'#526A86')
text(48,107,'에이전트의 질답과 작업에 근거를 제공한다',40,True)
text(1398,105,'L1 → L5',24,True,'#526A86')
a('<path d="M48 137 H1632" stroke="#172C4B" stroke-width="2"/>')
box(48,157,1584,44,'#172C4B','#172C4B');text(65,186,'업무 Workspace',20,True,'#FFFFFF');text(292,186,'Data Governance · 접근 권한 / 마스킹 / 보관',18,False,'#FFFFFF');text(1125,186,'취미 자료·검색·AI 맥락과 분리',18,False,'#FFFFFF')
rows=[(5,225,144,'응답·활용','Answers','#EAF1FF','#2B56A7','에이전트가 활용'),(4,395,204,'질의','Query','#E4EDFF','#285BC0','요청에 맞는 맥락'),(3,625,328,'누적 지식','Wiki','#E4F4F0','#237964','지식과 의미의 연결'),(2,979,208,'지식 반영','Ingest','#FFF3DC','#936522','사실·결정 후보 추출'),(1,1213,225,'원천 자료','Raw sources','#EDF2F8','#536E90','세션 · 메모 · 문서')]
for n,y,h,ko,en,fill,color,sub in rows:
 box(48,y,1296,h,fill);a(f'<rect x="48" y="{y}" width="82" height="{h}" fill="{color}"/>');text(63,y+h/2+12,f'L{n}',33,True,'#FFFFFF')
 text(154,y+44,ko,29,True);text(154,y+77,en,18,True,color);text(154,y+112,sub,17,False,'#526A86');a(f'<path d="M332 {y+18} V{y+h-18}" stroke="#BED0DE"/>')
 if n<5:path(f'M89 {y-4} V{y-22}',flow='ingest' if n<=2 else 'query')
# L5: future work is a plan, not a verified result.
text(358,258,'주 용례 · 에이전트의 질답·작업',17,True,'#2B56A7');text(358,296,'조회한 정책·출처를 근거로',21,True);text(358,333,'현재 에이전트가 답변·작업',21,True);text(855,258,'보조 · 웹 WIKI',17,True,'#2B56A7');text(855,296,'정책을 편집·정정하고',21,True);text(855,333,'인용된 근거·개정을 확인',18)
# L4: lexical lookup, glossary aliases and cited context inside the Workspace.
text(358,430,'키워드·별칭 조회 → 제목·태그 우선 정렬 → 연결된 근거 확인',21,True,'#285BC0')
box(358,450,365,128,'#FFFFFF','#BDCCEB')
text(374,478,'키워드 색인 · Folder / Tag 필터',17,True,'#285BC0')
text(374,509,'질의: 결제 idempotency',18)
text(374,539,'별칭: idempotency → 멱등성',17)
text(374,566,'결제 · 멱등성 → 문서 a1@r1',17)
path('M724 514 H752',flow='query')
box(754,450,562,128,'#FFFFFF','#BDCCEB')
text(770,478,'Context · c1 · 결제 재시도 정책',18,True,'#285BC0')
text(770,510,'현재 결정: 동일 요청은 같은 멱등 키',19)
text(770,539,'상태: 정책 확정 · 구현 전',17)
text(770,566,'근거: a1@r1 → m1 → session-demo#e3',16)
# L3: enduring memories, readable articles, explicit semantic definitions.
for x,w,title in [(358,280,'Memory · m1'),(658,334,'Article · a1@r1'),(1012,304,'Glossary · 용어집')]:
 box(x,650,w,172,'#FFFFFF','#A7D1C5');text(x+16,680,title,20,True,'#237964')
text(374,714,'동일 결제 요청에는',20);text(374,742,'같은 멱등 키를 쓴다.',20,True);text(374,776,'정책 확정 · 구현 전',17);text(374,802,'근거: session-demo#e3',15,False,'#526A86')
text(674,715,'# 결제 재시도 정책',21,True);text(674,747,'결정 + 이유 + 적용 범위',19);text(674,778,'[[멱등성]]  [[결제 일지]]',18);text(674,803,'읽을 수 있는 Markdown 문서',15,False,'#526A86')
text(1028,714,'Glossary Term: 멱등성',18,True);text(1028,743,'별칭: idempotency',18);text(1028,774,'의미: 반복해도 효과는 동일',17);text(1028,802,'별칭으로 같은 용어 검색',16,False,'#526A86')
text(358,850,'TYPED RELATIONS',14,True,'#237964')
box(358,873,238,48);text(374,904,'Article a1@r1',19,True)
box(805,873,195,48);text(822,904,'Memory m1',19,True)
path('M596 897 H805',flow='relation');text(623,885,'supported_by',17,False,'#237964')
box(1135,873,181,48);text(1151,904,'Term: 멱등성',18,True)
path('M1000 897 H1135',flow='relation');text(1030,885,'about',17,False,'#237964')
# L2: candidate schema, compact but valid JSON fragment represented as JSON.
text(358,1012,'AI 추출 + JSON 계약·출처 검증 → 지식 갱신 후보',20,True,'#936522')
for i,s in enumerate(['{ "type": "decision", "claim": "동일 요청은 같은 멱등 키",','  "evidence_status": "user_confirmed", "implementation": "not_started",','  "source": "session-demo#e3", "run_id": "r7" }']):text(358,1054+i*32,s,18)
text(358,1160,'중복·상충 검사 → 확정된 Memory와 Article 개정 반영',20,True,'#936522')
# L1: everything needed to check the example is on the same figure.
text(358,1248,'Document · session-demo.json · 합성 대화',18,True,'#536E90')
for y,s in [(1287,'e1 사용자  “재시도할 때 중복 결제는 막아야 해.”'),(1326,'e2 에이전트  “동일 요청에는 같은 멱등 키를 쓰는 정책을 제안합니다.”'),(1365,'e3 사용자  “좋아. 같은 키를 쓰자. 정책만 정했고 구현은 아직이야.”')]:text(358,y,s,21)
text(358,1410,'원문 위치 + content hash + 접수 시각',17,False,'#526A86')
# Data Lineage rail: generation order, bottom to top. Entity revisions are explicit.
box(1370,225,262,1213,'#F6F1FC','#D8C9E9');text(1390,261,'Data Lineage',25,True,'#67429B');text(1390,290,'원문부터 맥락까지의 계보',16,False,'#67429B')
rail=[(379,'Context c1','선택된 지식·인용 목록'),(569,'Article a1@r1','문서 개정·근거 연결'),(759,'Memory m1','주장·상태·유효 시점'),(949,'Ingest r7','모델·프롬프트 버전'),(1223,'Source e3','원문 위치·해시')]
for i,(y,t,b) in enumerate(rail):
 box(1390,y,222,100,'#FFFFFF','#D8C9E9');text(1406,y+34,t,20,True,'#67429B');text(1406,y+69,b,16)
 if i<len(rail)-1:
  lower=rail[i+1][0];path(f'M1500 {lower} V{y+100}',flow='relation');text(1510,(lower+y+100)/2,['선택','반영','생성','사용'][i],14,False,'#67429B')
text(1390,1368,'Log · 실행 이력',20,True,'#67429B');text(1390,1400,'주체 · 시각 · 입력 · 버전',16)
box(48,1458,1584,88,'#F5F8FC');text(68,1490,'Schema · 위키 구조와 작성·갱신 규칙',20,True);text(68,1525,'전 계층의 지식 반영·질의·점검에 적용',17,False,'#526A86');text(850,1490,'Lint · 지식 정합성 점검',20,True);text(850,1525,'상충 · 오래된 주장 · 누락된 연결을 찾아 갱신',17,False,'#526A86')
legend(68,1595,'수집·지식 반영','ingest');legend(510,1595,'조회·응답','query');legend(930,1595,'근거·관계·계보','relation')
end('docs/assets/wiki-layers.svg')
