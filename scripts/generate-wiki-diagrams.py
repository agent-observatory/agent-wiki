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


canvas(1920,1280,'단일 VM · K3s 아키텍처','OCI A1 VM 하나에서 K3s server와 containerd가 앱을 관리한다. Traefik이 HTTPS 요청을 Service로 전달하고 cert-manager가 TLS Secret을 관리한다. PostgreSQL은 PVC와 local PV를 통해 기존 Block Volume을 사용한다. Collector 직접 업로드와 L1부터 L5까지의 책임은 유지한다.')
legend(1110,87,'수집·지식 반영','ingest');legend(1370,87,'조회·응답','query');legend(1600,87,'설정·인증·저장','ops',True)
a('<g transform="translate(0,-250)">')
card(1640,410,240,120,'DuckDNS · 도메인',['VM 공인 주소 연결','agent-wiki.duckdns.org'],'web','tabler-world')
card(1640,550,240,160,'agent-wiki-data',['Block Volume · 50GB','DB·K3s 영속 상태','부트 볼륨 50GB 별도'],'data','oracle')
group(40,430,430,990);text(64,466,'사용자 기기',FONT['group'],True,'#FFFFFF')
group(590,430,1010,990);icon('oracle',614,443,32)
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
card(940,820,280,260,'agent-wiki-api',['Fastify · 내부 3001','Deployment + Service','수집 허가·검증·L1 확정','검색·지식·설정·검토','수집·조회 HTTP API'],'app','fastify')
card(1280,820,280,210,'agent-wiki-db',['PostgreSQL · 내부 5432','StatefulSet + Service','지식·근거·변경 관계','관리 접속 · 외부 5432'],'data','postgresql')

# The disk is attached to the VM. PVC/PV binds its mounted PostgreSQL path.
path('M1640 625 H1560',True);text(1480,735,'VM 마운트',FONT['label'])
card(1280,550,280,150,'agent-wiki-db-data',['PVC → local PV','Block Volume의 DB 경로','Retain · 노드 고정'],'data','tabler-book-2')
path('M1420 820 V700',True);text(1438,764,'데이터 읽기·쓰기',FONT['label'])

# API only orchestrates source registration; collector bytes bypass the VM.
path('M1220 1060 H1640',True,both=True);text(1310,1090,'원문 허가·검증',FONT['label'])
card(1640,890,240,190,'agent-wiki-sources',['OCI Object Storage','불변 L1 · 압축 보관','텍스트·이미지 분리'],'data','oracle')
path('M418 1300 H480 V1470 H1900 V1000 H1880',flow='ingest')
text(650,1500,'압축 증분 직접 업로드 · 본문은 VM을 통과하지 않음',FONT['label'],True,FLOW_COLORS['ingest'])

# Worker executes domain code and accesses DB directly.
path('M1220 1195 H1250 V1010 H1280',flow='ingest',both=True)
card(940,1140,280,220,'agent-wiki-worker',['Deployment · 원격 정제','텍스트 청킹·주장 추출','기존 지식 비교·관계 연결','BYOK · RPM·동시성 제어','수신 포트 없음'],'ingest','tabler-cpu')
path('M1220 1330 H1640',flow='ingest',both=True)
text(1310,1357,'텍스트·정제 결과',FONT['label'],True,FLOW_COLORS['ingest'])
card(1640,1285,240,100,'AI Provider',[],'ai','openai')

# Control components are shown off the application request path.
card(640,1140,250,220,'K3s 제어·실행',['API Server · 6443','kubelet · 10250','Scheduler · 10259','containerd · 로컬 통신','관리 포트 · 외부 비공개'],'ops','kubernetes')
card(1280,1140,280,170,'cert-manager',['인증서 발급·자동 갱신','Webhook · 내부 443','ACME · 외부 443'],'ops','tabler-clipboard-check')
card(1640,1130,240,130,'인증서 발급 기관',['ACME · Let’s Encrypt','도메인 소유 확인'],'ops','letsencrypt')
path('M1560 1225 H1640',True,both=True)
path('M1420 1140 V1095 H770 V1080',True);text(785,1119,'TLS Secret',FONT['label'])
for right,by,n,width in [(424,734,5,150),(404,1159,1,170),(1206,1124,2,152),(1546,804,3,172),(1206,804,4,132),(1866,874,1,170)]:
 bx=right-width
 box(bx,by,width,32,'#344256','#344256');text(bx+12,by+23,layer_label(n),FONT['label'],True,'#FFFFFF')
