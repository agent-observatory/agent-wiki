# Generate editable Wiki architecture SVGs. Run from the repository root.
from pathlib import Path
from html import escape
import json, re, xml.etree.ElementTree as ET
ET.register_namespace('', 'http://www.w3.org/2000/svg')
p=[]
LAYER_NAMES=json.loads(Path('apps/agent-wiki-web/lib/layer-names.json').read_text())
def layer_label(n):return f'L{n} · {LAYER_NAMES[f"L{n}"]}'
FONT={'diagram':34,'group':24,'component':20,'body':18,'label':16,'layer':32}
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
def text(x,y,s,z=FONT['body'],b=False,c='#172C4B'):a(f'<text x="{x}" y="{y}" font-size="{z}" font-weight="{700 if b else 400}" fill="{c}">{escape(s)}</text>')
FLOW_COLORS={'ingest':'#B35C00','query':'#245CC5','ops':'#68778B','relation':'#8054A3'}
def path(d,dash=False,flow='ops',both=False):
 c=FLOW_COLORS[flow]
 a(f'<path d="{d}" fill="none" stroke="{c}" stroke-width="2.5" stroke-linejoin="round"'+(' stroke-dasharray="6 5"' if dash else '')+f' marker-end="url(#arrow-{flow})"'+(f' marker-start="url(#arrow-{flow})"' if both else '')+'/>')
def flow_markers():
 return ''.join(f'<marker id="arrow-{k}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4.5 L1 8" fill="none" stroke="{c}" stroke-width="2"/></marker>' for k,c in FLOW_COLORS.items())
def legend(x,y,label,flow,dash=False):
 path(f'M{x} {y} H{x+48}',dash,flow);text(x+62,y+6,label,FONT["label"],True,FLOW_COLORS[flow])
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
 text(40,42,'AGENT WIKI / ARCHITECTURE',FONT["label"],True,'#526A86')
 text(40,98,title,FONT["diagram"],True)
 a(f'<path d="M40 137 H{w-40}" stroke="#172C4B" stroke-width="2"/>')
def card(x,y,w,h,title,lines,role='app',ico=None):
 if ico is None:
  ico={'app':'tabler-book-2','ingest':'tabler-cpu','data':'tabler-book-2','ai':'tabler-cloud','ops':'tabler-clipboard-check','web':'tabler-world'}[role]
 component(x,y,w,h,role)
 text(x+20,y+42,title,FONT['component'],True)
 if lines:
  if ico:icon(ico,x+20,y+60,24)
  for i,line in enumerate(lines):text(x+(54 if i==0 and ico else 20),y+80+i*31,line,FONT['body'])
 elif ico:
  # Icon-only metadata row is unnecessary for a title-only card.
  icon(ico,x+w-44,y+20,24)


