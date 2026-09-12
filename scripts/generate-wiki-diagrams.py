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

canvas(1800,1120,'개인 에이전트 정제 · 원격 Wiki 보관','전환 목표. 개인 에이전트가 자신의 모델 사용량으로 정제하며 CLI로 원문과 지식을 올린다. 서버는 Caddy, Web, API, PostgreSQL 4개 컨테이너이며 서버 추론 Worker와 큐는 없다. 원문은 Object Storage, DB와 Caddy 상태는 연결 볼륨에 보관한다.')
legend(1390,42,'원문·지식 반영','ingest');legend(1390,77,'조회·Context','query');legend(1390,112,'저장·운영 연결','ops',True)
group(40,180,320,670);text(64,216,'개인 작업 환경',23,True,'#FFFFFF')
group(420,180,1020,670);text(448,216,'OCI A1 VM · 2 OCPU / 12GB',25,True,'#FFFFFF');text(1130,214,'Compose · 4개',20,True,'#FFFFFF')
# Aligned client, gateway, API and DB routes.
path('M328 350 H460',flow='query',both=True)
path('M660 350 H760',flow='query',both=True)
path('M910 430 V490',flow='query',both=True)
path('M328 570 H460',flow='query',both=True)
path('M328 670 H460',flow='ingest')
path('M660 570 H760',flow='query',both=True)
path('M660 670 H760',flow='ingest')
path('M1060 570 H1120',flow='query',both=True)
path('M1060 670 H1120',flow='ingest')
path('M1400 570 H1480',True,both=True)
path('M910 730 V900',flow='ingest');text(926,865,'원문 저장',18,True,FLOW_COLORS['ingest'])
path('M1260 730 V900',True);text(1276,865,'연결·마운트',18)
card(72,290,256,140,'웹 Wiki',['agent-wiki.duckdns.org','편집·정정·근거 확인'],'web','user')
card(72,490,256,280,'개인 에이전트',['사용 중인 모델·플랜','원문 선택·정제·답변','Skill · 작업 지침','CLI · 조회·등록·반영'],'ingest','tabler-terminal-2')
card(460,290,200,440,'Caddy',['HTTPS · 경로 분기','DuckDNS → VM IP','ACME 자동 갱신','','조회 ↔ API','','반영 → API'],'app','caddy')
card(760,290,300,140,'Next.js · 웹',['문서·개정·원문 확인','web:3000'],'web','nextdotjs')
card(760,490,300,240,'Fastify API',['시작 Context · 키워드 조회','원문·근거·권한 검사','개정·멱등 반영','api:3001'],'app','fastify')
card(1120,490,280,240,'PostgreSQL',['지식·개정·리니지','반영 결과 · 검색 색인','postgres:5432 · TLS','모델·큐 실행 없음'],'data','postgresql')
card(1480,490,280,165,'DataGrip',['공인 5432 · ID/PWD · TLS','IP 제한 없음'],'web','tabler-terminal-2')
card(460,765,200,60,'호스트 로그',[],'ops','ubuntu')
card(760,900,300,170,'Object Storage',['비공개 원문 보관본','고정 개정 · 해시 · 구간'],'data','oracle')
card(1120,900,320,170,'Block Volume · 50GB',['DB · Caddy 상태 / 별도 경로','부트 50GB 별도'],'data','oracle')
end('docs/assets/wiki-deployment.svg')