a('</g>')
end('docs/assets/wiki-deployment.svg')

# One logical view: curation, changing claims, provenance, and independent retrieval.
canvas(1560,860,'지식의 생성·변경·조회','Workspace 안에서 L1 불변 원문과 기존 지식을 L2가 비교하고 L3의 현재 결정·과거 주장·원문 근거를 연결한다. L5 작업 에이전트는 CLI로 L4를 조회하며 새 정제 완료를 기다리지 않는다. Compose에서 K3s로의 변경은 합성 예시다.')
legend(890,87,'정제·반영','ingest');legend(1100,87,'조회·반환','query');legend(1320,87,'근거 참조','relation')
card(40,230,440,220,layer_label(1),['Collector → API 검증·등록','Codex·Claude 원문 · 세션별 보존','A: “Compose로 운영하자.”','B: “K3s로 바꾸자.”'],'data','tabler-cloud-upload',highlight=True)
card(550,230,440,220,layer_label(2),['agent-wiki-worker · AI 정제','증분 + 맥락 + 기존 지식 비교','주장·인용·관계 검증 → 반영','입력 범위·모델·실행 이력 보존'],'ingest','tabler-cpu',highlight=True)
card(1060,230,460,220,layer_label(3),['agent-wiki-db · Version·근거','Compose → K3s · 변경 이유','현재 결정 / 검토 상태 구분','Memory · Article · Glossary'],'data','tabler-book-2',highlight=True)
path('M480 340 H550',flow='ingest');path('M990 340 H1060',flow='ingest')
path('M1280 230 V185 H770 V230',True,flow='ingest')
text(835,175,'기존 지식을 다음 정제에 참고',FONT['label'],True,FLOW_COLORS['ingest'])
path('M1280 450 V500 H260 V450',flow='relation')
text(570,490,'주장·변경 관계 → 불변 원문의 정확한 구간',FONT['label'],True,FLOW_COLORS['relation'])
path('M1480 450 V580',flow='query')
text(1210,551,'이미 반영된 지식을 조회',FONT['label'],True,FLOW_COLORS['query'])
card(40,580,440,220,layer_label(5),['Codex·Claude + 조회 Skill','agent-wiki CLI로 조회','“왜 K3s로 바꿨지?”','변경 이유·근거로 답변·작업'],'app','tabler-terminal-2',highlight=True)
card(550,580,970,220,layer_label(4),['agent-wiki-api · Workspace 범위','검색어·별칭 → 후보 정렬 → 현재/과거·적용 범위 확인','Context · 고정 Version + 주장 + 변경 이유 + 원문 근거','미해결 충돌은 함께 반환 · 일반 조회는 모델 호출 없음'],'app','tabler-book-2',highlight=True)
path('M480 690 H550',flow='query',both=True)
text(40,839,'정제는 백그라운드에서 진행 · 조회는 새 정제 완료를 기다리지 않음',FONT['body'])
end('docs/assets/wiki-layers.svg')

