# Generate editable Wiki architecture SVGs. Run from the repository root.
from pathlib import Path
from html import escape
import re, xml.etree.ElementTree as ET
ET.register_namespace('', 'http://www.w3.org/2000/svg')
p=[]
def a(s):p.append(s)
def box(x,y,w,h,f='#FFFFFF',st='#CDD9E7'):a(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{f}" stroke="{st}"/>')
# Neutral enclosing regions; role colors belong to individual components.
PALETTE={
 'app':('#DBEAFE','#7EA6D8'), 'ingest':('#FDE7C2','#C89A55'),
 'data':('#D4EDE4','#74AA98'), 'ai':('#EBDFFA','#AA8ACA'),
 'ops':('#E3E7ED','#929EAD'), 'web':('#FFFFFF','#929EAD'),
}
def component(x,y,w,h,role):box(x,y,w,h,*PALETTE[role])
def group(x,y,w,h):
 a(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="#F1F2F4" stroke="#596679" stroke-width="2.5"/>')
 a(f'<path d="M{x+6} {y} H{x+w-6} Q{x+w} {y} {x+w} {y+6} V{y+54} H{x} V{y+6} Q{x} {y} {x+6} {y}" fill="#344256"/>')
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
# Deployment: short primary flows; secondary storage use is labelled at each component.
p=[]
a('<svg xmlns="http://www.w3.org/2000/svg" width="1952" height="1520" viewBox="0 0 1952 1520" role="img" aria-labelledby="title desc"><title id="title">단일 A1 VM · 조회와 지식 반영</title><desc id="desc">A1 VM 1대 2 OCPU 12GB에서 Compose 컨테이너 5개가 CPU를 공유한다. 왼쪽 웹과 에이전트는 Caddy를 통해 API에 접근한다. API에서 PostgreSQL로 파란 조회 경로와 주황 작업 등록 경로가 분리된다. 아래 Worker는 같은 PostgreSQL의 작업을 수신하고 지식을 반영한다. 원문 저장은 오른쪽 Object Storage, LLM 호출은 Worker 바로 아래 NVIDIA API, DataGrip은 DB 오른쪽에 둔다. 연결 볼륨은 DB 아래에 배치하며 DB 데이터와 Caddy 상태의 별도 경로를 보관한다. 외부 신규 유입 차단 후 내부 요청과 작업을 마무리한다. 실제 기능별 검증 상태는 운영 현황 문서에서 구분한다.</desc><defs></defs><g font-family="Noto Sans KR, sans-serif"><rect width="1952" height="1520" fill="#FFFFFF"/>')
text(40,48,'AGENT WIKI · OCI Osaka / ap-osaka-1',16,True,'#526A86')
text(40,112,'단일 A1 VM · 조회와 지식 반영',39,True)
legend(1412,55,'수집·지식 반영','ingest');legend(1412,87,'조회·응답','query');legend(1412,119,'인증·운영 연결','ops',True)
a('<path d="M40 149 H1912" stroke="#172C4B" stroke-width="2"/>')
component(40,190,450,120,'ops');icon('tabler-world',60,211,30);text(104,241,'Duck DNS',25,True);text(60,281,'위키 도메인 → VM 공인 IP',20)
component(650,190,400,120,'ops');icon('letsencrypt',670,211,30);text(714,241,'Let’s Encrypt',25,True);text(670,281,'Caddy · 인증서 자동 발급·갱신',19)
group(40,390,284,700);text(72,426,'LOCAL',18,True,'#FFFFFF')
group(364,390,1288,880);icon('oracle',387,409,28);text(429,436,'Compute VM · A1 · 2 OCPU / 12GB',27,True,'#FFFFFF')
text(1180,435,'Compose · 5개 컨테이너 · CPU 공유',19,True,'#FFFFFF')
# DNS/ACME reach the web client and gateway, without crossing application paths.
path('M177 310 V490',True);text(191,363,'DNS 조회',16)
path('M850 310 V348 H379 V505 H396',True);text(670,341,'ACME',16)
# Three ingress ports on one Caddy instance.
path('M292 555 H396',flow='query',both=True)
path('M292 755 H396',flow='query',both=True)
path('M292 975 H354 V855 H396',flow='ingest')
path('M646 555 H780',flow='query',both=True);text(663,540,'화면',16)
path('M930 630 V710',flow='query',both=True);text(944,677,'내부 조회',16,True,FLOW_COLORS['query'])
path('M646 760 H780',flow='query',both=True);text(661,745,'조회',16,True,FLOW_COLORS['query'])
path('M646 855 H780',flow='ingest');text(661,840,'수집',16,True,FLOW_COLORS['ingest'])
# API reads and enqueue use separate short corridors into the same DB.
path('M1080 785 H1260',flow='query',both=True);text(1097,769,'근거 조회',17,True,FLOW_COLORS['query'])
path('M1080 885 H1260',flow='ingest');text(1097,869,'작업 등록',17,True,FLOW_COLORS['ingest'])
path('M1080 1090 H1200 V1005 H1260',flow='ingest',both=True);text(1085,1142,'작업 수신·반영',17,True,FLOW_COLORS['ingest'])
# External source storage and model call are deliberately on separate sides.
path('M1080 730 H1120 V580 H1712',flow='ingest');text(1250,564,'원문 저장',17,True,FLOW_COLORS['ingest'])
path('M930 1220 V1320',flow='ingest',both=True);text(948,1300,'추출·검증',17,True,FLOW_COLORS['ingest'])
path('M1620 860 H1712',True,both=True)
path('M1440 1030 V1320');text(1456,1225,'연결·마운트',18)
# Clients.
component(72,490,220,135,'web');icon('user',89,509,28);text(129,539,'웹 Wiki',24,True);text(90,578,'편집·근거 확인',18);text(90,609,'HTTPS · 보조 화면',17)
component(72,690,220,130,'app');icon('tabler-terminal-2',89,709,28);text(129,739,'에이전트',24,True);text(90,778,'주 용례 · 근거 조회',18,True);text(90,807,'질답·작업에 활용',17)
component(72,910,220,135,'ingest');icon('tabler-cloud-upload',89,929,28);text(129,959,'Collector',24,True);text(90,999,'세션·메모·문서',18);text(90,1028,'선택·마스킹·업로드',17)
# One gateway serves all ingress paths.
component(396,490,250,400,'app');icon('caddy',418,509,30);text(462,542,'Caddy',26,True)
text(418,591,'HTTPS · 경로 분기',19);text(418,636,'0.25GB',18);text(418,673,'영속 /data · /config',18)
text(418,749,'조회 요청 ↔ API',18,True,FLOW_COLORS['query']);text(418,840,'수집 접수 → API',18,True,FLOW_COLORS['ingest'])
component(780,490,300,140,'web');icon('nextdotjs',799,509,28);text(840,542,'Next.js · 웹 관리',23,True);text(800,584,'편집·정정·출처 확인',19);text(800,616,'2GB · web:3000',17)
component(780,710,300,230,'app');icon('fastify',799,730,28);text(840,761,'Fastify API',24,True);text(800,805,'키워드·별칭 → Context',19);text(800,847,'인증·접수·편집·권한',19);text(800,915,'2GB · api:3001',17)
component(780,1020,300,200,'ingest');icon('tabler-cpu',799,1040,28);text(840,1071,'Worker · Ingest',23,True);text(800,1112,'추출·검증·지식 갱신',19);text(800,1147,'원문: Object Storage',18);text(800,1200,'2GB · CPU 최대 0.5 · 동시성 1',16)
component(1260,690,360,340,'data');icon('postgresql',1280,710,32);text(1326,743,'PostgreSQL',27,True);text(1282,797,'문서·개정·근거·연결',20);text(1282,843,'pg_trgm · pg-boss',20);text(1282,888,'3GB · postgres:5432 · TLS',18);text(1282,951,'앱 배포 시 계속 실행',20,True);text(1282,1004,'DB·Caddy 상태는 연결 볼륨에',17)
component(396,1020,300,200,'ops');icon('ubuntu',416,1037,28);text(456,1068,'호스트 로그',23,True);text(416,1110,'Docker syslog → rsyslog',18);text(416,1147,'OCI Unified Monitoring Agent',16);text(416,1198,'기성 도구 · 컨테이너 추가 없음',17)

# OCI object service, administrator client and NVIDIA are outside the VM boundary.
component(1712,505,200,160,'data');icon('oracle',1732,521,27);text(1732,585,'Object Storage',20,True);text(1732,620,'비공개 원문 버킷',17);text(1732,651,'객체·해시',17)
component(1712,800,200,150,'web');icon('tabler-terminal-2',1732,816,27);text(1772,845,'DataGrip',21,True);text(1732,889,'ID / 비밀번호 · TLS',16);text(1732,921,'IP 제한 없음',17)
component(780,1320,300,160,'ai');icon('tabler-cloud',800,1338,28);text(842,1370,'NVIDIA API',25,True);text(800,1414,'Kimi K3 · DeepSeek',20,True);text(800,1455,'외부 LLM · 지식 추출',18)
component(1260,1320,360,160,'data');icon('oracle',1280,1338,28);text(1322,1370,'Block Volume · 50GB',23,True);text(1282,1414,'PostgreSQL · Caddy 영속 상태',18);text(1282,1455,'별도 경로·권한 · 부트 50GB 별도',17)
end('docs/archive/server-ingest/wiki-deployment.svg')
# Operations lanes.
p=[];start(1220,'단일 VM · Compose 운영','Terraform으로 A1 VM과 볼륨을 만들고 cloud-init으로 Docker와 마운트를 초기 구성한다. 외부 ARM64 빌드와 미리 pull 후 새 요청과 작업 수신을 중지하고 진행 중 처리를 마친 다음 변경된 앱 컨테이너만 교체한다. DB와 Caddy는 앱 배포에서 유지한다. 오류 로그는 Docker syslog와 rsyslog, OCI 호스트 에이전트를 통해 OCI Logging에 모은다. GitHub Actions가 오류를 5분마다 조회해 한국어 Slack Webhook 카드로 전송한다. 비용과 사용량은 6시간마다 점검하고 매일 요약한다. 단일 서버의 짧은 중단을 허용한다.')
text(42,50,'OPERATIONS AS CODE',15,True,'#48627F');text(42,112,'단일 VM · Compose · 정상 종료 후 교체',38,True);a('<path d="M42 149 H1518" stroke="#172C4B" stroke-width="2"/>')
rows=[(204,'01','인프라','#EBDFFA','#6852A4',[
('terraform','Terraform / HCL','A1 VM · 2 OCPU / 12GB','볼륨 · 원문 버킷 · IAM'),('oracle','OCI · Terraform 적용','로컬 plan → apply · state 보관','무료 한도 · 기존 사용량 확인'),('ubuntu','cloud-init / systemd','Docker·Compose · 볼륨 마운트','OS·Docker 업데이트 직접 관리')]),
(395,'02','실행 정의','#FDE7C2','#936522',[
('github','Compose · 컨테이너 5개','앱 4 + PostgreSQL · 로그는 호스트','CPU 공유 · Worker 최대 0.5'),('tabler-terminal-2','영속 데이터 마운트','DB 데이터 · Caddy 인증서 상태','마운트 확인 후 기동'),('tabler-clipboard-check','종료 신호 · SIGTERM','외부 차단 · 내부 처리 종료 유예','결과 커밋 후 완료 · 연결 정리')]),
(586,'03','앱 배포','#D4EDE4','#237964',[
('github','외부 ARM64 빌드 → GHCR','VM에서 미리 pull · 단일 배포 잠금','기존 앱은 실행 유지'),('tabler-terminal-2','변경 앱만 Compose 교체','외부 차단 → 내부 완료 → 교체','DB·Caddy 유지 · 짧은 중단 허용'),('tabler-clipboard-check','health check · 기능 확인','로그인 · 검색 · 근거 · 수집','실패 시 이전 앱 이미지로 복구')]),
(777,'04','오류 로그','#DBEAFE','#28589E',[
('ubuntu','stdout → 호스트 로그','Docker syslog · rsyslog 파일','OCI 기성 에이전트 → Logging'),('github','Actions · 5분마다 조회','ERROR 이상 · 같은 이벤트 제외','같은 오류는 시간당 1회 알림'),('tabler-bell','한국어 카드 → Slack','Webhook · 오류 코드·확인 링크','업무 API·Worker는 로그만 기록')]),
(968,'05','비용·사용량','#E3E7ED','#526A86',[
('oracle','OCI Usage API','비용 · CPU·메모리·저장소·전송','미집계와 0 구분 · 통화·단위 유지'),('github','Actions · 6시간마다 점검','비용 발생 · 예산 접근 · 사용 급증','매일 09:13 한국 시각 정기 요약'),('tabler-bell','한국어 카드 → Slack','수치·증감 · 비용 확인 링크','앱 VM과 독립된 전송 경로')])]


for y,n,label,fill,accent,items in rows:
 text(42,y+31,n,19,True,accent);text(42,y+67,label,26,True)
 for i,(ico,h,b,c) in enumerate(items):
  x=237+i*435;box(x,y,388,146,fill);a(f'<rect x="{x}" y="{y}" width="5" height="146" rx="3" fill="{accent}"/>');icon(ico,x+20,y+16,27);text(x+59,y+40,h,21,True);text(x+24,y+82,b,19);text(x+24,y+119,c,17,False,'#526A86')
  if i<2:path(f'M{x+390} {y+73} H{x+430}')
text(42,1170,'예산은 강제 차단이 아님 · 집계·예약 실행 지연 가능 · 전체 중단·지표 경보는 후속 과제',17,False,'#526A86')
end('docs/archive/server-ingest/wiki-operations.svg')

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
 box(48,y,1296,h,'#F1F2F4','#929EAD');a(f'<rect x="48" y="{y}" width="82" height="{h}" fill="{color}"/>');text(63,y+h/2+12,f'L{n}',33,True,'#FFFFFF')
 text(154,y+44,ko,29,True);text(154,y+77,en,18,True,color);text(154,y+112,sub,17,False,'#526A86');a(f'<path d="M332 {y+18} V{y+h-18}" stroke="#BED0DE"/>')
 if n<5:path(f'M89 {y-4} V{y-22}',flow='ingest' if n<=2 else 'query')
# L5: future work is a plan, not a verified result.
text(358,258,'주 용례 · 에이전트의 질답·작업',17,True,'#2B56A7');text(358,296,'조회한 정책·출처를 근거로',21,True);text(358,333,'현재 에이전트가 답변·작업',21,True);text(855,258,'보조 · 웹 WIKI',17,True,'#2B56A7');text(855,296,'정책을 편집·정정하고',21,True);text(855,333,'인용된 근거·개정을 확인',18)
# L4: lexical lookup, glossary aliases and cited context inside the Workspace.
text(358,430,'키워드·별칭 조회 → 제목·태그 우선 정렬 → 연결된 근거 확인',21,True,'#285BC0')
component(358,450,365,128,'app')
text(374,478,'키워드 색인 · Folder / Tag 필터',17,True,'#285BC0')
text(374,509,'질의: 결제 idempotency',18)
text(374,539,'별칭: idempotency → 멱등성',17)
text(374,566,'결제 · 멱등성 → 문서 a1@r1',17)
path('M724 514 H752',flow='query')
component(754,450,562,128,'app')
text(770,478,'Context · c1 · 결제 재시도 정책',18,True,'#285BC0')
text(770,510,'현재 결정: 동일 요청은 같은 멱등 키',19)
text(770,539,'상태: 정책 확정 · 구현 전',17)
text(770,566,'근거: a1@r1 → m1 → session-demo#e3',16)
# L3: enduring memories, readable articles, explicit semantic definitions.
for x,w,title in [(358,280,'Memory · m1'),(658,334,'Article · a1@r1'),(1012,304,'Glossary · 용어집')]:
 component(x,650,w,172,'data');text(x+16,680,title,20,True,'#237964')
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
box(1370,225,262,1213,'#F1F2F4','#929EAD');text(1390,261,'Data Lineage',25,True,'#67429B');text(1390,290,'원문부터 맥락까지의 계보',16,False,'#67429B')
rail=[(379,'Context c1','선택된 지식·인용 목록'),(569,'Article a1@r1','문서 개정·근거 연결'),(759,'Memory m1','주장·상태·유효 시점'),(949,'Ingest r7','모델·프롬프트 버전'),(1223,'Source e3','원문 위치·해시')]
for i,(y,t,b) in enumerate(rail):
 component(1390,y,222,100,'ai');text(1406,y+34,t,20,True,'#67429B');text(1406,y+69,b,16)
 if i<len(rail)-1:
  lower=rail[i+1][0];path(f'M1500 {lower} V{y+100}',flow='relation');text(1510,(lower+y+100)/2,['선택','반영','생성','사용'][i],14,False,'#67429B')
text(1390,1368,'Log · 실행 이력',20,True,'#67429B');text(1390,1400,'주체 · 시각 · 입력 · 버전',16)
box(48,1458,1584,88,'#F1F2F4','#929EAD');text(68,1490,'Schema · 위키 구조와 작성·갱신 규칙',20,True);text(68,1525,'전 계층의 지식 반영·질의·점검에 적용',17,False,'#526A86');text(850,1490,'Lint · 지식 정합성 점검',20,True);text(850,1525,'상충 · 오래된 주장 · 누락된 연결을 찾아 갱신',17,False,'#526A86')
legend(68,1595,'수집·지식 반영','ingest');legend(510,1595,'조회·응답','query');legend(930,1595,'근거·관계·계보','relation')
end('docs/archive/server-ingest/wiki-layers.svg')