canvas(1560,1210,'지식은 Wiki에 · 정제와 답변은 에이전트에','L1부터 L5의 논리 계층. 합성 단일 VM 결정을 원문에서 개인 에이전트가 정제하고 Wiki에서 조회해 다음 작업에 사용한다. 번호는 배포 위치나 원격 처리 순서를 뜻하지 않는다.')
legend(1140,43,'원문·지식 반영','ingest');legend(1140,78,'조회·답변','query')
box(40,164,1480,46,'#344256','#344256');text(60,195,'Workspace · 개인 작업',22,True,'#FFFFFF');text(780,194,'Tag · agent-observatory / agent-wiki',19,True,'#FFFFFF')
rows=[
 (5,240,'Answers','개인 에이전트','조회한 근거로 답변·작업','현재는 단일 VM을 유지하고 분리는 후속으로 검토한다.','app'),
 (4,420,'Query','Wiki 서버','시작 Context · 키워드·별칭 검색','VM 선택 이유 → 지식 A의 첫 번째 개정 · 근거: 원문 A의 1행','app'),
 (3,600,'Wiki','Wiki 서버','Memory · Article · Glossary','지식 A · 첫 번째 개정: 단일 VM 결정 / 사용자 결정 · 검토 미완료','data'),
 (2,780,'Ingest','개인 에이전트 → API','원문·기존 지식 비교 → 근거 연결 → 구조 검증·반영','정제·반영 기록: 원문 A의 1행 → 단일 VM 운영 주장 → 지식 A','ingest'),
 (1,960,'Raw sources','Wiki 보관 · CLI 등록','선택한 대화·문서·코드의 고정 보관본','원문 A · 첫 번째 개정 · 1행: “지금은 단일 VM으로 운영하자.”','ops')]
for n,y,name,who,title,example,role in rows:
 component(40,y,1480,145,role)
 box(40,y,82,145,'#344256','#344256');text(56,y+84,f'L{n}',31,True,'#FFFFFF')
 text(146,y+43,name,25,True);text(146,y+82,who,18)
 a(f'<path d="M430 {y+20} V{y+125}" stroke="#929EAD"/>')
 text(456,y+43,title,24,True);text(456,y+91,example,21)
 if n<5:path(f'M80 {y} V{y-35}',flow='ingest' if n<=2 else 'query')
text(40,1163,'Schema · 구조 규칙     Index · 목차·색인     Log · 실행 이력     Lint · 구조 점검 / 의미 검토는 에이전트',20)
end('docs/assets/wiki-layers.svg')

canvas(1560,1130,'리니지 · 실제 원문에서 현재 결정까지','합성 예시. 원문 보관본과 기존 지식의 고정 개정이 실제 개인 에이전트 정제 실행의 입력이다. 결과 지식의 주장마다 정확한 근거 구간을 연결하고 고정 개정 Context를 반환한다. 관련 문서 링크는 근거와 구분한다.')
legend(1140,43,'정제·반영','ingest');legend(1140,78,'조회·활용','query');legend(1140,113,'근거 참조','relation')
group(40,190,430,380);text(62,226,'1 · 입력의 고정 보관본',23,True,'#FFFFFF')
card(72,284,366,118,'원문 A · 첫 번째 개정',['1행 · “단일 VM으로 운영하자.”'],'data')
card(72,426,366,112,'지식 A · 첫 번째 개정',['현재 구성 · 미완료 작업'],'data')
group(540,190,430,380);text(562,226,'2 · 개인 에이전트 정제',23,True,'#FFFFFF')
card(572,284,366,254,'정제·반영 기록',['입력: 원문 A · 지식 A의 첫 개정','비교·정정·주장별 근거 선택','주체 · Skill 버전 · 시점','새 결과: 지식 A의 두 번째 개정'],'ingest')
path('M470 380 H540',flow='ingest')
group(1040,190,480,380);text(1062,226,'3 · Wiki 원자적 반영',23,True,'#FFFFFF')
card(1072,284,416,254,'지식 A · 두 번째 개정',['주장: 단일 VM 운영','유형: 사용자 결정','작성: 에이전트 / 확인: 미완료','근거: 원문 A · 첫 번째 개정 · 1행'],'data')
path('M970 380 H1040',flow='ingest')
# Evidence returns under the three cards, independently from processing flow.
path('M1270 570 V632 H250 V570',flow='relation');text(550,618,'주장별 근거 · 보관본 개정·구간을 고정',20,True,FLOW_COLORS['relation'])
card(1040,750,480,210,'Context · 고정 개정 인용',['“왜 VM으로 시작했지?”','지식 A의 두 번째 개정','근거: 원문 A · 첫 번째 개정 · 1행','조회 시점 · 대체·미확인 상태'],'app')
path('M1340 570 V750',flow='query')
card(540,750,430,210,'다음 세션의 에이전트',['Context를 읽고 답변·작업','근거가 부족하면 추가 조회','현재 작업에 필요한 내용만'],'app','tabler-terminal-2')
path('M1040 855 H970',flow='query')
card(40,750,430,210,'웹에서 확인',['인용된 원문 구간·과거 개정','작성 주체와 확인 상태 구분','관련 문서 링크 ≠ 근거'],'web','user')
text(40,1040,'원문이 없으면 작성자 진술 · 모델 이름은 알 때만 기록 · 과거 정제 실행을 만들어 넣지 않음',21)
text(40,1080,'서버는 구간·권한·개정·중복을 검사한다. 해석의 타당성과 실제 답변 사용 여부는 별개다.',20)
end('docs/assets/wiki-lineage.svg')

