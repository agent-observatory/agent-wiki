#!/usr/bin/env python3
"""Format only safe operational fields; poll outside the application VM."""
import argparse
import hashlib
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from cost_report import Checkpoint, escaped, header, section, send, stamp, link_row

UTC = timezone.utc
RUN_URL = 'https://github.com/agent-observatory/agent-wiki/actions/workflows/error-monitor.yml'
EVENTS = {
    'api_server_error': ('API 요청 처리 오류', '요청 ID로 서버 로그를 확인하세요.'),
    'job_failed_terminal': ('자료 수집 최종 실패', '실패 코드를 확인한 뒤 해당 자료를 다시 처리하세요.'),
    'queue_connection_error': ('작업 큐 연결 오류', 'PostgreSQL 연결과 API·Worker 상태를 확인하세요.'),
    'api_drain_timeout': ('API 종료 유예 초과', '배포 시 진행 중이던 요청과 종료 로그를 확인하세요.'),
    'monitoring_test_error': ('[시험 알림] 오류 전달 확인', '합성 오류입니다. 실제 장애나 데이터 변경은 없습니다.'),
}
SERVICES = {'agent-wiki-api': 'API', 'agent-wiki-worker': 'Worker'}


def token(value):
    text = str(value or '')
    return text if re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', text) else ''


def extract(item):
    content = item.get('logContent', {})
    d = content.get('data', {})
    if not isinstance(d, dict): return None
    severity = d.get('severityNumber', 0)
    if not isinstance(severity, (int, float)) or severity < 17: return None
    event = token(d.get('eventName')) or 'unknown_error'
    resource, attrs = d.get('resource') or {}, d.get('attributes') or {}
    if not isinstance(resource, dict) or not isinstance(attrs, dict): return None
    # OCI Log Search flattens nested JSON keys; local fixtures/logs are nested.
    service = token(d.get('resource.service.name') or resource.get('service.name')) or 'agent-wiki'
    if not service.startswith('agent-wiki'): return None
    def attr(name):
        return token(d.get('attributes.agent_wiki.'+name) or attrs.get('agent_wiki.'+name))
    event_id = attr('event_id') or token(content.get('id'))
    if not event_id: raise ValueError('Error event has no stable identity')
    ts = stamp(content.get('time') or d.get('timestamp'))
    code = attr('error_code') or 'UNSPECIFIED'
    return {'id': hashlib.sha256(event_id.encode()).hexdigest(), 'time': ts.isoformat(),
            'event': event, 'service': service, 'code': code,
            'request': attr('request_id'), 'job': attr('job_id')}


def fingerprint(event):
    return hashlib.sha256('|'.join(event[k] for k in ('service','event','code')).encode()).hexdigest()


def message(events, log_url):
    first = min(events, key=lambda x:x['time'])
    latest = max(events, key=lambda x:x['time'])
    title, action = EVENTS.get(first['event'], ('애플리케이션 오류', '오류 코드와 발생 시각으로 로그를 확인하세요.'))
    service = SERVICES.get(first['service'], first['service'])
    kst = stamp(latest['time']).astimezone(timezone(timedelta(hours=9))).strftime('%m/%d %H:%M:%S')
    blocks = [header(('🧪 ' if '시험' in title else '🔴 ') + title),
              {'type':'section', 'fields':[
                  {'type':'mrkdwn','text':f'*서비스*\n{escaped(service)}'},
                  {'type':'mrkdwn','text':f'*새 오류*\n{len(events)}건'},
                  {'type':'mrkdwn','text':f'*오류 코드*\n`{escaped(first["code"])}`'},
                  {'type':'mrkdwn','text':f'*최근 발생*\n{kst} KST'}]},
              section(action)]
    ids = [('요청',latest['request']),('작업',latest['job'])]
    reference = ' · '.join(f'{label} `{escaped(value)}`' for label,value in ids if value)
    if reference: blocks.append({'type':'context','elements':[{'type':'mrkdwn','text':reference}]})
    blocks += [link_row([('오류 로그 보기',log_url),('점검 기록',RUN_URL)]),
        {'type':'context','elements':[{'type':'mrkdwn','text':'5분마다 점검 · 같은 오류는 최대 시간당 1회 알림'}]}]
    return {'text':f'{title} · {service} · {len(events)}건 · {first["code"]}', 'blocks':blocks}


