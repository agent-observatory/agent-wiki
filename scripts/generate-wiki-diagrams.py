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
# Two sheets only: the architecture (deployment topology) and the L1-L5 flow.
# Both describe the target, not deployment completion.
def canvas(w,h,title,desc):
 global p
 p=[]
 a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc><defs></defs><g font-family="Noto Sans KR, sans-serif"><rect width="{w}" height="{h}" fill="#FFFFFF"/>')
 text(40,42,'AGENT WIKI / ARCHITECTURE',FONT["label"],True,'#526A86')
 text(40,98,title,FONT["diagram"],True)
 a(f'<path d="M40 137 H{w-40}" stroke="#172C4B" stroke-width="2"/>')
def card(x,y,w,h,title,lines,role='app',ico=None,highlight=False):
 if ico is None:
  ico={'app':'tabler-book-2','ingest':'tabler-cpu','data':'tabler-book-2','ai':'tabler-cloud','ops':'tabler-clipboard-check','web':'tabler-world'}[role]
 component(x,y,w,h,role)
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

# The single L1-L5 sheet. Four bands stack top to bottom: 01 raw increments through the
# worker pipeline (with the L3 reference loop and the retry loop), 02 L3 decisions and pages,
# 03 staged query and the agent, 04 review. Lists of facts (change-intent cases, experiment
# steps, rebuild steps, reprocess columns, port tables) live in markdown tables, not here.
canvas(1680,3100,'L1 → L5 · 원문에서 답변까지','L1부터 L5까지 한 장. 01은 두 세션의 증분을 Worker가 청킹·입력 조립·AI 판단·서버 검증으로 정제하고, L3 현재 주장의 BM25 후보를 규칙 재정렬 뒤 입력 조립에 되돌리며, 검증 실패는 같은 청크를 다시 보낸다. 02는 L3가 결정 A·B·C와 대체 관계를 보존하고 Decision History·현재 상태 페이지를 조립한다. 03은 L5 에이전트가 L4의 후보 → Claim·관계 → 원문 구간 조회를 반복해 근거를 받는다. 04는 검토 Version 비교와 사용자 확정이다. 정제 Provider를 NVIDIA에서 Alibaba로 바꾸는 예시는 합성이다.')
legend(640,87,'정제·반영','ingest');legend(830,87,'재시도','ingest',True);legend(1040,87,'조회·반환','query');legend(1250,87,'대체 관계','relation');legend(1460,87,'기록·기준','ops',True)
def section(y,label,sep=True):
 if sep:a(f'<path d="M40 {y-50} H1640" stroke="#CDD9E7" stroke-width="2"/>')
 text(40,y,label,FONT['group'],True)

section(182,'01 · '+layer_label(1)+' → '+layer_label(2)+' · 증분 정제',False)
card(40,210,680,172,'Codex · 이전 증분 · '+layer_label(1),['“정제 Provider는 NVIDIA로 하자.”','09:00 발언 예시 · 주장 A의 원문 보존','불변 원문 · 재생성 때도 유지'],'data','tabler-book-2')
card(960,210,680,172,'Claude · 새 증분 · '+layer_label(1),['“호출 지연 때문에 Alibaba로 바꾸자.”','10:00 발언 예시 · 변경 이유와 원문 보존','텍스트만 정제 · 이미지·URL은 모델에 보내지 않음'],'data','tabler-book-2')
path('M380 382 V430',flow='ingest');path('M1300 382 V430',flow='ingest')
group(40,430,1600,610)
text(64,466,'agent-wiki-worker · '+layer_label(2)+' · 청킹 → 입력 조립 → AI 판단 → 서버 검증',FONT['group'],True,'#FFFFFF')
cols=[64,462,860,1258]
pipeline=[('처리 범위 · 청킹',['수집 범위 고정 · 텍스트만','요청·도구 관계와 근거 유지'],'ingest','tabler-cpu'),('입력 조립',['새 청크 · 참고 맥락 · 기존 주장','최대 6개 · 입력 예산 · 잘림 기록','원문과 기존 주장을 구분'],'ingest','tabler-book-2'),('AI · 추출과 관계 판단',['추가 · 대체 · 철회 · 충돌','변경 이유 · 중간 결정 보존'],'ai','openai'),('서버 검증',['인용 · 역할 · Version','범위 일치 · 순환 방지'],'ingest','tabler-clipboard-check')]
for i,(title,lines,role,ico) in enumerate(pipeline):
 card(cols[i],510,358,170,title,lines,role,ico)
 if i<3:path(f'M{cols[i]+358} 595 H{cols[i+1]}',flow='ingest')
