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
# All current diagrams describe the target, not deployment completion.
def canvas(w,h,title,desc):
 global p
 p=[]
 a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc><defs></defs><g font-family="Noto Sans KR, sans-serif"><rect width="{w}" height="{h}" fill="#FFFFFF"/>')
 text(40,42,'AGENT WIKI / ARCHITECTURE',15,True,'#526A86')
 text(40,98,title,34,True)
 a(f'<path d="M40 137 H{w-40}" stroke="#172C4B" stroke-width="2"/>')
def card(x,y,w,h,title,lines,role='app',ico=None):
 if ico is None:
  ico={'app':'tabler-book-2','ingest':'tabler-cpu','data':'tabler-book-2','ai':'tabler-cloud','ops':'tabler-clipboard-check','web':'tabler-world'}[role]
 component(x,y,w,h,role)
 if ico:icon(ico,x+20,y+19,26)
 text(x+(58 if ico else 20),y+42,title,23,True)
 for i,line in enumerate(lines):text(x+20,y+80+i*31,line,18)

canvas(1920,1330,'로컬에서 수집 · 원격에서 정제','단일 설치하는 Agent Wiki CLI의 백그라운드 수집이 API에서 업로드 허가를 받고 압축 증분을 Object Storage에 직접 전송한다. 서버가 검증·중복 판단 후 L1을 등록한다. 원격 L2 Worker가 Wiki에 저장한 제공자와 모델 설정에 따라 외부 AI API로 정제하고 근거와 실행 기록을 보존한다. 사용자 조회는 정제 완료를 기다리지 않는다.')
legend(1110,87,'수집·지식 반영','ingest');legend(1370,87,'조회·응답','query');legend(1600,87,'설정·인증·저장','ops',True)
# DNS, certificate issuance, and persistent storage are not HTTP intermediaries.
card(72,180,366,130,'DuckDNS · 도메인',['agent-wiki.duckdns.org','도메인 조회 → VM 공인 주소'],'web','tabler-world')
card(940,180,280,130,'인증서 발급 기관',['Caddy가 발급·갱신 요청','HTTPS 인증서 자동 관리'],'ops','letsencrypt')
card(1280,180,320,170,'연결 볼륨 · 50GB',['PostgreSQL 데이터','Caddy 인증서·설정','부트 볼륨 50GB 별도'],'data','oracle')
group(40,370,430,912);text(64,406,'사용자 기기',24,True,'#FFFFFF')
group(590,370,1010,830)
path('M200 450 V310',True,both=True)
path('M438 245 H745 V450',True);text(490,230,'도메인 → VM 공인 주소',18)
path('M940 255 H800 V450',True,both=True)
path('M860 480 H905 V335 H1280',True);text(960,329,'인증서 상태 보관',17)
path('M1450 350 V640',True);text(1468,530,'데이터 연결',17)
# Interactive reads and background writes use separate lanes.
path('M438 520 H630',flow='query',both=True)
path('M860 520 H940',flow='query',both=True)
path('M438 855 H630',flow='query',both=True)
path('M860 855 H940',flow='query',both=True)
path('M1080 580 V640',flow='query',both=True)
path('M1220 710 H1280',flow='query',both=True)
path('M1220 790 H1280',flow='ingest')
path('M1560 710 H1640',True,both=True)
# Repaint headers above connectors crossing group boundaries.
for hx,hw in [(40,430),(590,1010)]:
 box(hx+1,371,hw-2,52,'#344256','#344256')
