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
 text(40,42,'AGENT WIKI / TARGET ARCHITECTURE',15,True,'#526A86')
 text(40,98,title,34,True)
 a(f'<path d="M40 137 H{w-40}" stroke="#172C4B" stroke-width="2"/>')
def card(x,y,w,h,title,lines,role='app',ico=None):
 component(x,y,w,h,role)
 if ico:icon(ico,x+20,y+19,26)
 text(x+(58 if ico else 20),y+42,title,23,True)
 for i,line in enumerate(lines):text(x+20,y+80+i*31,line,18)

canvas(1940,1390,'작업은 그대로 · 수집과 정제는 별도로','설계안. 작업 에이전트와 읽기 전용 Collector를 분리한다. Collector와 별도 백그라운드 정제는 미구현이며 정제 실행 위치와 모델 연결은 미정이다. DNS와 인증서 자동 갱신, 기존 Wiki 4개 컨테이너를 유지한다.')
legend(1530,42,'수집·지식 반영','ingest');legend(1530,77,'조회·응답','query');legend(1530,112,'도메인·인증·저장','ops',True)
# Service discovery and persistent storage are not HTTP intermediaries.
card(72,180,366,130,'DuckDNS · 도메인',['agent-wiki.duckdns.org','도메인 조회 → VM 공인 주소'],'web','tabler-world')
card(940,180,280,130,'인증서 발급 기관',['Caddy가 발급·갱신 요청','HTTPS 인증서 자동 관리'],'ops')
card(1280,180,320,170,'연결 볼륨 · 50GB',['PostgreSQL 데이터','Caddy 인증서·설정','부트 볼륨 50GB 별도'],'data','oracle')
group(40,370,430,900);text(64,406,'사용자 기기',24,True,'#FFFFFF')
group(590,370,1010,630);text(614,406,'OCI A1 VM · 2 OCPU / 12GB',24,True,'#FFFFFF');text(1330,406,'Compose · 4개',20,True,'#FFFFFF')
# DNS resolution, certificate issuance, and volume mounts.
path('M200 450 V310',True,both=True)
path('M438 245 H745 V450',True);text(490,230,'도메인 → VM 공인 주소',18)
path('M940 255 H885 V420 H800 V450',True,both=True)
path('M860 480 H905 V335 H1280',True);text(960,329,'인증서 상태 보관',17)
path('M1450 350 V640',True);text(1468,530,'데이터 연결',17)
# User traffic stays in the upper lane.
path('M438 520 H630',flow='query',both=True)
path('M860 520 H940',flow='query',both=True)
path('M438 710 H630',flow='query',both=True)
path('M860 710 H940',flow='query',both=True)
path('M1080 580 V640',flow='query',both=True)
path('M1220 710 H1280',flow='query',both=True)
path('M1220 845 H1280',flow='ingest')
path('M1600 710 H1660',True,both=True)
for hx,hw,label in [(40,430,'사용자 기기'),(590,1010,'OCI A1 VM · 2 OCPU / 12GB')]:
 box(hx+1,371,hw-2,52,'#344256','#344256');text(hx+24,406,label,24,True,'#FFFFFF')
text(1330,406,'Compose · 4개',20,True,'#FFFFFF')
card(72,450,366,130,'웹 Wiki',['agent-wiki.duckdns.org','지식 편집·정정·근거 확인'],'web','user')
card(72,640,366,140,'작업 에이전트',['Claude · Codex 등','필요한 지식 조회 · 사용자와 작업'],'app','tabler-terminal-2')
# Clients write their own history; collection never enters their session.
path('M250 780 V820',flow='ops');text(267,806,'클라이언트가 기록',16)
card(72,820,366,115,'클라이언트 세션 기록',['변경 중인 파일 · 원격 원문과 구분'],'web')
path('M250 935 V1010',flow='ingest');text(267,976,'완성된 기록만 읽기',17,True,FLOW_COLORS['ingest'])
card(72,1010,366,220,'Collector · Watcher',['별도 프로세스 · 미구현','변경분 수집 · 제외·마스킹','대화 삽입·응답 대기 없음','전송 실패는 별도로 재시도'],'ingest')
# All background traffic still enters through HTTPS/Caddy.
path('M438 1140 H520 V975 H690 V950',flow='ingest');text(480,960,'원문 전송',18,True,FLOW_COLORS['ingest'])
path('M860 845 H940',flow='ingest')
path('M800 950 V1020 H825 V1070',flow='query',both=True)
path('M880 1070 V1040 H840 V950',flow='ingest')
card(630,450,230,500,'Caddy',['HTTPS 접속 처리','웹·API 경로 분기','인증서 자동 갱신'],'app','caddy')
text(650,682,'조회 ↔ API',18,True,FLOW_COLORS['query'])
text(650,817,'원문·지식 → API',18,True,FLOW_COLORS['ingest'])
card(940,450,280,130,'Next.js · 웹',['웹 위키 화면','내부 전용 연결'],'web','nextdotjs')
card(940,640,280,250,'Fastify API',['원문 보관·검색·조회','근거·권한·개정 검사','변경 묶음 일괄 반영','모델 실행 없음'],'app','fastify')
card(1280,640,320,250,'PostgreSQL',['지식·개정·근거 연결','원문 메타데이터','정제·반영 기록'],'data','postgresql')
card(1660,640,240,170,'DataGrip',['공인 5432 · 암호·TLS','IP 제한 없음'],'web')
# Refining is a separate execution context; its deployment is undecided.
card(590,1070,610,220,'백그라운드 정제 · 미구현',['작업 세션과 별도 실행 · 위치·모델 연결 미정','원격 원문·기존 지식 조회 → 군집화·정제·반영','Skill은 이 실행의 정제 지침 · 수집기 역할 아님','HTTPS로 Caddy 경유 · 모델 사용량 별도 고려'],'ingest')
path('M1150 890 V970 H1245 V1160 H1280',True,both=True)
card(1280,1070,320,190,'Object Storage',['원격 원문 보관본','보관한 내용은 덮어쓰지 않음','새 기록은 새 원문으로 추가'],'data','oracle')
text(40,1330,'설계 변경: Collector·백그라운드 정제는 아직 미구현. 작업 세션에서 수집·정제를 실행하지 않는다.',22,True)
end('docs/assets/wiki-deployment.svg')