# Candidate lookup is a side loop: the chunk's terms go down to BM25, the selected claims come back into input assembly.
path('M243 680 V752 H600 V810',flow='query');text(262,744,'이번 청크의 검색어',FONT['label'],True,FLOW_COLORS['query'])
path('M980 810 V732 H680 V680',flow='query');text(700,724,'관련 후보 · 최대 6개 · 입력 예산',FONT['label'],True,FLOW_COLORS['query'])
reference=[(layer_label(3)+' 읽기',['Workspace 전체 현재 주장','제목 · 본문 · 대상 · 별칭','동일 세션 우선 강제 없음'],'data','postgresql'),('BM25 · 후보 검색',['희소성 · 빈도 · 길이','관련 후보 최대 24개','일치 없음 → 후보 없음'],'app','tabler-book-2'),('규칙 재정렬',['대상 · 범위 · 별칭 일치','여러 주제의 후보를 유지','유사도는 병합 승인이 아님'],'app','tabler-clipboard-check')]
for i,(title,lines,role,ico) in enumerate(reference):
 card(cols[i],810,358,184,title,lines,role,ico)
 if i<2:path(f'M{cols[i]+358} 902 H{cols[i+1]}',flow='query')
# Validation failure re-sends the same chunk to the model (dashed ingest); the Retry card explains the loop.
path('M1300 680 V748 H1100 V680',True,flow='ingest');path('M1300 748 V810',True,flow='ingest')
text(1320,772,'검증 실패 → 새 응답',FONT['label'],True,FLOW_COLORS['ingest'])
card(1258,810,290,184,'Retry · 실패 청크만',['실패한 청크부터 다시','3회 연속 오류 → 확인 필요','성공 청크 · 위치 유지'],'ops','tabler-clipboard-check')
# Verified changes go down into L3; L3's current claims are read back into the reference row.
path('M1590 680 V1090',flow='ingest');text(1420,1066,'검증된 변경 → 반영',FONT['label'],True,FLOW_COLORS['ingest'])
path('M243 1090 V994',flow='query');text(262,1066,'기존 주장 참고',FONT['label'],True,FLOW_COLORS['query'])

group(40,1090,1600,640)
text(64,1126,'02 · '+layer_label(3)+' · Claims · Decisions · Wiki Pages · 상태·관계·근거 보존',FONT['group'],True,'#FFFFFF')
card(64,1168,420,155,'Decision A · 이전 결정',['정제 Provider = NVIDIA','대체됨 · 근거와 함께 보존'],'ops')
card(614,1168,420,155,'Decision B · 현재 결정',['정제 Provider = Alibaba','변경 이유 · 호출 지연 · 사용자 결정'],'data')
card(1164,1168,412,155,'Decision C · 별도 속성',['API 동시 실행 = 5','현재 결정 · Provider와 별개'],'data')
path('M614 1245 H484',flow='relation')
text(499,1233,'supersedes',FONT['label'],True,FLOW_COLORS['relation']);text(500,1268,'B가 A를 대체',FONT['label'],True,FLOW_COLORS['relation'])
# History is built from A and the B→A relation; the current state only from B and C, so B drops into both pages.
path('M274 1323 V1445',flow='ingest');path('M714 1323 V1445',flow='ingest')
path('M934 1323 V1445',flow='ingest');path('M1370 1323 V1445',flow='ingest')
text(300,1390,'이전 결정 A + 대체 관계 → 변경 이력',FONT['label'],True,FLOW_COLORS['ingest'])
text(960,1390,'현재 결정 B · C → 현재 상태',FONT['label'],True,FLOW_COLORS['ingest'])
card(64,1445,740,180,'Wiki Page · Decision History · 변경 이력',['NVIDIA → 호출 지연 → Alibaba','이전 결정·변경 근거를 페이지에 연결','제안·미확인·충돌은 현재 결정과 구분'],'data')
card(836,1445,740,180,'Wiki Page · 현재 상태와 설명',['Alibaba · 동시 실행 5 · 적용 범위','관련 Claims의 설명·이유·제약을 함께 구성','문단 → Claim Version → Evidence'],'data')
text(64,1665,'현재 채택 ≠ 사실 검증 · 사용자 결정 / 도구 관찰 / AI 해석을 구분 · 페이지는 Claim 고정 Version의 조립',FONT['component'],True)
text(64,1702,'검토 의견·다른 적용 범위·늦게 도착한 과거 발언은 시각만으로 대체하지 않음 · Reassemble은 모델 호출 없이 페이지만 새 Version',FONT['body'])