canvas(1920,1330,'로컬에서 수집 · 원격에서 정제','단일 설치하는 Agent Wiki CLI의 백그라운드 수집이 API에서 업로드 허가를 받고 압축 증분을 Object Storage에 직접 전송한다. 서버가 검증·중복 판단 후 L1을 등록한다. 원격 L2 Worker가 Wiki에 저장한 제공자와 모델 설정에 따라 외부 AI API로 정제하고 근거와 실행 기록을 보존한다. 사용자 조회는 정제 완료를 기다리지 않는다.')
legend(1110,87,'수집·지식 반영','ingest');legend(1370,87,'조회·응답','query');legend(1600,87,'설정·인증·저장','ops',True)
# DNS, certificate issuance, and persistent storage are not HTTP intermediaries.
card(72,180,366,130,'DuckDNS · 도메인',['agent-wiki.duckdns.org','도메인 조회 → VM 공인 주소'],'web','tabler-world')
card(940,180,280,130,'인증서 발급 기관',['Caddy가 발급·갱신 요청','HTTPS 인증서 자동 관리'],'ops','letsencrypt')
card(1280,180,320,170,'agent-wiki-data',['Block Volume · 50GB','DB 데이터 · 인증서·설정','부트 볼륨 50GB 별도'],'data','oracle')
group(40,370,430,912);text(64,406,'사용자 기기',FONT["group"],True,'#FFFFFF')
group(590,370,1010,830)
path('M200 450 V310',True,both=True)
path('M438 245 H745 V450',True);text(490,230,'도메인 → VM 공인 주소',FONT["label"])
path('M940 255 H800 V450',True,both=True)
path('M880 480 H905 V335 H1280',True);text(960,329,'인증서 상태 보관',FONT["label"])
path('M1450 350 V640',True);text(1468,530,'데이터 연결',FONT["label"])
# Interactive reads and background writes use separate lanes.
path('M438 520 H630',flow='query',both=True)
path('M880 520 H940',flow='query',both=True)
path('M438 855 H630',flow='query',both=True)
path('M880 855 H940',flow='query',both=True)
path('M1080 580 V640',flow='query',both=True)
path('M1220 710 H1280',flow='query',both=True)
path('M1220 790 H1280',flow='ingest')
# Repaint headers above connectors crossing group boundaries.
for hx,hw in [(40,430),(590,1010)]:
 box(hx+1,371,hw-2,52,'#344256','#344256')
text(64,406,'사용자 기기',FONT["group"],True,'#FFFFFF')
icon('oracle',614,383,32);text(660,406,'agent-wiki-vm · A1 · 2 OCPU / 12GB',FONT["group"],True,'#FFFFFF')
a('<g role="img" aria-label="Docker Compose"><title>Docker Compose</title>');icon('docker',1534,378,40);a('</g>')
card(72,450,366,130,'agent-wiki-web',['브라우저 · 웹 UI','agent-wiki.duckdns.org'],'web','user')
card(72,640,366,145,'Codex · Claude Code',['작업 에이전트'],'app','tabler-terminal-2')
component(92,735,326,34,'ai');icon('tabler-clipboard-check',103,741,22)
text(134,759,'agent-wiki · 설치된 조회 Skill',FONT["label"],True)
# Runtime placement: installed guidance belongs to the host agent.
path('M355 785 V825',flow='query',both=True)
group(72,825,366,425)
text(92,863,'agent-wiki-client',FONT['group'],True,'#FFFFFF')
text(92,908,'설치 패키지 · 하나로 배포',FONT['body'])
card(92,930,326,110,'agent-wiki-cli',['agent-wiki search / recall'],'app','tabler-terminal-2')
card(92,1070,326,120,'agent-wiki-collector',['수집 · agent-wiki collector','독립 프로세스 · 기본 10분'],'ingest','tabler-cloud-upload')
path('M438 1120 H520 V885 H630',flow='ingest',both=True);text(535,1030,'수집 제어',FONT["label"],True,FLOW_COLORS['ingest'])
path('M880 885 H940',flow='ingest',both=True)
card(630,450,250,460,'agent-wiki-gateway',['Caddy · HTTPS','웹·API 경로 분기','인증서 자동 갱신'],'app','caddy')
card(940,450,280,130,'agent-wiki-web',['웹 UI · Next.js','지식·근거 확인 · AI 설정'],'web','nextdotjs')
card(940,640,280,270,'agent-wiki-api',['Fastify · 검색·수집 API','업로드 허가·상태 조회','수신 검증·중복 판정','L1 등록·수신 위치 확정','지식 검색·정제 결과 반영','AI 설정 저장·조회'],'app','fastify')
card(1280,640,280,200,'agent-wiki-db',['PostgreSQL · 지식·근거','세션·출처별 수신 위치','업로드·정제 작업 이력','AI 제공자·모델 설정'],'data','postgresql')
# Raw storage is outside the VM; its API connection is a straight horizontal line.
path('M1220 870 H1640',True,both=True);text(1290,902,'허가·검증·원문 확정',FONT["label"])
card(1640,820,240,190,'agent-wiki-sources',['OCI Object Storage','검증 후 불변 L1 확정','텍스트·이미지 분리'],'data','oracle')
# L2 is a server-side process using the internal API, never the user's agent session.
path('M1080 910 V970',flow='ingest',both=True);text(1098,942,'작업·근거·반영',FONT["label"],True,FLOW_COLORS['ingest'])
card(940,970,280,198,'agent-wiki-worker',['원격 정제 · 구조 청킹','청크별 주장·근거 추출','기존 지식 비교·검증','최대 20 RPM · 동시 실행 1개'],'ingest')
# This card describes configuration stored in Wiki, not another container.
card(630,970,250,168,'Wiki · AI 설정',['제공자 · 모델 · API 연결','기본: 일일 제한 없음','일일 한도는 선택 설정'],'ops')
path('M880 1070 H940',True)
path('M1220 1080 H1640',flow='ingest',both=True);text(1320,1060,'텍스트 청크·결과',FONT["label"],True,FLOW_COLORS['ingest'])
card(1640,1050,240,82,'AI Provider',[],'ai','openai')
path('M438 1215 H1900 V940 H1880',flow='ingest');text(630,1248,'압축 증분 직접 업로드 · 본문은 API를 통과하지 않음',FONT["label"],True,FLOW_COLORS['ingest'])
for right,by,n,width in [(424,434,5,150),(424,624,5,150),(404,1054,1,170),(1206,954,2,152),(1546,624,3,172),(1206,624,4,132),(1866,804,1,170)]:
 bx=right-width
 box(bx,by,width,32,'#344256','#344256');text(bx+12,by+23,layer_label(n),FONT["label"],True,'#FFFFFF')