canvas(1560,1210,'운영 · 사용자 작업과 백그라운드 처리 분리','목표 운영 구성. 기존 VM과 볼륨, 도메인, 인증서, OAuth, 비용과 오류 모니터링을 재사용한다. CLI 반영의 멱등성과 API 정상 종료를 검증한다. 앱이 Slack을 직접 호출하지 않는다.')
rows=[(190,'01','인프라',[
 ('terraform','Terraform / HCL','기존 VM · 볼륨 · 버킷 유지','VM 사양·데이터 경로 유지'),('ubuntu','cloud-init / systemd','디스크 마운트 · K3s 기동','OS·K3s 업데이트 직접 관리'),('kubernetes','K3s','Traefik · Web · API · PostgreSQL','원격 정제 Worker · 별도 실행')]),
 (385,'02','앱 배포',[
 ('github','외부 ARM64 빌드','GHCR 게시 → Pod 이미지 확보','migration Job → 앱 교체'),('tabler-terminal-2','외부 차단 → 정상 종료','진행 요청·정제 작업 마무리','미완료 정제는 재시도'),('tabler-clipboard-check','기동·반영·조회 확인','DB·Traefik 유지 · 상태 확인','쓰기 결과는 멱등 키로 확인')]),
 (580,'03','오류 로그',[
 ('ubuntu','stdout → OCI Logging','containerd CRI · rsyslog','OCI 기성 호스트 에이전트'),('oracle','Connector → Monitoring','ERROR 이상 → 오류 수 지표','5분 집계 · 상태 변경 알림'),('tabler-bell','Notifications → Slack','OCI 기본 경보 · 로그 링크','오류 감지·경보 해제 알림')]),
 (775,'04','비용·사용량',[
 ('oracle','OCI Usage API','비용·CPU·메모리·저장소','미집계와 0을 구분'),('github','Actions · 6시간마다','비용 발생·한도 접근·사용 급증','09:13 한국 시각 정기 요약'),('tabler-bell','Slack Webhook','누적·일 사용량·전일 비교','기존 모니터링 경로 유지')]),
 (970,'05','별도 수집',[
 ('tabler-cloud-upload','agent-wiki-collector','허가 후 zstd 증분 직접 업로드','기기별 위치 · 실패 시 재시도'),('tabler-clipboard-check','agent-wiki-api','세션 ID·내용으로 중복 판정','원문 확정 뒤 연속 수신 위치 갱신'),('tabler-terminal-2','agent-wiki-worker','BYOK · 최대 동시성 5개','설정별 호출·재시도 · 이력 보존')])]
for y,n,label,items in rows:
 text(40,y+32,n,FONT["component"],True);text(40,y+73,label,FONT["component"],True)
 for i,(ico,title,b,c) in enumerate(items):
  x=225+i*438
  card(x,y,388,150,title,[b,c],'ops' if n in ['01','04'] else 'app',ico)
  if i<2:path(f'M{x+388} {y+75} H{x+432}')
end('docs/assets/wiki-operations.svg')

# Curation is a logical algorithm inside the existing worker, not new services.
canvas(1680,1080,'새 원문 → 기존 결정과 비교 → 다음 기억','BM25로 기존 주장 후보를 찾고 대상·범위·별칭과 주제 다양성으로 재정렬한다. AI가 변경 의도를 판단하고 서버가 근거·관계를 검증한다. 과거 주장과 변경 근거를 보존하며 기본 조회에는 현재 결정을 제공한다.')
legend(1120,55,'정제·반영','ingest');legend(1400,55,'참고 조회','query')
group(348,145,1292,260)
text(372,181,'agent-wiki-worker · '+layer_label(2),FONT['group'],True,'#FFFFFF')
card(40,222,288,158,layer_label(1),['새로 확정된 증분','시각 · 발언자 · 원문 위치'],'data','oracle')
card(368,222,288,158,'처리 범위 · 청킹',['수집 범위 고정 · 텍스트만','요청·도구 관계와 근거 유지'],'ingest','tabler-cpu')
card(696,222,288,158,'입력 조립',['새 청크 · 참고 맥락','원문과 기존 주장을 구분'],'ingest','tabler-book-2')
card(1024,222,288,158,'AI · 추출과 관계 판단',['추가 · 대체 · 철회 · 충돌','변경 이유 · 중간 결정 보존'],'ai','openai')
card(1352,222,268,158,'서버 검증',['인용 · 역할 · Version','범위 일치 · 순환 방지'],'ingest','tabler-clipboard-check')
for x in [328,656,984,1312]:path(f'M{x} 301 H{x+40}',flow='ingest')
path('M512 380 V510',flow='query');text(528,455,'이번 청크의 검색어',FONT['label'],True,FLOW_COLORS['query'])
card(40,510,288,184,layer_label(3),['Workspace 전체 현재 주장','제목 · 본문 · 대상 · 별칭','동일 세션 우선 강제 없음'],'data','postgresql')
card(368,510,288,184,'BM25 · 후보 검색',['희소성 · 빈도 · 길이','관련 후보 최대 24개','일치 없음 → 후보 없음'],'app','tabler-book-2')
card(696,510,288,184,'규칙 재정렬',['대상 · 범위 · 별칭 일치','여러 주제의 후보를 유지','유사도는 병합 승인이 아님'],'app','tabler-clipboard-check')
card(1024,510,288,184,'비교할 기존 주장',['최대 6개 · 입력 예산 제한','Version · 상태 · 근거 위치','잘림·선택 이유를 기록'],'ops','tabler-clipboard-check')
for x in [328,656,984]:path(f'M{x} 602 H{x+40}',flow='query')
path('M1168 510 V380',flow='query');text(1184,455,'관련 후보',FONT['label'],True,FLOW_COLORS['query'])
path('M1486 380 V820',flow='ingest')
text(1352,568,'모델의 제안',FONT['body'],True)
text(1352,600,'+ 서버의 검증',FONT['body'])
text(1352,652,'원문 유지',FONT['label'])
group(40,820,1600,202)
text(64,856,'agent-wiki-db · 주장·관계·처리 위치를 함께 확정',FONT['group'],True,'#FFFFFF')
card(64,890,486,108,'과거 결정 A',['원래 주장 · 시각을 가진 원문 근거'],'ops','postgresql')
card(600,890,486,108,'변경 관계 · 이유',['B가 A를 대체 · 정정 발언의 근거'],'data','postgresql')
card(1136,890,480,108,'현재 결정 B',['기본 조회 · 검토 상태 · 다음 처리 위치'],'data','postgresql')
path('M1136 944 H1086',flow='relation');path('M600 944 H550',flow='relation')
end('docs/assets/wiki-curation.svg')