section(1830,'03 · '+layer_label(4)+' ↔ '+layer_label(5)+' · 단계적 조회',False)
card(40,1860,430,235,layer_label(5)+' · 작업 에이전트',['Codex · Claude Code + 조회 Skill','현재 / 변경 이유 / 개요 판단','근거 부족 시 검색어·깊이 조정','충분하면 고정 Version으로 인용'],'app','tabler-cpu')
text(40,2125,'미반영 / 없음 / 실패 / 잘림을 구분해 반환',FONT['label'],True,FLOW_COLORS['query'])
group(520,1860,1120,300)
text(544,1896,layer_label(4)+' · Wiki CLI query → agent-wiki-api · 후보 → Claim·관계 → 원문 구간',FONT['group'],True,'#FFFFFF')
stages=[('search · 후보',['필드별 BM25 · 제목·별칭·본문','짧은 Claim 후보 · 문서별 교차','unmatchedTerms 함께 반환'],'app','tabler-book-2'),('claim · 관계',['고정 Version · 상태 · 범위','대체·철회·충돌 · 깊이 1~3','L3에서 읽기'],'data','postgresql'),('source · 원문 구간',['필요한 근거 구간만 · 최대 80줄','불변 원문 · 해시·위치 확인','L1에서 읽기'],'data','oracle')]
for i,(title,lines,role,ico) in enumerate(stages):
 x=544+i*364;card(x,1930,340,190,title,lines,role,ico)
 if i<2:path(f'M{x+340} 2025 H{x+364}',flow='query')
path('M470 1977 H520',flow='query',both=True)
# claim reads L3 above; source reads L1 (shown again where it is read, the agent never touches Object Storage).
path('M1078 1930 V1730',flow='query',both=True)
path('M1442 2120 V2200',flow='query',both=True)
card(1272,2200,340,130,layer_label(1),['불변 원문 · 필요한 구간만 읽기'],'data','oracle')
path('M714 2160 V2200',True)
card(544,2200,640,130,'조회 이력 · traceId',['같은 질문은 같은 traceId · 단계·반환량·지연 · 30일 보관','질문·원문·답변·내부 추론은 기록하지 않음'],'ops','tabler-clipboard-check')
box(40,2370,1600,74,'#F1F2F4','#929EAD');text(64,2402,'서버 AI 호출 0회 · 조회는 정제를 시작하지 않음 · 최대 12단계 / 64,000자 · L5 토큰은 별도 관측',FONT['body'],True)
text(64,2430,'임베딩·모델 리랭커는 검색 실패 사례가 쌓인 뒤 평가한다.',FONT['label'])

section(2530,'04 · 검토 · 자동 정제 결과와 Reprocess 후보는 검토 전 · 사용자 확인으로 확정')
items=[('에이전트 · Skill',['review queue · 검토 대상 선택','자동 정제 결과 · Reprocess 후보'],'app'),('CLI · 개념 비교',['review diff · 검토 Version 기준','주장·범위·근거·관계의 차이'],'app'),('사용자 확인',['변경 이유와 근거 확인','수정은 별도 publication'],'web'),('CLI · 검토 확정',['review confirm · Version·해시 검사','스냅샷 보존 · 완료 ≠ 사실 검증'],'data')]
for i,(title,lines,role) in enumerate(items):
 x=40+i*410;card(x,2580,370,170,title,lines,role)
 if i<3:path(f'M{x+370} 2665 H{x+410}',flow='query')
group(40,2800,1600,220)
text(64,2836,'지식과 검토 이력 · Version 3은 가장 가까운 검토 완료인 Version 1과 비교',FONT['group'],True,'#FFFFFF')
card(64,2900,496,92,'Version 1 · 검토 완료',[],'data')
card(592,2900,496,92,'Version 2 · 검토 전',[],'ingest')
card(1120,2900,496,92,'Version 3 · 검토 전',[],'ingest')
path('M1368 2900 V2876 H312 V2900',True)
text(800,2870,'비교 기준',FONT['label'],True,FLOW_COLORS['ops'])
text(40,3060,'검토 이력이 없으면 직전 Version과 비교 · 검토는 Version·스냅샷에 귀속되며 새 Version은 다시 검토 대상 · 웹은 조회만, 확정은 CLI',FONT['body'])
end('docs/assets/wiki-l1-l5.svg')