end('docs/assets/wiki-deployment.svg')

canvas(1560,1145,'수집·정제와 사용자 조회를 분리','L1부터 L5의 논리 계층. Collector가 원문을 보관하고 원격 Worker가 외부 AI API로 정제한다. 작업 에이전트는 필요한 지식만 조회한다. 번호는 배포 위치나 원격 처리 순서를 뜻하지 않는다.')
legend(1140,43,'원문·지식 반영','ingest');legend(1140,78,'조회·답변','query')
box(40,164,1480,46,'#344256','#344256');text(60,195,'Workspace · 개인 작업',FONT["group"],True,'#FFFFFF');text(780,194,'Tag · agent-observatory / agent-wiki',FONT["body"],True,'#FFFFFF')
rows=[
 (5,240,LAYER_NAMES['L5'],'조회 Skill · Wiki CLI','필요한 근거를 조회해 답변·작업','현재는 단일 VM을 유지하고 분리는 후속으로 검토한다.','app'),
 (4,420,LAYER_NAMES['L4'],'agent-wiki-api','시작 Context · 키워드·별칭 검색','VM 선택 이유 → 지식 A의 첫 번째 개정 · 근거: 원문 A의 1행','app'),
 (3,600,LAYER_NAMES['L3'],'agent-wiki-db','Memory · Article · Glossary','지식 A · 첫 번째 개정: 단일 VM 결정 / 사용자 결정 · 검토 미완료','data'),
 (2,780,LAYER_NAMES['L2'],'agent-wiki-worker','텍스트 청킹 → 주장·근거 추출 → 비교·검증·반영','청크별 처리 범위 · 이미지 분석 생략 · 모델·지침 버전 기록','ingest'),
 (1,960,LAYER_NAMES['L1'],'agent-wiki-collector','증분 직접 업로드 → 서버 검증·중복 판정 → 불변 L1 등록','원문 A · 첫 번째 개정 · 1행: “지금은 단일 VM으로 운영하자.”','ops')]