canvas(1680,1340,'결정은 바뀌어도 근거와 이력은 남는다','정제 Provider를 NVIDIA에서 Alibaba로 변경하는 예시. L1은 양쪽 원문을 보존한다. L2는 명시적인 변경·검토 의견·범위 차이·미해결 충돌·늦은 수집을 구분한다. L3는 주장 단위 과거·현재 상태와 근거를 저장하며 L4는 현재 결정·변경 이유·충돌을 구분해 조회한다. 현재 결정은 검증된 사실과 다르다.')
legend(960,80,'정제·반영','ingest');legend(1210,80,'대체 관계','relation');legend(1450,80,'조회','query')
card(40,185,680,142,'Codex · 이전 증분 · '+layer_label(1),['“정제 Provider는 NVIDIA로 하자.”','09:00 발언 예시 · 주장 A의 원문 보존'],'data','tabler-book-2')
card(960,185,680,142,'Claude · 새 증분 · '+layer_label(1),['“호출 지연 때문에 Alibaba로 바꾸자.”','10:00 발언 예시 · 변경 이유와 원문 보존'],'data','tabler-book-2')
path('M380 327 V375',flow='ingest');path('M1300 327 V375',flow='ingest')
group(40,375,1600,222)
text(64,411,layer_label(2)+' · 같은 대상·범위에서 변경 의도 판단',FONT['group'],True,'#FFFFFF')
cases=[('명시적인 변경',['A 취소 → B 채택','A를 대체할 근거 연결'],'ingest'),('검토 의견',['“B도 괜찮을까?”','A 유지 · 제안으로 보존'],'ops'),('적용 범위가 다름',['로컬 A · 운영 B','각 범위에서 둘 다 유지'],'data'),('결론이 불명확',['서로 상반된 주장','충돌·미해결로 보존'],'ai'),('늦게 수집된 발언',['과거 발언이 뒤에 도착','수신 순서로 덮어쓰지 않음'],'ops')]
for i,(title,lines,role) in enumerate(cases):card(64+i*314,455,290,118,title,lines,role)
path('M840 597 V645',flow='ingest')
group(40,645,1600,222)
text(64,681,layer_label(3)+' · 주장별 상태·관계·근거 보존',FONT['group'],True,'#FFFFFF')
card(64,725,510,118,'주장 A · 대체됨',['정제 Provider = NVIDIA','이전 주장·원문은 이력으로 유지'],'ops','postgresql')
card(1106,725,510,118,'주장 B · 현재 채택',['정제 Provider = Alibaba','사용자 결정 · 호출 검증과 별개'],'data','postgresql')
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
text(40,1235,'같은 청크·다른 세션도 연결 · 발언/적용/수집 시각 구분 · 시각만으로 대체하지 않음',FONT['body'])
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
items=[('정제 중지',['진행 작업 종료 확인','이전 실행의 반영 차단'],'ops'),('입력 범위 고정',['불변 L1 · 원문 ID 유지','원래 순서·근거로 재생'],'data'),('파생 상태 초기화',['지식 · 근거 · 정제 결과','원문부터 다시 대기'],'ingest'),('새 실행으로 재정제',['재개하면 정제 시작','호출 이력·대기 시간 유지'],'ingest')]
for i,(title,lines,role) in enumerate(items):
 x=40+i*380;card(x,240,340,170,title,lines,role)
 if i<3:path(f'M{x+340} 325 H{x+380}',flow='ingest')
