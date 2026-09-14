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
# design=True marks a part that is designed but not implemented: same fill, dashed border.
DESIGN_DASH=' stroke-dasharray="10 6" stroke-width="2.5"'
def box(x,y,w,h,f='#FFFFFF',st='#CDD9E7',design=False):a(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{f}" stroke="{st}"'+(DESIGN_DASH if design else '')+'/>')
# Neutral enclosing regions; role colors belong to individual components.
PALETTE={
 'app':('#DBEAFE','#7EA6D8'), 'ingest':('#FDE7C2','#C89A55'),
 'data':('#D4EDE4','#74AA98'), 'ai':('#EBDFFA','#AA8ACA'),
 'ops':('#E3E7ED','#929EAD'), 'web':('#FFFFFF','#929EAD'),
}
def component(x,y,w,h,role,design=False):box(x,y,w,h,*PALETTE[role],design=design)
def group(x,y,w,h,design=False):
 a(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="#F1F2F4" stroke="#596679" stroke-width="2.5"'+(' stroke-dasharray="10 6"' if design else '')+'/>')
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
def legend_design(x,y,label):
 box(x,y-11,48,22,'#FFFFFF','#596679',design=True);text(x+62,y+6,label,FONT["label"],True,'#596679')
def icon(n,x,y,z=28):
 s=Path('docs/assets/icons/'+n+'.svg').read_text();ids=re.findall(r'id="([^"]+)"',s);prefix=f'{n}-{x}-{y}-'
 for i in ids:s=s.replace(f'id="{i}"',f'id="{prefix+i}"').replace(f'url(#{i})',f'url(#{prefix+i})')
 r=ET.fromstring(s);r.attrib.update({'x':str(x),'y':str(y),'width':str(z),'height':str(z),'color':'#172C4B'})
 if not r.get('fill'):r.set('fill','#172C4B')
 a(ET.tostring(r,encoding='unicode'))
def start(h,title,desc):a(f'''<svg xmlns="http://www.w3.org/2000/svg" width="1560" height="{h}" viewBox="0 0 1560 {h}" role="img" aria-labelledby="title desc"><title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4.5 L1 8" fill="none" stroke="#59769B" stroke-width="1.8"/></marker></defs><g font-family="Noto Sans KR, sans-serif"><rect width="1560" height="{h}" fill="#FFFFFF"/>''')
def end(file):
 a('</g></svg>');Path(file).write_text(('\n'.join(p)+'\n').replace('</defs>',flow_markers()+'</defs>',1))
# Three sheets: the architecture (deployment topology), L1-L3 curation, L4-L5 query.
# All describe the target, not deployment completion. Dashed borders mark designed-only parts.
def canvas(w,h,title,desc):
 global p
 p=[]
 a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc><defs></defs><g font-family="Noto Sans KR, sans-serif"><rect width="{w}" height="{h}" fill="#FFFFFF"/>')
 text(40,42,'AGENT WIKI / ARCHITECTURE',FONT["label"],True,'#526A86')
 text(40,98,title,FONT["diagram"],True)
 a(f'<path d="M40 137 H{w-40}" stroke="#172C4B" stroke-width="2"/>')
def card(x,y,w,h,title,lines,role='app',ico=None,highlight=False,design=False):
 if ico is None:
  ico={'app':'tabler-book-2','ingest':'tabler-cpu','data':'tabler-book-2','ai':'tabler-cloud','ops':'tabler-clipboard-check','web':'tabler-world'}[role]
 component(x,y,w,h,role,design)
 if highlight:
  a(f'<path d="M{x+6} {y} H{x+w-6} Q{x+w} {y} {x+w} {y+6} V{y+54} H{x} V{y+6} Q{x} {y} {x+6} {y}" fill="#344256"/>')
 text(x+20,y+(36 if highlight else 42),title,FONT['component'],True,'#FFFFFF' if highlight else '#172C4B')
 if lines:
  if ico:icon(ico,x+20,y+60,24)
  for i,line in enumerate(lines):text(x+(54 if i==0 and ico else 20),y+80+i*31,line,FONT['body'])
 elif ico:
  # Icon-only metadata row is unnecessary for a title-only card.
  icon(ico,x+w-44,y+20,24)


canvas(1920,1400,'아키텍처 · 단일 VM · K3s','OCI A1 VM 하나에서 K3s server와 containerd가 앱을 관리한다. Traefik이 HTTPS 요청을 Service로 전달하고 cert-manager가 TLS Secret을 관리한다. PostgreSQL은 PVC와 local PV를 통해 기존 Block Volume을 사용한다. Collector는 압축 증분을 Object Storage에 직접 올리고, Worker가 그 원문을 검증·등록하고 텍스트를 읽어 정제한다. L1부터 L5까지의 책임은 유지한다.')
legend(1110,87,'수집·지식 반영','ingest');legend(1370,87,'조회·응답','query');legend(1600,87,'설정·인증·저장','ops',True)
a('<g transform="translate(0,-250)">')
card(1640,410,240,120,'DuckDNS · 도메인',['VM 공인 주소 연결','agent-wiki.duckdns.org'],'web','tabler-world')
card(1640,550,240,160,'agent-wiki-data',['Block Volume · 50GB','VM 마운트 · DB·K3s 상태','부트 볼륨 50GB 별도'],'data','oracle')
group(40,430,430,990);text(64,466,'사용자 기기',FONT['group'],True,'#FFFFFF')
group(590,430,1010,1140);icon('oracle',614,443,32)
text(660,466,'agent-wiki-vm · A1 · 2 OCPU / 12GB',FONT['group'],True,'#FFFFFF')
icon('kubernetes',1180,443,32)
text(1224,466,'K3s',FONT['group'],True,'#FFFFFF')

# Request lanes: clients reach Traefik, which routes to internal Services.
path('M1640 515 H755 V550',True);text(930,504,'DNS 연결 · VM 공인 주소',FONT['label'])
path('M438 610 H640',flow='query',both=True)
path('M890 610 H940',flow='query',both=True)
path('M418 1105 H500 V985 H640',flow='query',both=True)
path('M890 985 H940',flow='query',both=True)
path('M1080 680 V820',flow='query',both=True);text(1098,757,'Service',FONT['label'],True,FLOW_COLORS['query'])
path('M1220 905 H1280',flow='query',both=True)
path('M1220 985 H1280',flow='ingest')
path('M418 1240 H520 V1035 H640',flow='ingest',both=True)
text(531,1130,'수집 제어',FONT['label'],True,FLOW_COLORS['ingest'])
path('M890 1035 H940',flow='ingest',both=True)

card(72,550,366,130,'브라우저',['agent-wiki-web · 읽기 전용','지식·근거·처리 상태 조회'],'web','user')
card(72,750,366,150,'Codex · Claude Code',['작업 에이전트'],'app','tabler-terminal-2')
component(92,842,326,36,'ai');icon('tabler-clipboard-check',103,849,22)
text(134,867,'agent-wiki · 설치된 사용 Skill',FONT['label'],True)
path('M438 820 H455 V1055 H418',flow='query',both=True)
group(72,955,366,430);text(92,993,'agent-wiki-client',FONT['group'],True,'#FFFFFF')
card(92,1025,326,110,'agent-wiki-cli',['조회 · 검토 · 설정 · 제어'],'app','tabler-terminal-2')
card(92,1175,326,150,'agent-wiki-collector',['독립된 백그라운드 수집','선별 · 마스킹 · zstd','기본 10분 · 프로젝트 선택'],'ingest','tabler-cloud-upload')

card(640,550,250,530,'agent-wiki-gateway',['Traefik','Reverse Proxy','외부 TCP 80 / 443','Ingress · 경로 분기'],'app','tabler-world')
text(660,817,'/ → agent-wiki-web',FONT['body'])
text(660,861,'/api → agent-wiki-api',FONT['body'])
card(940,550,280,130,'agent-wiki-web',['Next.js · 내부 3000','Deployment + Service'],'web','nextdotjs')
card(940,820,280,260,'agent-wiki-api',['Fastify · 내부 3001','Deployment + Service','수집 허가 · 수신 검증 조율','검색·지식·설정·검토','수집·조회 HTTP API'],'app','fastify')
card(1280,820,280,210,'agent-wiki-db',['PostgreSQL · 내부 5432','StatefulSet + Service','지식·근거·변경 관계','관리 접속 · 외부 5432'],'data','postgresql')

# The disk is attached to the VM. PVC/PV binds its mounted PostgreSQL path.
path('M1640 625 H1560',True)
card(1280,550,280,150,'agent-wiki-db-data',['PVC → local PV','Block Volume의 DB 경로','Retain · 노드 고정'],'data','tabler-book-2')
path('M1420 820 V700',True);text(1438,764,'데이터 읽기·쓰기',FONT['label'])

# API issues upload grants; collector bytes bypass the VM. Worker verifies the staged
# upload, writes the immutable L1 object and later reads its text for chunking.
path('M1220 1060 H1640',True,both=True);text(1310,1090,'업로드 허가 · PAR 발급',FONT['label'])
card(1640,890,240,190,'agent-wiki-sources',['OCI Object Storage','불변 L1 · 압축 보관','텍스트·이미지 분리'],'data','oracle')
path('M418 1300 H480 V1600 H1900 V1000 H1880',flow='ingest')
text(650,1630,'압축 증분 직접 업로드 · 본문은 VM을 통과하지 않음',FONT['label'],True,FLOW_COLORS['ingest'])

# Worker executes domain code and accesses DB and Object Storage directly.
path('M1220 1170 H1250 V1010 H1280',flow='ingest',both=True)
card(940,1140,280,250,'agent-wiki-worker',['Deployment · 원격 정제','수신 검증 · 불변 L1 등록','텍스트 청킹·주장 추출','기존 지식 비교·관계 연결','BYOK · RPM·동시성 제어','수신 포트 없음'],'ingest','tabler-cpu')
path('M1700 1080 V1120 H1600 V1210 H1220',flow='ingest',both=True)
text(1300,1202,'원문 검증·등록 · 텍스트 읽기',FONT['label'],True,FLOW_COLORS['ingest'])
path('M1220 1250 H1640',flow='ingest',both=True)
text(1300,1277,'텍스트·정제 결과',FONT['label'],True,FLOW_COLORS['ingest'])
card(1640,1200,240,100,'AI Provider',[],'ai','openai')

# cert-manager sits under the gateway so the TLS Secret hand-off is one short line.
card(640,1140,250,170,'cert-manager',['인증서 발급·자동 갱신','Webhook · 내부 443','ACME · 외부 443'],'ops','tabler-clipboard-check')
path('M765 1140 V1080',True);text(780,1115,'TLS Secret',FONT['label'])
card(1640,1320,240,130,'인증서 발급 기관',['ACME · Let’s Encrypt','도메인 소유 확인'],'ops','letsencrypt')
path('M765 1310 V1420 H1600 V1385 H1640',True,both=True)

# Control plane is shown off the application request path as one strip.
card(640,1450,920,100,'K3s 제어·실행',['API Server 6443 · kubelet 10250 · Scheduler 10259 · containerd 로컬 · 관리 포트 외부 비공개'],'ops','kubernetes')
for right,by,n,width in [(424,734,5,150),(404,1159,1,170),(1206,1124,2,152),(1546,804,3,172),(1206,804,4,132),(1866,874,1,170)]:
 bx=right-width
 box(bx,by,width,32,'#344256','#344256');text(bx+12,by+23,layer_label(n),FONT['label'],True,'#FFFFFF')
a('</g>')
end('docs/assets/wiki-architecture.svg')

# Sheet 2 of 3: L1 -> L3 curation. One throughline, top to bottom: 01 raw increments through the
# existing per-chunk extraction (summarised), 02 the claim pile that extraction leaves in L3 (two
# current claims in one subject/scope, a proposed claim, a deferred relation), 03 the Consolidation
# Job whose four steps decide current-vs-history relations (design only), 04 the Wiki Page Version
# that results: a list of current claims, the lineage panel for one claim, and review with relation
# reject. Dashed borders mark parts that are designed but not implemented.
canvas(1760,2450,'L1 → L3 · 지식 정제 · 추출과 통합','L1부터 L3까지 한 장. 01 세션 증분을 Worker가 청킹·입력 조립·AI 추출·서버 검증·반영으로 정제한다. L3 현재 주장의 BM25 후보를 입력 조립에 되돌리고 출력 오류는 같은 청크를 다시 보낸다. 관계만 실패한 반영은 주장을 반영하고 관계를 통합 대기함에 넘긴다. 02 통합 전 L3에는 같은 subject·scope에 current 주장 A·B가 함께 남고 제안 D와 대기함의 관계가 있다. 03 Consolidation Job이 gather → model → validate → publish 네 Step으로 관계만 판단해 자동 반영한다. Step별 상태를 따로 기록하고 실패한 Step부터 재시도한다. 04 Wiki Page 새 Version은 현재 주장만 나열하고, 클릭한 주장의 리니지 패널이 B가 A를 대체한 관계와 이유를 보여준다. 검토의 relation reject는 정정 Version을 발행하고 거절을 기억해 재제안을 막는다. Consolidation·리니지 패널·relation reject는 설계이며 미구현이다. NVIDIA → Alibaba 예시는 합성이다.')
legend(1100,80,'정제·반영','ingest');legend(1290,80,'지연·재시도','ingest',True);legend(1500,80,'조회·읽기','query')
legend(1100,112,'대체 관계','relation');legend(1290,112,'기록·기준','ops',True);legend_design(1500,112,'설계 · 미구현')
def section(y,label):text(40,y,label,FONT['group'],True)

section(182,'01 · '+layer_label(1)+' → '+layer_label(2)+' · 청크 추출 · 기존 구현의 요약')
card(40,210,600,160,'L1 · 세션 증분 · 고정 처리 범위',['Codex 09:00 “정제 Provider는 NVIDIA로 하자.”','Claude 10:00 “호출 지연 때문에 Alibaba로 바꾸자.”','불변 원문 · 텍스트만 정제 · 합성 예시'],'data','tabler-book-2')
path('M340 370 V430',flow='ingest')
group(40,430,1680,560)
text(64,466,'agent-wiki-worker · '+layer_label(2)+' · 청크당 모델 호출 1회 · 같은 세션은 순차',FONT['group'],True,'#FFFFFF')
cols=[64,390,716,1042,1368]
pipeline=[('청킹',['요청·도구 묶음 경계 우선','예산 초과는 재귀 분할'],'ingest','tabler-cpu'),('입력 조립',['새 청크 + 세션 맥락','+ 기존 주장 최대 6개'],'ingest','tabler-book-2'),('AI · 추출·관계 판단',['주장 · 근거 recordId','supersedes · retracts · …'],'ai','openai'),('서버 검증',['인용 · 범위 · 권한 · Version','순환 · 출발 상태 검사'],'ingest','tabler-clipboard-check'),('반영 · publish',['주장·근거·관계 한 트랜잭션','바뀐 주제 페이지 새 Version'],'data','postgresql')]
for i,(title,lines,role,ico) in enumerate(pipeline):
 card(cols[i],510,290,170,title,lines,role,ico)
 if i<4:path(f'M{cols[i]+290} 595 H{cols[i+1]}',flow='ingest')
# Reference loop: selected L3 candidates come back into input assembly; L3 itself is read from band 02.
card(390,760,290,170,'L3 참고 · 후보',['BM25 후보 24 → 규칙 재정렬','대상·범위·별칭 가중 · 최대 6개','유사도 ≠ 동일 주장'],'app','tabler-book-2')
path('M535 760 V680',flow='query');text(550,728,'선택 후보',FONT['label'],True,FLOW_COLORS['query'])
path('M535 1060 V930',flow='query');text(550,1030,'Workspace 현재 주장 읽기',FONT['label'],True,FLOW_COLORS['query'])
# Output errors re-send the same chunk (dashed ingest). Only this loop calls the model again.
card(1042,760,290,170,'Retry · 출력 오류만',['같은 청크 새 응답 · 캐시 비움','3회 연속 → 확인 필요','성공 청크·처리 위치 유지'],'ops','tabler-clipboard-check')
path('M1187 680 V722 H861 V680',True,flow='ingest');text(1200,712,'검증 실패 → 새 응답',FONT['label'],True,FLOW_COLORS['ingest'])
# Verified claims (and relations that pass) go to L3. A relation-only failure keeps the claims and
# defers just that relation to the topic's consolidation inbox.
path('M1390 680 V1060',flow='ingest');text(1406,1030,'검증된 주장·관계 → L3',FONT['label'],True,FLOW_COLORS['ingest'])
path('M1600 680 V1060',True,flow='ingest');text(1616,900,'관계만 지연',FONT['label'],True,FLOW_COLORS['ingest'])

group(40,1060,1680,330)
text(64,1096,'02 · '+layer_label(3)+' · 통합 전 · 같은 subject·scope에 current가 둘 남아 있다',FONT['group'],True,'#FFFFFF')
card(64,1130,270,130,'Claim D · proposed',['“Qwen도 괜찮을까?”','검토 의견 · 미해결'],'ops','tabler-clipboard-check')
card(364,1130,270,130,'Claim C · current',['API 동시 실행 = 5','concurrency · 별도 묶음'],'data','tabler-book-2')
text(64,1310,'상태는 원래 state와 관계로 계산 · 관계가 없으면 이력도 없다',FONT['label'])
box(700,1130,700,200,'#FFFFFF','#929EAD')
text(720,1160,'subject ai-provider · scope curation · current 2개 → 통합 대상',FONT['label'],True)
card(720,1180,320,130,'Claim A · current',['정제 Provider = NVIDIA','사용자 결정 · 09:00 근거'],'data','tabler-book-2')
card(1060,1180,320,130,'Claim B · current',['정제 Provider = Alibaba','사용자 결정 · 이유: 호출 지연'],'data','tabler-book-2')
card(1430,1130,266,190,'통합 대기함 · 지연된 관계',['B supersedes A · 409','대상 Version 변경 (409)','주장은 반영 · 관계만 대기','폐기 없음 · 사람 대기 없음'],'ingest','tabler-cloud-upload',design=True)
# Both inputs land above the gather step.
path('M520 1390 V1440',flow='ingest');text(410,1425,'통합 전 주장',FONT['label'],True,FLOW_COLORS['ingest'])
path('M1563 1320 V1410 H560 V1440',True,flow='ingest');text(1580,1370,'다음 통합 입력',FONT['label'],True,FLOW_COLORS['ingest'])

group(40,1440,1680,510,design=True)
text(64,1476,'03 · Consolidation Job · 주제별 1회 · 관계만 판단 · 새 주장 없음 · 설계 · 미구현',FONT['group'],True,'#FFFFFF')
card(64,1540,300,190,'트리거',['cycle 완료 → 주제마다 1회','대기함 관계가 있는 주제 포함','수동 · agent-wiki consolidate','열린 Job은 주제당 1개'],'ops','clock',design=True)
path('M364 1620 H404',flow='ingest')
steps=[('gather · 수집',['주제 주장 + 대기함 관계','(subject, scope) 묶음 · 상태별','거절 기억 제외 · 모델 호출 없음'],'ingest','tabler-cpu'),('model · 관계 판단',['BYOK 1회 · 새 주장 없음','supersedes · retracts · supports','contradicts · leave_unresolved'],'ai','openai'),('validate · 검증',['publish와 같은 규칙','범위 · 권한 · Version · 순환','위반은 코드와 함께 기록'],'ingest','tabler-clipboard-check'),('publish · 자동 반영',['관계 저장 · 자동 반영','같은 트랜잭션 · 페이지 새 Version','검토는 나중 · review queue'],'data','postgresql')]
xs=[404,734,1064,1394]
for i,(title,lines,role,ico) in enumerate(steps):
 card(xs[i],1540,300,190,title,lines,role,ico,design=True)
 if i<3:path(f'M{xs[i]+300} 1635 H{xs[i+1]}',flow='ingest')
text(404,1775,'Step마다 status · attempts · error · retryAt를 따로 기록 · 실패한 Step부터 재시도 · 앞 Step 결과 재사용',FONT['body'],True)
text(404,1805,'model 출력 오류 → 새 응답 · 3회 연속이면 확인 필요 · 일시 제공자 오류는 추출과 같은 키 대기',FONT['label'])
text(404,1833,'publish의 대상 Version 변경 → 같은 주장이면 현재 Version으로 재대상 · 아니면 gather부터 · Job 재시작 최대 3회',FONT['label'])
card(64,1790,300,130,'거절 관계 기억',['reject한 관계 저장','같은 관계 재제안 제외'],'ops','tabler-clipboard-check',design=True)
path('M364 1845 H384 V1660 H404',True,flow='ops')
# publish -> the page Version below; review's rejections -> the memory above (edge to edge).
path('M1544 1730 V1980 H846 V2010',flow='ingest');text(862,1972,'관계 반영 → 페이지 새 Version',FONT['label'],True,FLOW_COLORS['ingest'])
path('M214 2010 V1950',True,flow='ops');text(230,1988,'거절 저장',FONT['label'],True,FLOW_COLORS['ops'])

group(40,2010,1680,390)
text(64,2046,'04 · '+layer_label(3)+' · 통합 후 · Wiki Page 새 Version · Knowledge 화면과 검토',FONT['group'],True,'#FFFFFF')
card(64,2090,472,270,'검토 · review · relation reject',['review queue · diff → 새 관계 확인','relation reject → 정정 Version 발행','대상 주장을 관계 전 상태로 복원','거절 기억에 저장 → 재제안 제외','자동 반영 ≠ 검토 완료 · 승인은 사용자'],'ops','tabler-clipboard-check',design=True)
card(576,2090,540,270,'Knowledge 페이지 · 현재 주장만',['ai-provider · curation','↳ B · 정제 Provider = Alibaba → 클릭','concurrency · curation','↳ C · API 동시 실행 = 5','미해결 1 · 제안 D · 접힌 개수','통합 대기 배지 · Job이 열린 동안'],'web','tabler-world',design=True)
path('M1116 2225 H1156',flow='query');text(1118,2212,'클릭',FONT['label'],True,FLOW_COLORS['query'])
component(1156,2090,540,270,'data',design=True)
text(1176,2132,'리니지 패널 · B를 클릭',FONT['component'],True)
box(1176,2150,200,64,'#FFFFFF','#74AA98');text(1190,2176,'Claim B · current',FONT['label'],True);text(1190,2200,'정제 Provider = Alibaba',FONT['label'])
box(1476,2150,200,64,'#FFFFFF','#929EAD');text(1490,2176,'Claim A · superseded',FONT['label'],True);text(1490,2200,'정제 Provider = NVIDIA',FONT['label'])
path('M1376 2182 H1476',flow='relation');text(1384,2172,'supersedes',FONT['label'],True,FLOW_COLORS['relation'])
text(1176,2252,'변경 이유 · 호출 지연 · 근거 10:00 · Version 고정',FONT['body'])
text(1176,2283,'후속이 둘이면 둘 다 표시 · contradicts는 배지',FONT['body'])
text(1176,2314,'거절된 관계는 정정 Version과 함께 표시',FONT['body'])
text(1176,2342,'Decision History 마크다운 절은 그대로 유지',FONT['label'])
end('docs/assets/wiki-l1-l3-curation.svg')

# Sheet 3 of 3: L4 -> L5 query. Left column is the L5 side (question, agent, cited answer); the
# L4 group holds the three staged calls and the trace log; the L3 and L1 stores each step reads sit
# below the step that reads them. The question-purpose table stays in architecture.md.
canvas(1760,1020,'L4 → L5 · 조회 · 질문에서 인용 답변까지','L4·L5 한 장. 사용자의 질문을 받은 L5 작업 에이전트가 조회 Skill의 지침으로 핵심어와 목적을 정하고 agent-wiki-cli query로 L4에 요청한다. L4는 query search의 BM25 후보 → query claim의 고정 Version·상태·관계 → query source의 원문 구간을 같은 traceId로 반환하며 서버 AI 호출은 없다. claim은 L3 PostgreSQL을, source는 L1 Object Storage를 읽어 돌려주고 에이전트는 저장소를 직접 읽지 않는다. 조회 이력은 단계·반환량·지연·잘림만 30일 기록한다. 근거가 충분하면 L5가 고정 Version을 인용해 답한다.')
legend(1290,87,'조회·반환','query');legend(1480,87,'기록','ops',True)
card(40,200,380,150,'사용자 · 질문',['“왜 NVIDIA에서 Alibaba로 바꿨지?”','목적 · history · 변경 이유'],'web','')
path('M230 350 V410',flow='query',both=True)
card(40,410,380,270,layer_label(5)+' · 작업 에이전트',['Codex · Claude Code + 조회 Skill','핵심어 선택 · 목적 판단 · 단계 계획','근거 부족 → 검색어·깊이 바꿔 반복','충분하면 고정 Version으로 인용','미반영 / 없음 / 실패 / 잘림 구분'],'app','tabler-terminal-2')
path('M230 680 V740',flow='query');text(246,718,'근거 충분',FONT['label'],True,FLOW_COLORS['query'])
card(40,740,380,140,layer_label(5)+' · 인용 답변',['A → 변경 근거 → B · Version 고정','시간순·유사도로 이유를 만들지 않음'],'app','tabler-clipboard-check')
path('M420 440 H500',flow='query');text(432,430,'요청',FONT['label'],True,FLOW_COLORS['query'])
path('M500 490 H420',flow='query');text(432,514,'반환',FONT['label'],True,FLOW_COLORS['query'])

group(500,200,1220,470)
text(524,236,layer_label(4)+' · agent-wiki-cli query → agent-wiki-api · 같은 traceId · 서버 AI 호출 0회',FONT['group'],True,'#FFFFFF')
stages=[('1 · query search · 후보',['필드별 BM25 · 제목 4 · 태그 3 · 본문 1','짧은 Claim 후보 · 문서별 교차 배치','unmatchedTerms · needs_terms 반환'],'app','tabler-book-2'),('2 · query claim · 관계',['선택한 articleId · revision · anchor','고정 Version · 상태 · 적용 범위','대체·철회·충돌 관계 · 깊이 1~3'],'data','postgresql'),('3 · query source · 원문 구간',['필요한 근거 구간만 · 최대 80줄','불변 원문 · 해시·위치 확인','에이전트는 저장소를 직접 읽지 않음'],'data','oracle')]
for i,(title,lines,role,ico) in enumerate(stages):
 x=524+i*400;card(x,280,370,200,title,lines,role,ico)
 if i<2:path(f'M{x+370} 380 H{x+400}',flow='query')
path('M709 480 V510',True,flow='ops')
card(524,510,370,130,'조회 이력 · traceId · 30일',['단계·반환량·지연·잘림만 기록','질문·원문·답변은 기록하지 않음'],'ops','tabler-clipboard-check')
# Stores sit under the step that reads them; the agent never touches them directly.
path('M1109 480 V730',flow='query',both=True);text(1125,610,'고정 Version · 관계 읽기',FONT['label'],True,FLOW_COLORS['query'])
card(924,730,370,130,layer_label(3)+' · PostgreSQL',['Claims · 관계 · Wiki Page Version','상태는 관계로 계산'],'data','postgresql')
path('M1509 480 V730',flow='query',both=True);text(1525,610,'필요한 구간만 읽기',FONT['label'],True,FLOW_COLORS['query'])
card(1324,730,370,130,layer_label(1)+' · 원문 저장소',['불변 원문 · zstd · Object Storage','L4가 읽어 돌려줌'],'data','oracle')
box(40,910,1680,70,'#F1F2F4','#929EAD')
text(64,940,'서버 AI 호출 0회 · 조회는 정제·검토 확정을 시작하지 않음 · 최대 12단계 / 64,000자 · 원문 최대 80줄 · L5 토큰은 별도 관측',FONT['body'],True)
text(64,968,'임베딩·모델 리랭커는 검색 실패 사례가 쌓인 뒤 평가 · 질문 목적(current / history / overview)별 반환은 아키텍처의 표',FONT['label'])
end('docs/assets/wiki-l4-l5-query.svg')