for n,y,name,who,title,example,role in rows:
 component(40,y,1480,145,role)
 box(40,y,82,145,'#344256','#344256');text(56,y+84,f'L{n}',FONT["layer"],True,'#FFFFFF')
 icon({1:'tabler-cloud-upload',2:'tabler-cpu',3:'tabler-book-2',4:'tabler-clipboard-check',5:'tabler-terminal-2'}[n],146,y+20,26)
 text(184,y+43,name,FONT["component"],True);text(146,y+82,who,FONT["body"])
 a(f'<path d="M430 {y+20} V{y+125}" stroke="#929EAD"/>')
 if n==5:
  card(456,y+16,630,114,'Codex · Claude Code',['설치된 지침을 참고해 필요할 때 조회·답변'],'app','tabler-terminal-2')
  component(800,y+30,266,34,'ai');icon('tabler-clipboard-check',810,y+36,22)
  text(840,y+54,'agent-wiki · 조회 Skill',FONT["label"],True)
  path(f'M1086 {y+77} H1136',flow='query',both=True)
  card(1136,y+16,354,114,'agent-wiki-cli',['검색 실행 · 근거 반환'],'app','tabler-terminal-2')
 else:
  text(456,y+43,title,FONT["component"],True);text(456,y+91,example,FONT["body"])
 if n==4:
  path(f'M80 {y} V{y-35}',flow='query',both=True)
  text(146,y-12,'조회 요청 / 근거 반환',FONT["label"],True,FLOW_COLORS['query'])
 elif n<5:path(f'M80 {y} V{y-35}',flow='ingest' if n<=2 else 'query')
end('docs/assets/wiki-layers.svg')

canvas(1560,1130,'리니지 · 실제 원문에서 현재 결정까지','합성 예시. 원문 보관본과 기존 지식의 고정 개정이 원격 Worker 정제 실행의 입력이다. 결과 지식의 주장마다 정확한 근거 구간을 연결하고 고정 개정 Context를 반환한다. 관련 문서 링크는 근거와 구분한다.')
legend(1140,43,'정제·반영','ingest');legend(1140,78,'조회·활용','query');legend(1140,113,'근거 참조','relation')
group(40,190,430,380);text(62,226,layer_label(1),FONT["group"],True,'#FFFFFF')
card(72,284,366,118,'원문 A · 첫 번째 개정',['1행 · “단일 VM으로 운영하자.”'],'data')
card(72,426,366,112,'지식 A · 첫 번째 개정',['현재 구성 · 미완료 작업'],'data')
group(540,190,430,380);text(562,226,layer_label(2),FONT["group"],True,'#FFFFFF')
card(572,284,366,254,'정제·반영 기록',['입력: 원문 A · 지식 A의 첫 개정','텍스트 청크·주장별 근거 선택','처리 범위 · 모델·지침 버전','새 결과: 지식 A의 두 번째 개정'],'ingest')
path('M470 380 H540',flow='ingest')
group(1040,190,480,380);text(1062,226,layer_label(3),FONT["group"],True,'#FFFFFF')
card(1072,284,416,254,'지식 A · 두 번째 개정',['주장: 단일 VM 운영','유형: 사용자 결정','작성: 원격 AI / 확인: 미완료','근거: 원문 A · 첫 번째 개정 · 1행'],'data')
path('M970 380 H1040',flow='ingest')
# Evidence returns under the three cards, independently from processing flow.
path('M1270 570 V632 H250 V570',flow='relation');text(550,618,'주장별 근거 · 보관본 개정·구간을 고정',FONT["label"],True,FLOW_COLORS['relation'])
card(1040,750,480,210,'Context · 고정 개정 인용',['“왜 VM으로 시작했지?”','지식 A의 두 번째 개정','근거: 원문 A · 첫 번째 개정 · 1행','조회 시점 · 대체·미확인 상태'],'app')
path('M1340 570 V750',flow='query')
card(540,750,430,210,'작업 에이전트 · 조회 Skill',['조회 Skill의 판단 지침 적용','필요한 지식·원문만 단계적 조회','고정 개정을 인용해 답변·작업'],'app','tabler-terminal-2')
path('M1040 855 H970',flow='query')
card(40,750,430,210,'agent-wiki-web',['웹 · 인용된 원문 구간·과거 개정','작성 주체와 확인 상태 구분','관련 문서 링크 ≠ 근거'],'web','user')
text(40,1040,'agent-wiki-collector가 원문을 보관하고 agent-wiki-worker가 정제한다. 사용자 조회는 agent-wiki-cli로 실행한다.',FONT["body"])
text(40,1080,'원문과 과거 개정·정제 기록은 덮어쓰지 않는다.',FONT["body"])
end('docs/assets/wiki-lineage.svg')