def fetch_errors(client, tenancy, group, log, now):
    import oci
    query = f'search "{tenancy}/{group}/{log}" | where data.severityNumber >= 17 | sort by datetime asc'
    details = oci.loggingsearch.models.SearchLogsDetails(
        time_start=now-timedelta(hours=24), time_end=now, search_query=query,
        is_return_field_info=False)
    page, rows = None, []
    for _ in range(30):
        r = client.search_logs(details, limit=100, **({'page':page} if page else {}))
        rows += [x.data for x in (r.data.results or [])]
        page = r.headers.get('opc-next-page')
        if not page: return rows
    raise RuntimeError('Error query exceeded bounded pagination; checkpoint not advanced')


def run(items, state, save, now, log_url, deliver=send):
    errors = state.setdefault('errors', {})
    cutoff = now-timedelta(hours=48)
    seen = {k:v for k,v in errors.get('seen',{}).items() if stamp(v)>cutoff}
    sent = {k:v for k,v in errors.get('sent',{}).items() if stamp(v)>cutoff}
    groups = defaultdict(list)
    for item in items:
        event = extract(item)
        if event and event['id'] not in seen:
            seen[event['id']] = event['time']
            groups[fingerprint(event)].append(event)
    if len(seen)>6000: raise RuntimeError('Notification checkpoint capacity exceeded')
    count = 0
    for identity, events in groups.items():
        last = stamp(sent[identity]) if identity in sent else None
        if last is None or now-last >= timedelta(hours=1):
            deliver(message(events,log_url))
            sent[identity] = now.isoformat()
            count += 1
    # A failed send aborts before persisting seen IDs; at-least-once delivery.
    errors.update(seen=seen, sent=sent, last_success=now.isoformat())
    errors.pop('last_failure_notice',None)
    save(state)
    print(f'Error check completed: {len(items)} log rows, {count} notifications.')


def main():
    import oci
    parser=argparse.ArgumentParser();parser.add_argument('--preview',action='store_true');args=parser.parse_args()
    config=json.loads(os.environ['OCI_COST_CONFIG'])
    ids=json.loads(os.environ['OCI_LOG_CONFIG'])
    store=Checkpoint(oci.object_storage.ObjectStorageClient(config,retry_strategy=oci.retry.DEFAULT_RETRY_STRATEGY),
                     os.environ['OCI_COST_NAMESPACE'],os.environ['OCI_COST_BUCKET'])
    state=store.read();now=datetime.now(UTC)
    try:
        rows=fetch_errors(oci.loggingsearch.LogSearchClient(config,retry_strategy=oci.retry.DEFAULT_RETRY_STRATEGY),
                          config['tenancy'],ids['log_group_id'],ids['log_id'],now)
        url='https://cloud.oracle.com/logging/search?'+urlencode({
            'searchQuery':f'search "{config["tenancy"]}/{ids["log_group_id"]}/{ids["log_id"]}" | where data.severityNumber >= 17 | sort by datetime desc',
            'start':(now-timedelta(hours=24)).isoformat().replace('+00:00','Z'),
            'end':now.isoformat().replace('+00:00','Z'),
            'region':config['region'], 'regions':config['region']})
        if args.preview:
            print(f'Preview: {sum(extract(r) is not None for r in rows)} eligible error rows; no message sent.')
        else:run(rows,state,store.write,now,url)
    except Exception:
        if args.preview: raise
        error_state=state.setdefault('errors',{})
        last=error_state.get('last_failure_notice')
        if not last or now-stamp(last)>timedelta(hours=1):
            send({'text':'⚠️ Agent Wiki · 오류 점검 실패','blocks':[
                header('⚠️ 오류 점검 실패'),section('로그를 확인하지 못했어요. 오류가 없는 상태로 처리하지 않습니다.'),
                link_row([('점검 기록',RUN_URL)])]})
            # Preserve previous checkpoint on failure, including any IDs not delivered.
            original=store.read();original.setdefault('errors',{})['last_failure_notice']=now.isoformat();store.write(original)
        raise


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(f'Error monitor failed ({type(error).__name__}); inspect the private OCI configuration.',file=sys.stderr)
        sys.exit(1)