text(64,406,'사용자 기기',24,True,'#FFFFFF')
icon('oracle',614,383,32);text(660,406,'A1 VM · 2 OCPU / 12GB',24,True,'#FFFFFF')
a('<g role="img" aria-label="Docker Compose"><title>Docker Compose</title>');icon('docker',1534,378,40);a('</g>')
card(72,450,366,130,'웹 Wiki',['agent-wiki.duckdns.org','지식·근거 확인 · AI 설정'],'web','user')
card(72,640,366,140,'작업 에이전트',['Claude · Codex 등','필요한 지식 조회 · 사용자와 작업'],'app','tabler-terminal-2')
# One installed CLI includes retrieval guidance and an independent collection process.
path('M155 825 V780',True)
path('M355 780 V825',flow='query',both=True)
card(72,825,366,425,'Agent Wiki 패키지',['한 번 설치 · 인증·설정 통합'],'ops','tabler-terminal-2')
icon('tabler-clipboard-check',92,918,24);text(126,938,'조회 Skill · 사용 지침',20,True)
text(92,969,'조회 필요성 판단 · 근거 활용',18)
a('<path d="M92 990 H418" stroke="#929EAD"/>')
icon('tabler-terminal-2',92,1008,24);text(126,1028,'Wiki CLI · 검색 실행',20,True)
text(92,1059,'wiki recall · wiki search',18)
a('<path d="M92 1080 H418" stroke="#929EAD"/>')
icon('tabler-cloud-upload',92,1098,24);text(126,1118,'Collector · 백그라운드 수집',19,True)
text(92,1149,'wiki collector · 기본 10분',18)
text(92,1180,'마스킹 · 압축 증분 직접 전송',18)
path('M438 1120 H520 V885 H630',flow='ingest',both=True);text(535,1030,'수집 제어',18,True,FLOW_COLORS['ingest'])
path('M860 885 H940',flow='ingest',both=True)
card(630,450,230,460,'Caddy',['HTTPS 접속 처리','웹·API 경로 분기','인증서 자동 갱신'],'app','caddy')
card(940,450,280,130,'Next.js · 웹',['지식·근거 확인 · AI 설정','내부 전용 연결'],'web','nextdotjs')
card(940,640,280,270,'Fastify API',['업로드 허가·상태 조회','수신 검증·중복 판정','L1 등록·수신 위치 확정','지식 검색·정제 결과 반영','AI 설정 저장·조회'],'app','fastify')
card(1280,640,280,200,'PostgreSQL',['지식·개정·근거 연결','세션·출처별 수신 위치','업로드·정제 작업 이력','AI 제공자·모델 설정'],'data','postgresql')
card(1640,640,240,140,'DataGrip',['공인 5432 · 암호·TLS','IP 제한 없음'],'web','tabler-terminal-2')
# Raw storage is outside the VM; its API connection is a straight horizontal line.
path('M1220 870 H1640',True,both=True);text(1290,902,'허가·검증·원문 확정',18)
card(1640,820,240,190,'Object Storage',['임시 업로드 영역','검증 후 불변 L1 확정','텍스트·이미지 분리'],'data','oracle')
# L2 is a server-side process using the internal API, never the user's agent session.
path('M1080 910 V970',flow='ingest',both=True);text(1098,942,'작업·근거·반영',17,True,FLOW_COLORS['ingest'])
card(940,970,280,198,'Worker · 원격 정제',['텍스트 추출 · 구조 청킹','청크별 주장·근거 추출','기존 지식 비교·검증','최대 20 RPM · 동시 실행 1개'],'ingest')
# This card describes configuration stored in Wiki, not another container.
card(630,970,250,168,'Wiki · AI 설정',['제공자 · 모델 · API 연결','기본: 일일 제한 없음','일일 한도는 선택 설정'],'ops')
path('M880 1070 H940',True)
path('M1220 1080 H1640',flow='ingest',both=True);text(1320,1060,'텍스트 청크·결과',18,True,FLOW_COLORS['ingest'])
card(1640,1050,240,82,'AI Provider',[],'ai','openai')
path('M438 1215 H1900 V940 H1880',flow='ingest');text(630,1248,'압축 증분 직접 업로드 · 본문은 API를 통과하지 않음',18,True,FLOW_COLORS['ingest'])
for bx,by,label,width in [(300,434,'L5 · 활용',124),(300,624,'L5 · 활용',124),(285,1200,'L1 · 수집',130),(960,954,'L2 · 정제',112),(1420,624,'L3 · 지식',126),(1094,624,'L4 · 조회',112),(1740,804,'L1 · 원문',124)]:
 box(bx,by,width,32,'#344256','#344256');text(bx+12,by+23,label,17,True,'#FFFFFF')
end('docs/assets/wiki-deployment.svg')