group(40,495,1480,180)
text(64,531,'유지하는 것',FONT['group'],True,'#FFFFFF')
card(64,568,450,82,layer_label(1),[],'data','oracle')
card(537,568,450,82,'Collector 수신 위치',[],'ops','tabler-cloud-upload')
card(1010,568,486,82,'Workspace · 로그인 · AI 설정',[],'ops','tabler-clipboard-check')
text(40,722,'개인 위키 · Workspace 전체를 다시 만들고 원문·수집 위치·호출 이력은 유지',FONT['body'])
end('docs/assets/wiki-curation-rebuild.svg')

canvas(1560,760,'지식 검토 · 변경된 개념을 확인하고 확정','작업 에이전트가 CLI로 검토 대기와 기준 스냅샷을 조회한다. 사용자 확인 후 Version과 비교 해시를 검사해 불변 검토 기록을 남긴다. 웹은 조회만 한다.')
legend(1240,78,'검토 흐름','query')
items=[('에이전트 · Skill',['agent-wiki review queue','검토할 지식 선택'],'app'),('CLI · 개념 비교',['가까운 검토 Version 기준','주장·범위·근거·관계'],'app'),('사용자 확인',['변경 이유와 근거 확인','수정은 별도 publication'],'web'),('CLI · 검토 확정',['Version · 해시 일치 검사','불변 스냅샷 보존'],'data')]
for i,(title,lines,role) in enumerate(items):
 x=40+i*380;card(x,230,340,170,title,lines,role)
 if i<3:path(f'M{x+340} 315 H{x+380}',flow='query')
group(40,485,1480,190)
text(64,523,'지식과 검토 이력',FONT['group'],True,'#FFFFFF')
card(64,555,450,92,'Version 1 · 검토 완료',[],'data')
card(537,555,450,92,'Version 2 · 검토 전',[],'ingest')
card(1010,555,486,92,'Version 3 · 검토 전',[],'ingest')
text(40,716,'Version 3은 검토 완료인 Version 1과 비교 · 검토 이력이 없으면 직전 Version',FONT['body'])
end('docs/assets/wiki-review.svg')