canvas(1560,1210,'수집·정제와 사용자 조회를 분리','L1부터 L5의 논리 계층. 별도 Collector가 원문을 보관하고 백그라운드 실행이 정제한다. 작업 에이전트는 필요한 지식만 조회한다. Collector와 백그라운드 정제는 미구현이다. 번호는 배포 위치나 원격 처리 순서를 뜻하지 않는다.')
legend(1140,43,'원문·지식 반영','ingest');legend(1140,78,'조회·답변','query')
box(40,164,1480,46,'#344256','#344256');text(60,195,'Workspace · 개인 작업',22,True,'#FFFFFF');text(780,194,'Tag · agent-observatory / agent-wiki',19,True,'#FFFFFF')
rows=[
 (5,240,'Answers','작업 에이전트','필요한 근거를 조회해 답변·작업','현재는 단일 VM을 유지하고 분리는 후속으로 검토한다.','app'),
 (4,420,'Query','Wiki 서버','시작 Context · 키워드·별칭 검색','VM 선택 이유 → 지식 A의 첫 번째 개정 · 근거: 원문 A의 1행','app'),
 (3,600,'Wiki','Wiki 서버','Memory · Article · Glossary','지식 A · 첫 번째 개정: 단일 VM 결정 / 사용자 결정 · 검토 미완료','data'),
 (2,780,'Ingest','별도 정제 실행','군집화·기존 지식 비교 → 근거 연결 → 검증·반영','정제·반영 기록: 원문 A의 1행 → 단일 VM 운영 주장 → 지식 A','ingest'),
 (1,960,'Raw sources','Collector → Wiki','별도 Collector가 수집한 기록의 불변 보관본','원문 A · 첫 번째 개정 · 1행: “지금은 단일 VM으로 운영하자.”','ops')]
for n,y,name,who,title,example,role in rows:
 component(40,y,1480,145,role)
 box(40,y,82,145,'#344256','#344256');text(56,y+84,f'L{n}',31,True,'#FFFFFF')
 text(146,y+43,name,25,True);text(146,y+82,who,18)
 a(f'<path d="M430 {y+20} V{y+125}" stroke="#929EAD"/>')
 text(456,y+43,title,24,True);text(456,y+91,example,21)
 if n<5:path(f'M80 {y} V{y-35}',flow='ingest' if n<=2 else 'query')
text(40,1163,'설계안 · Collector와 백그라운드 정제는 미구현. 작업 대화에는 수집·정제 요청을 삽입하지 않는다.',20)
end('docs/assets/wiki-layers.svg')