canvas(1560,1210,'운영 · 사용자 작업과 백그라운드 처리 분리','목표 운영 구성. 기존 VM과 볼륨, 도메인, 인증서, OAuth, 비용과 오류 모니터링을 재사용한다. CLI 반영의 멱등성과 API 정상 종료를 검증한다. 앱이 Slack을 직접 호출하지 않는다.')
rows=[(190,'01','인프라',[
 ('terraform','Terraform / HCL','기존 VM · 볼륨 · 버킷 유지','추가 자원·사양 변경 없음'),('ubuntu','cloud-init / systemd','Docker·마운트 · 부팅 시 기동','OS·Docker 업데이트 직접 관리'),('docker','Docker Compose','Caddy · Web · API · PostgreSQL','원격 정제 Worker · 별도 실행')]),
 (385,'02','앱 배포',[
 ('github','외부 ARM64 빌드','GHCR 게시 → VM 미리 pull','새 구조 검증 후 일괄 교체'),('tabler-terminal-2','외부 차단 → 정상 종료','진행 요청·정제 작업 마무리','미완료 정제는 재시도'),('tabler-clipboard-check','기동·반영·조회 확인','DB·Caddy 유지 · 짧은 중단','쓰기 결과는 멱등 키로 확인')]),
 (580,'03','오류 로그',[
 ('ubuntu','stdout → OCI Logging','Docker syslog · rsyslog','OCI 기성 호스트 에이전트'),('oracle','OCI Monitoring 경보','Connector Hub · ERROR 이상 집계','5분 구간 감지 · 수집 대기 5분'),('tabler-bell','Notifications → Slack','한국어 제목·본문 · 로그 링크','상태 변경 시 알림 · 반복 없음')]),
 (775,'04','비용·사용량',[
 ('oracle','OCI Usage API','비용·CPU·메모리·저장소','미집계와 0을 구분'),('github','Actions · 6시간마다','비용 발생·한도 접근·사용 급증','09:13 한국 시각 정기 요약'),('tabler-bell','Slack Webhook','누적·일 사용량·전일 비교','기존 모니터링 경로 유지')]),
 (970,'05','별도 수집',[
 ('tabler-cloud-upload','agent-wiki-collector','허가 후 zstd 증분 직접 업로드','기기별 위치 · 실패 시 재시도'),('tabler-clipboard-check','agent-wiki-api','세션 ID·내용으로 중복 판정','원문 확정 뒤 연속 수신 위치 갱신'),('tabler-terminal-2','agent-wiki-worker','최대 20 RPM · 동시 실행 1개','최소 2분 재시도 · 이력 보존')])]
for y,n,label,items in rows:
 text(40,y+32,n,FONT["component"],True);text(40,y+73,label,FONT["component"],True)
 for i,(ico,title,b,c) in enumerate(items):
  x=225+i*438
  card(x,y,388,150,title,[b,c],'ops' if n in ['01','04'] else 'app',ico)
  if i<2:path(f'M{x+388} {y+75} H{x+432}')
end('docs/assets/wiki-operations.svg')