# One diagram connects the layer model, atomic decisions and a readable topic page.
canvas(1560,1260,'원문 → Claims · Decisions → Wiki Pages → 답변','L1–L5와 L3 내부 지식 구성을 한 그림으로 설명한다. L2는 근거 ID로 원문을 연결하고 주제별 페이지를 구성한다. L3는 작은 주장·결정과 읽기용 페이지를 구분하며 과거 결정과 변경 이유를 보존한다. 아래 제공자 변경은 합성 예시다.')
card(40,180,650,155,layer_label(1),['원문 대화 · 세션별 불변 증분','Evidence · 선택한 기록의 원문 근거'],'data',highlight=True)
card(870,180,650,155,layer_label(2),['주장 추출 · 기존 결정과 비교 · 근거 검증','Topic 분류 · 변경 관계 · 페이지 구성'],'ingest',highlight=True)
path('M690 257 H870',flow='ingest');path('M1195 335 V375 H375 V420',flow='ingest')
group(40,420,1480,570)
text(64,456,layer_label(3)+' · Claims와 Wiki Pages',FONT['group'],True,'#FFFFFF')
card(64,498,420,155,'Decision A · 이전 결정',['정제 Provider = NVIDIA','대체됨 · 근거와 함께 보존'],'ops')
card(570,498,420,155,'Decision B · 현재 결정',['정제 Provider = Alibaba','변경 이유 · 호출 지연'],'data')
card(1076,498,420,155,'Decision C · 별도 속성',['API 동시 실행 = 5','현재 결정 · Provider와 별개'],'data')
path('M570 575 H484',flow='relation');text(68,683,'B supersedes A · B가 A를 대체',FONT['label'],True,FLOW_COLORS['relation'])
path('M780 653 V716',flow='ingest');path('M1286 653 V690 H780',flow='ingest')
text(64,746,'Wiki Page · AI 정제 연결',FONT['group'],True)
card(64,775,688,180,'현재 상태와 설명',['Alibaba · 동시 실행 5 · 적용 범위','관련 Claims의 설명·이유·제약을 함께 구성','문단 → Claim Version → Evidence'],'data')
card(790,775,706,180,'Decision History · 변경 이력',['NVIDIA → 호출 지연 → Alibaba','이전 결정·변경 근거를 페이지에 연결','제안·미확인·충돌은 현재 결정과 구분'],'data')
path('M375 990 V1050',flow='query')
card(40,1050,650,155,layer_label(4),['Wiki Pages · Claims · Evidence 조회','현재 결정과 변경 이유를 구분'],'app',highlight=True)
card(870,1050,650,155,layer_label(5),['작업 에이전트의 답변·실행','조회한 근거를 사용자 작업에 활용'],'app',highlight=True)
path('M690 1128 H870',flow='query')
text(40,1239,'Decision은 Claim의 유형 · Chunk는 AI 입력 처리 단위 · 페이지 구성은 L2의 책임',FONT['body'],True)
end('docs/assets/wiki-knowledge-model.svg')

canvas(1560,820,'원문을 보존하며 분석·조립을 개선한다','Retry는 실패한 청크부터 이어간다. Reprocess는 성공한 분석 범위를 새 분석으로 비교하고 사용자가 확인한 정정만 반영한다. Reassemble은 기존 주장을 모델 호출 없이 새 페이지 Version으로 조립한다. 분석 정정은 사용자의 과거 결정 변경과 구분한다.')
card(40,180,460,180,'Retry · 실패 부분 재시도',['실패한 청크부터 다시 실행','성공한 청크·근거·처리 위치 유지','반복 출력 오류는 3회 뒤 확인 필요'],'ingest')
card(550,180,460,180,'Reprocess · 선택한 범위 재분석',['성공한 실행의 원문 범위를 고정','새 분석 또는 저장 출력 재검증','이전 주장·근거와 변경 후보 비교'],'ai')
card(1060,180,460,180,'Reassemble · 페이지 재조립',['현재 Claims·Evidence를 다시 구성','제목별 묶음 · 근거 기록 시각','모델 호출 없음'],'data')
path('M270 360 V420',flow='ingest');path('M780 360 V420',flow='ingest');path('M1290 360 V420',flow='ingest')
card(40,420,460,190,'다음 처리 위치로 진행',['같은 청크를 무한 반복하지 않음','인증·할당량 오류는 별도로 분류','원문과 과거 실행 이력은 보존'],'ops')
card(550,420,460,190,'검토 후보 · 아직 미반영',['기존 지식을 즉시 덮어쓰지 않음','에이전트가 개념별 차이를 설명','사용자 확인 후 고정 Version에 반영'],'app')
card(1060,420,460,190,'Wiki Page · 새 Version',['내용이 바뀐 주제만 새 Version','기존 Claim·검토 상태는 유지','과거 페이지도 조회 가능'],'data')
path('M780 610 V656',flow='relation')
card(550,656,460,90,'분석 정정 ≠ 사용자 결정 변경',[],'ops')
text(40,792,'L1은 불변 · 입력/출력/캐시/추론 사용량을 분리 기록 · 정제 시작·중지는 사용자 명령',FONT['body'],True)
end('docs/assets/wiki-reprocessing.svg')