canvas(1560,1145,'수집·정제와 사용자 조회를 분리','L1부터 L5의 논리 계층. Collector가 원문을 보관하고 원격 Worker가 외부 AI API로 정제한다. 작업 에이전트는 필요한 지식만 조회한다. 번호는 배포 위치나 원격 처리 순서를 뜻하지 않는다.')
legend(1140,43,'원문·지식 반영','ingest');legend(1140,78,'조회·답변','query')
box(40,164,1480,46,'#344256','#344256');text(60,195,'Workspace · 개인 작업',22,True,'#FFFFFF');text(780,194,'Tag · agent-observatory / agent-wiki',19,True,'#FFFFFF')
rows=[
 (5,240,'에이전트 답변·작업','내장 Skill · Wiki CLI로 조회','필요한 근거를 조회해 답변·작업','현재는 단일 VM을 유지하고 분리는 후속으로 검토한다.','app'),
 (4,420,'검색·근거 제공','Wiki 서버','시작 Context · 키워드·별칭 검색','VM 선택 이유 → 지식 A의 첫 번째 개정 · 근거: 원문 A의 1행','app'),
 (3,600,'Wiki','Wiki 서버','Memory · Article · Glossary','지식 A · 첫 번째 개정: 단일 VM 결정 / 사용자 결정 · 검토 미완료','data'),
 (2,780,'Ingest','원격 Worker · AI Provider','텍스트 청킹 → 주장·근거 추출 → 비교·검증·반영','청크별 처리 범위 · 이미지 분석 생략 · 모델·지침 버전 기록','ingest'),
 (1,960,'Raw sources','Wiki CLI · 수집 → Storage','증분 직접 업로드 → 서버 검증·중복 판정 → 불변 L1 등록','원문 A · 첫 번째 개정 · 1행: “지금은 단일 VM으로 운영하자.”','ops')]
for n,y,name,who,title,example,role in rows:
 component(40,y,1480,145,role)
 box(40,y,82,145,'#344256','#344256');text(56,y+84,f'L{n}',31,True,'#FFFFFF')
 icon({1:'tabler-cloud-upload',2:'tabler-cpu',3:'tabler-book-2',4:'tabler-clipboard-check',5:'tabler-terminal-2'}[n],146,y+20,26)
 text(184,y+43,name,25,True);text(146,y+82,who,18)
 a(f'<path d="M430 {y+20} V{y+125}" stroke="#929EAD"/>')
 if n==5:
  card(456,y+16,290,114,'조회 Skill',['사용 지침 · 조회 필요성 판단'],'ai','tabler-clipboard-check')
  path(f'M746 {y+77} H796',True)
  card(796,y+16,290,114,'작업 에이전트',['근거를 활용해 답변·작업'],'app','tabler-terminal-2')
  path(f'M1086 {y+77} H1136',flow='query',both=True)
  card(1136,y+16,354,114,'Wiki CLI',['검색 실행 · 근거 반환'],'app','tabler-terminal-2')
 else:
  text(456,y+43,title,24,True);text(456,y+91,example,21)
 if n==4:
  path(f'M80 {y} V{y-35}',flow='query',both=True)
  text(146,y-12,'조회 요청 / 근거 반환',16,True,FLOW_COLORS['query'])
 elif n<5:path(f'M80 {y} V{y-35}',flow='ingest' if n<=2 else 'query')
end('docs/assets/wiki-layers.svg')

canvas(1560,1130,'리니지 · 실제 원문에서 현재 결정까지','합성 예시. 원문 보관본과 기존 지식의 고정 개정이 원격 Worker 정제 실행의 입력이다. 결과 지식의 주장마다 정확한 근거 구간을 연결하고 고정 개정 Context를 반환한다. 관련 문서 링크는 근거와 구분한다.')
legend(1140,43,'정제·반영','ingest');legend(1140,78,'조회·활용','query');legend(1140,113,'근거 참조','relation')
group(40,190,430,380);text(62,226,'1 · 원격 입력 보관본',23,True,'#FFFFFF')
card(72,284,366,118,'원문 A · 첫 번째 개정',['1행 · “단일 VM으로 운영하자.”'],'data')
card(72,426,366,112,'지식 A · 첫 번째 개정',['현재 구성 · 미완료 작업'],'data')
group(540,190,430,380);text(562,226,'2 · 원격 Worker 정제',23,True,'#FFFFFF')
card(572,284,366,254,'정제·반영 기록',['입력: 원문 A · 지식 A의 첫 개정','텍스트 청크·주장별 근거 선택','처리 범위 · 모델·지침 버전','새 결과: 지식 A의 두 번째 개정'],'ingest')
path('M470 380 H540',flow='ingest')
group(1040,190,480,380);text(1062,226,'3 · Wiki 검증·일괄 반영',23,True,'#FFFFFF')
card(1072,284,416,254,'지식 A · 두 번째 개정',['주장: 단일 VM 운영','유형: 사용자 결정','작성: 원격 AI / 확인: 미완료','근거: 원문 A · 첫 번째 개정 · 1행'],'data')
path('M970 380 H1040',flow='ingest')
# Evidence returns under the three cards, independently from processing flow.
path('M1270 570 V632 H250 V570',flow='relation');text(550,618,'주장별 근거 · 보관본 개정·구간을 고정',20,True,FLOW_COLORS['relation'])
card(1040,750,480,210,'Context · 고정 개정 인용',['“왜 VM으로 시작했지?”','지식 A의 두 번째 개정','근거: 원문 A · 첫 번째 개정 · 1행','조회 시점 · 대체·미확인 상태'],'app')
path('M1340 570 V750',flow='query')
card(540,750,430,210,'작업 에이전트 · 조회 Skill',['조회 Skill의 판단 지침 적용','필요한 지식·원문만 단계적 조회','고정 개정을 인용해 답변·작업'],'app','tabler-terminal-2')
path('M1040 855 H970',flow='query')
card(40,750,430,210,'웹에서 확인',['인용된 원문 구간·과거 개정','작성 주체와 확인 상태 구분','관련 문서 링크 ≠ 근거'],'web','user')
text(40,1040,'Wiki CLI의 백그라운드 수집이 원문을 먼저 보관한다. 정제는 원격 Worker가 외부 AI API로 처리하며 사용자 조회와 분리한다.',21)
text(40,1080,'원문과 과거 개정·정제 기록은 덮어쓰지 않는다.',20)
end('docs/assets/wiki-lineage.svg')