# Curation is a logical algorithm inside the existing worker, not new services.
canvas(1680,1120,'증분 + 맥락 → 다음 기억','새 증분을 세션 순서로 복원하고 저장 경계를 넘어 청킹한다. 직전 세션 맥락과 검색·재정렬한 기존 주장을 입력에 포함한다. 불명확하면 과거 근거를 제한 조회하고, 검증 후 지식·관계·맥락·처리 위치를 함께 저장한다.')
legend(1120,55,'정제·반영','ingest');legend(1400,55,'참고 조회','query')
text(40,207,'작업 대화와 독립된 백그라운드 실행',FONT['component'],True)
text(40,245,'전체를 다시 읽지 않고 필요한 맥락만 연결',FONT['body'])
card(696,185,288,170,'이전 세션 맥락',['현재 결정 · 미해결 질문','직전 대화 · 근거 위치','요약은 사실 근거가 아님'],'ops','tabler-clipboard-check')
card(1024,185,288,170,layer_label(3),['검색 → 재정렬 → 선택','관련 주장 본문 · Version','대체·충돌 관계 · 근거'],'data','postgresql')
path('M840 355 V398',flow='query');path('M1168 355 V398',flow='query')
group(348,400,1292,295)
text(372,436,'agent-wiki-worker · '+layer_label(2),FONT['group'],True,'#FFFFFF')
card(40,468,288,188,layer_label(1),['새로 확정된 증분','텍스트 · 이벤트 위치','이미지는 보관만'],'data','oracle')
card(368,468,288,188,'세션 순서 · 청킹',['저장 조각을 이어 읽기','요청·도구 결과 연결','입력 예산에 맞춰 분할'],'ingest','tabler-cpu')
card(696,468,288,188,'입력 조립',['새 청크 + 세션 맥락','본문과 참고 범위 분리','참고 지식 · 근거 예산'],'ingest','tabler-book-2')
card(1024,468,288,188,'주장 추출 · 비교',['AI Provider · 텍스트 호출','추가 · 정정 · 취소','불명확하면 보강 요청'],'ai','openai')
card(1352,468,268,188,'검증',['원문 인용 · 변경 범위','기준 Version · 관계','해석 불명확 → 보류'],'ingest','tabler-clipboard-check')
for x in [328,656,984,1312]:path(f'M{x} 560 H{x+40}',flow='ingest')
# Optional history lookup uses a dedicated lower lane.
path('M1168 656 V748 H330 V820',flow='query',both=True)
text(600,735,'불명확할 때만 · 범위와 호출 횟수 제한',FONT['label'],True,FLOW_COLORS['query'])
card(40,820,580,190,'필요한 과거 원문',['“그거”가 가리키는 이전 발언·도구 결과','고정 원문 구간으로 확인 · 전체 재전송 없음','보강해도 판단 불가 → 근거와 함께 보류'],'data','tabler-book-2')
path('M1490 656 V820',flow='ingest')
group(696,820,944,190)
text(720,856,'agent-wiki-db · 한 트랜잭션으로 확정',FONT['group'],True,'#FFFFFF')
card(716,890,280,96,layer_label(3),['새 주장 · 변경 관계 추가'],'data','postgresql')
card(1018,890,290,96,'다음 세션 맥락',['결정 참조 · 미해결 항목'],'ops','tabler-clipboard-check')
card(1330,890,290,96,'다음 처리 위치',['성공 범위 · 실행 기록'],'ops','tabler-clipboard-check')
text(716,1058,'다음 증분은 저장한 맥락·처리 위치에서 재개',FONT['component'],True)
end('docs/assets/wiki-curation.svg')