canvas(1560,1130,'리니지 · 실제 원문에서 현재 결정까지','합성 예시. 원문 보관본과 기존 지식의 고정 개정이 별도 백그라운드 정제 실행의 입력이다. Collector와 백그라운드 정제는 미구현이다. 결과 지식의 주장마다 정확한 근거 구간을 연결하고 고정 개정 Context를 반환한다. 관련 문서 링크는 근거와 구분한다.')
legend(1140,43,'정제·반영','ingest');legend(1140,78,'조회·활용','query');legend(1140,113,'근거 참조','relation')
group(40,190,430,380);text(62,226,'1 · 원격 입력 보관본',23,True,'#FFFFFF')
card(72,284,366,118,'원문 A · 첫 번째 개정',['1행 · “단일 VM으로 운영하자.”'],'data')
card(72,426,366,112,'지식 A · 첫 번째 개정',['현재 구성 · 미완료 작업'],'data')
group(540,190,430,380);text(562,226,'2 · 별도 백그라운드 정제',23,True,'#FFFFFF')
card(572,284,366,254,'정제·반영 기록',['입력: 원문 A · 지식 A의 첫 개정','비교·정정·주장별 근거 선택','정제 주체 · 지침 버전 · 시점','새 결과: 지식 A의 두 번째 개정'],'ingest')
path('M470 380 H540',flow='ingest')
group(1040,190,480,380);text(1062,226,'3 · Wiki 검증·일괄 반영',23,True,'#FFFFFF')
card(1072,284,416,254,'지식 A · 두 번째 개정',['주장: 단일 VM 운영','유형: 사용자 결정','작성: 에이전트 / 확인: 미완료','근거: 원문 A · 첫 번째 개정 · 1행'],'data')
path('M970 380 H1040',flow='ingest')
# Evidence returns under the three cards, independently from processing flow.
path('M1270 570 V632 H250 V570',flow='relation');text(550,618,'주장별 근거 · 보관본 개정·구간을 고정',20,True,FLOW_COLORS['relation'])
card(1040,750,480,210,'Context · 고정 개정 인용',['“왜 VM으로 시작했지?”','지식 A의 두 번째 개정','근거: 원문 A · 첫 번째 개정 · 1행','조회 시점 · 대체·미확인 상태'],'app')
path('M1340 570 V750',flow='query')
card(540,750,430,210,'사용자의 작업 에이전트',['필요할 때 지식 조회·활용','근거가 부족하면 추가 조회','현재 작업에 필요한 내용만'],'app','tabler-terminal-2')
path('M1040 855 H970',flow='query')
card(40,750,430,210,'웹에서 확인',['인용된 원문 구간·과거 개정','작성 주체와 확인 상태 구분','관련 문서 링크 ≠ 근거'],'web','user')
text(40,1040,'Collector가 원문을 먼저 보관한다. 정제는 별도 실행하며 사용자의 질문·응답을 기다리게 하지 않는다.',21)
text(40,1080,'설계안 · Collector·백그라운드 정제는 미구현. 원문과 과거 개정·정제 기록은 덮어쓰지 않는다.',20)
end('docs/assets/wiki-lineage.svg')

canvas(1560,1210,'운영 · 사용자 작업과 백그라운드 처리 분리','목표 운영 구성. 기존 VM과 볼륨, 도메인, 인증서, OAuth, 비용과 오류 모니터링을 재사용한다. CLI 반영의 멱등성과 API 정상 종료를 검증한다. 앱이 Slack을 직접 호출하지 않는다.')
rows=[(190,'01','인프라',[
 ('terraform','Terraform / HCL','기존 VM · 볼륨 · 버킷 유지','추가 자원·사양 변경 없음'),('ubuntu','cloud-init / systemd','Docker·마운트 · 부팅 시 기동','OS·Docker 업데이트 직접 관리'),('github','Compose · 4개','Caddy · Web · API · PostgreSQL','백그라운드 정제 위치는 미정')]),
 (385,'02','앱 배포',[
 ('github','외부 ARM64 빌드','GHCR 게시 → VM 미리 pull','새 구조 검증 후 일괄 교체'),('tabler-terminal-2','외부 차단 → API 종료','진행 요청·내부 호출·DB 정리','API 30초 · Compose 유예 45초'),('tabler-clipboard-check','기동·반영·조회 확인','DB·Caddy 유지 · 짧은 중단','쓰기 결과는 멱등 키로 확인')]),
 (580,'03','오류 로그',[
 ('ubuntu','stdout → OCI Logging','Docker syslog · rsyslog','OCI 기성 호스트 에이전트'),('oracle','OCI Monitoring 경보','Connector Hub · ERROR 이상 집계','5분 구간 감지 · 수집 대기 5분'),('tabler-bell','Notifications → Slack','한국어 제목·본문 · 로그 링크','상태 변경 시 알림 · 반복 없음')]),
 (775,'04','비용·사용량',[
 ('oracle','OCI Usage API','비용·CPU·메모리·저장소','미집계와 0을 구분'),('github','Actions · 6시간마다','비용 발생·한도 접근·사용 급증','09:13 한국 시각 정기 요약'),('tabler-bell','Slack Webhook','누적·일 사용량·전일 비교','기존 모니터링 경로 유지')]),
 (970,'05','별도 수집',[
 ('tabler-device-laptop','Collector · 미구현','세션 기록을 별도로 읽어 전송','대화 삽입·응답 대기 없음'),('tabler-clipboard-check','원격 원문 보관','수집한 원문은 불변 보관','전송 실패·중복은 별도 처리'),('tabler-terminal-2','백그라운드 정제 · 미구현','군집화·근거 연결·지식 반영','작업 세션과 별도 실행')])]
for y,n,label,items in rows:
 text(40,y+32,n,20,True);text(40,y+73,label,25,True)
 for i,(ico,title,b,c) in enumerate(items):
  x=225+i*438
  card(x,y,388,150,title,[b,c],'ops' if n in ['01','04'] else 'app',ico)
  if i<2:path(f'M{x+388} {y+75} H{x+432}')
end('docs/assets/wiki-operations.svg')