canvas(1560,1210,'운영 · 사용자 작업과 백그라운드 처리 분리','목표 운영 구성. 기존 VM과 볼륨, 도메인, 인증서, OAuth, 비용과 오류 모니터링을 재사용한다. CLI 반영의 멱등성과 API 정상 종료를 검증한다. 앱이 Slack을 직접 호출하지 않는다.')
rows=[(190,'01','인프라',[
 ('terraform','Terraform / HCL','기존 VM · 볼륨 · 버킷 유지','추가 자원·사양 변경 없음'),('ubuntu','cloud-init / systemd','Docker·마운트 · 부팅 시 기동','OS·Docker 업데이트 직접 관리'),('github','Docker Compose','Caddy · Web · API · PostgreSQL','원격 정제 Worker · 별도 실행')]),
 (385,'02','앱 배포',[
 ('github','외부 ARM64 빌드','GHCR 게시 → VM 미리 pull','새 구조 검증 후 일괄 교체'),('tabler-terminal-2','외부 차단 → 정상 종료','진행 요청·정제 작업 마무리','미완료 정제는 재시도'),('tabler-clipboard-check','기동·반영·조회 확인','DB·Caddy 유지 · 짧은 중단','쓰기 결과는 멱등 키로 확인')]),
 (580,'03','오류 로그',[
 ('ubuntu','stdout → OCI Logging','Docker syslog · rsyslog','OCI 기성 호스트 에이전트'),('oracle','OCI Monitoring 경보','Connector Hub · ERROR 이상 집계','5분 구간 감지 · 수집 대기 5분'),('tabler-bell','Notifications → Slack','한국어 제목·본문 · 로그 링크','상태 변경 시 알림 · 반복 없음')]),
 (775,'04','비용·사용량',[
 ('oracle','OCI Usage API','비용·CPU·메모리·저장소','미집계와 0을 구분'),('github','Actions · 6시간마다','비용 발생·한도 접근·사용 급증','09:13 한국 시각 정기 요약'),('tabler-bell','Slack Webhook','누적·일 사용량·전일 비교','기존 모니터링 경로 유지')]),
 (970,'05','별도 수집',[
 ('tabler-cloud-upload','Wiki CLI · 수집 → Storage','허가 후 zstd 증분 직접 업로드','기기별 위치 · 실패 시 재시도'),('tabler-clipboard-check','서버 검증·L1 등록','세션 ID·내용으로 중복 판정','원문 확정 뒤 연속 수신 위치 갱신'),('tabler-terminal-2','원격 Worker → 외부 AI','최대 20 RPM · 동시 실행 1개','최소 2분 재시도 · 이력 보존')])]
for y,n,label,items in rows:
 text(40,y+32,n,20,True);text(40,y+73,label,25,True)
 for i,(ico,title,b,c) in enumerate(items):
  x=225+i*438
  card(x,y,388,150,title,[b,c],'ops' if n in ['01','04'] else 'app',ico)
  if i<2:path(f'M{x+388} {y+75} H{x+432}')
end('docs/assets/wiki-operations.svg')