canvas(1680,1340,'결정은 바뀌어도 근거와 이력은 남는다','같은 세션의 A에서 B로의 변경. L1은 양쪽 원문을 보존한다. L2는 명시적인 변경·검토 의견·범위 차이·미해결 충돌·늦은 수집을 구분한다. L3는 주장 단위 과거·현재 상태와 근거를 저장하며 L4는 현재 결정·변경 이유·충돌을 구분해 조회한다. 현재 결정은 검증된 사실과 다르다.')
legend(960,80,'정제·반영','ingest');legend(1210,80,'대체 관계','relation');legend(1450,80,'조회','query')
card(40,185,680,142,'이전 증분 · '+layer_label(1),['“운영 DB는 Supabase로 하자.”','주장 A의 원문 · 불변 보존'],'data','tabler-book-2')
card(960,185,680,142,'새 증분 · '+layer_label(1),['“A는 취소하고 OCI PostgreSQL로 가자.”','주장 B의 원문 · 변경 근거'],'data','tabler-book-2')
path('M380 327 V375',flow='ingest');path('M1300 327 V375',flow='ingest')
group(40,375,1600,222)
text(64,411,layer_label(2)+' · 같은 대상·범위에서 변경 의도 판단',FONT['group'],True,'#FFFFFF')
cases=[('명시적인 변경',['A 취소 → B 채택','A를 대체할 근거 연결'],'ingest'),('검토 의견',['“B도 괜찮을까?”','A 유지 · 제안으로 보존'],'ops'),('적용 범위가 다름',['로컬 A · 운영 B','각 범위에서 둘 다 유지'],'data'),('결론이 불명확',['서로 상반된 주장','충돌·미해결로 보존'],'ai'),('늦게 수집된 발언',['과거 발언이 뒤에 도착','수신 순서로 덮어쓰지 않음'],'ops')]
for i,(title,lines,role) in enumerate(cases):card(64+i*314,455,290,118,title,lines,role)
path('M840 597 V645',flow='ingest')
group(40,645,1600,222)
text(64,681,layer_label(3)+' · 주장별 상태·관계·근거 보존',FONT['group'],True,'#FFFFFF')
card(64,725,510,118,'주장 A · 대체됨',['운영 DB = Supabase','이전 주장·원문은 이력으로 유지'],'ops','postgresql')
card(1106,725,510,118,'주장 B · 현재 채택',['운영 DB = OCI PostgreSQL','사용자 결정 · 설치 검증과 별개'],'data','postgresql')
path('M1106 786 H574',flow='relation')
text(714,767,'B가 A를 대체 · supersedes',FONT['component'],True,FLOW_COLORS['relation'])
text(716,820,'변경된 주장만 · 정정 원문 연결',FONT['body'])
path('M840 867 V915',flow='query')
group(40,915,1600,222)
text(64,951,layer_label(4)+' · 질문에 맞는 상태와 근거 반환',FONT['group'],True,'#FFFFFF')
card(64,995,490,118,'지금 무엇을 쓰지?',['현재 결정 B + 적용 범위','대체된 A는 현재로 반환하지 않음'],'app','tabler-book-2')
card(586,995,490,118,'왜 바꿨지?',['A → 변경 근거 → B','과거 결정과 정정 이유를 함께 조회'],'app','tabler-book-2')
card(1108,995,508,118,'아직 결정이 안 났다면?',['충돌하는 주장 + 각 근거','임의로 한쪽을 선택하지 않음'],'app','tabler-book-2')
text(40,1195,'현재 채택 ≠ 사실 검증     ·     사용자 결정 / 도구 관찰 / AI 해석을 구분',FONT['component'],True)
text(40,1235,'발언 시각 · 실제 적용 시점 · 서버 수집 시각을 구분하고 모르는 적용 시점은 추정하지 않는다.',FONT['body'])
text(40,1275,'임베딩·리랭커는 후보 검색·정렬     ·     유효성은 상태·범위·대체 관계로 판정',FONT['body'])
end('docs/assets/wiki-decision-history.svg')