canvas(1560,1210,'운영 · 정제 Worker 없이 4개 컨테이너','목표 운영 구성. 기존 VM과 볼륨, 도메인, 인증서, OAuth, 비용과 오류 모니터링을 재사용한다. CLI 반영의 멱등성과 API 정상 종료를 검증한다. 앱이 Slack을 직접 호출하지 않는다.')
rows=[(190,'01','인프라',[
 ('terraform','Terraform / HCL','기존 VM · 볼륨 · 버킷 유지','추가 자원·사양 변경 없음'),('ubuntu','cloud-init / systemd','Docker·마운트 · 부팅 시 기동','OS·Docker 업데이트 직접 관리'),('github','Compose · 4개','Caddy · Web · API · PostgreSQL','정제는 개인 에이전트에서 실행')]),
 (385,'02','앱 배포',[
 ('github','외부 ARM64 빌드','GHCR 게시 → VM 미리 pull','새 구조 검증 후 일괄 교체'),('tabler-terminal-2','외부 차단 → API 종료','진행 요청·내부 호출·DB 정리','API 30초 · Compose 유예 45초'),('tabler-clipboard-check','기동·반영·조회 확인','DB·Caddy 유지 · 짧은 중단','쓰기 결과는 멱등 키로 확인')]),
 (580,'03','오류 로그',[
 ('ubuntu','stdout → OCI Logging','Docker syslog · rsyslog','OCI 기성 호스트 에이전트'),('oracle','OCI Monitoring 경보','Connector Hub · ERROR 이상 집계','5분 구간 감지 · 수집 대기 5분'),('tabler-bell','Notifications → Slack','한국어 제목·본문 · 로그 링크','상태 변경 시 알림 · 반복 없음')]),
 (775,'04','비용·사용량',[
 ('oracle','OCI Usage API','비용·CPU·메모리·저장소','미집계와 0을 구분'),('github','Actions · 6시간마다','비용 발생·한도 접근·사용 급증','09:13 한국 시각 정기 요약'),('tabler-bell','Slack Webhook','누적·일 사용량·전일 비교','기존 모니터링 경로 유지')]),
 (970,'05','실제 사용',[
 ('tabler-terminal-2','개인 에이전트·CLI','원문 등록 → 정제 → 반영','정제 실패는 클라이언트에 표시'),('tabler-clipboard-check','Wiki API 구조 검사','원문 구간·권한·개정·멱등성','변경 묶음 전체 반영 또는 거부'),('user','새 세션 재개','시작 Context → 근거 상세','정정·삭제·근거 없음 확인')])]
for y,n,label,items in rows:
 text(40,y+32,n,20,True);text(40,y+73,label,25,True)
 for i,(ico,title,b,c) in enumerate(items):
  x=225+i*438
  card(x,y,388,150,title,[b,c],'ops' if n in ['01','04'] else 'app',ico)
  if i<2:path(f'M{x+388} {y+75} H{x+432}')
end('docs/assets/wiki-operations.svg')