canvas(1680,880,'청킹·맥락·리랭킹은 하나씩 비교','같은 평가 자료와 모델 예산을 고정해 고정 분할, 구조 청킹, 세션 맥락, 규칙 재정렬, 모델 리랭커를 순차 비교한다. 정정·근거 정확도와 비용을 측정한다. 후보 검색에서 빠진 자료는 리랭커만으로 복구할 수 없다.')
box(40,180,1600,68,'#344256','#344256')
text(64,222,'같은 평가 자료 · 같은 모델·입출력 한도 · 한 번에 한 요소만 변경',FONT['group'],True,'#FFFFFF')
items=[('기준선',['고정 크기로 분할','키워드 검색 결과 사용'],'ops'),('대화 구조 청킹',['요청·도구 관계로 묶기','나머지는 기준선과 동일'],'ingest'),('세션 맥락 추가',['직전 결정·미해결 연결','이전 증분의 근거 참조'],'ingest'),('규칙 재정렬 추가',['대상·범위·명시 참조','본문 관련도 · 관계 확인'],'app'),('모델 리랭커 비교',['질문·후보 본문 쌍 평가','효과·지연·호출량 비교'],'ai')]
for i,(title,lines,role) in enumerate(items):
 x=40+i*328;card(x,320,288,160,title,lines,role)
 if i<4:path(f'M{x+288} 400 H{x+328}',flow='ingest')
path('M840 480 V545',flow='ingest')
group(40,545,1600,240)
text(64,581,'선택 기준 · 예쁜 요약보다 올바른 결정과 근거',FONT['group'],True,'#FFFFFF')
card(64,620,490,136,'검색 후보에 근거가 없음',['후보 검색 · 별칭·분류 개선','후속: 임베딩·혼합 검색 평가'],'app','tabler-book-2')
card(575,620,490,136,'후보는 있지만 뒤로 밀림',['재정렬·리랭커 비교','검색 적합도 ≠ 사실의 진실성'],'app','tabler-clipboard-check')
card(1086,620,530,136,'대상이 끊기거나 오대체됨',['청킹 · 맥락 · 관계 규칙 개선','결정 누락·오대체·근거·비용 측정'],'ingest','tabler-cpu')
end('docs/assets/wiki-curation-evaluation.svg')

canvas(1560,760,'원문은 그대로 · 기억은 다시 만들기','L1과 수집 위치는 유지한다. 정제를 중지하고 실행 세대를 바꿔 기존 실행의 쓰기를 막는다. 재생성할 L1 범위를 고정하고 L2·L3의 파생 상태를 초기화한 뒤 같은 정제 알고리즘으로 다시 처리한다. 새로 수집한 증분은 고정 범위 뒤에 처리한다.')
legend(1250,78,'재생성 흐름','ingest')
items=[('정제 중지',['진행 작업 종료 확인','이전 실행의 반영 차단'],'ops'),('입력 범위 고정',['불변 L1 · 원문 ID 유지','원래 순서·근거로 재생'],'data'),('파생 상태 초기화',['L2 · L3 · 세션 맥락','정제 위치 · 조회 캐시'],'ingest'),('새 실행으로 재정제',['알고리즘·모델 설정 고정','같은 증분 흐름으로 처리'],'ingest')]
for i,(title,lines,role) in enumerate(items):
 x=40+i*380;card(x,240,340,170,title,lines,role)
 if i<3:path(f'M{x+340} 325 H{x+380}',flow='ingest')
group(40,495,1480,180)
text(64,531,'유지하는 것',FONT['group'],True,'#FFFFFF')
card(64,568,450,82,layer_label(1),[],'data','oracle')
card(537,568,450,82,'Collector 수신 위치',[],'ops','tabler-cloud-upload')
card(1010,568,486,82,'Workspace · 로그인 · AI 설정',[],'ops','tabler-clipboard-check')
text(40,722,'초기 범위는 Workspace 전체 · 새 증분은 계속 보관하고 재생성 범위 뒤에 처리',FONT['body'])
end('docs/assets/wiki-curation-rebuild.svg')
