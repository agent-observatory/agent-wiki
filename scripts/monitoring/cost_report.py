#!/usr/bin/env python3
"""OCI billing reader and Slack reporter. No access to VM lifecycle or Wiki data."""
import argparse
import hashlib
import html
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal

UTC = timezone.utc
COST_URL = 'https://cloud.oracle.com/account-management/cost-analysis?region=ap-osaka-1'
RUN_URL = 'https://github.com/agent-observatory/agent-wiki/actions/workflows/cost-monitor.yml'
STATE_KEY = 'ops/cost-alert-state.json'
# Conservative operating budgets, not a claim about individual account entitlements.
LIMITS = {'cpu': Decimal('1500'), 'memory': Decimal('9000'), 'requests': Decimal('50000'),
          'block': Decimal('200'), 'object': Decimal('10')}
BUDGET_UNITS = {'cpu':'OCPU·시간', 'memory':'GB·시간', 'requests':'건', 'block':'GB', 'object':'GB'}
BUDGET_NAMES = {'cpu':'A1 CPU · 월 누적', 'memory':'A1 메모리 · 월 누적',
                'requests':'Object Storage 요청 · 월 누적', 'block':'부트 + 블록 볼륨 · 현재 할당',
                'object':'Wiki 원문 저장소 · 현재 용량'}
LABELS = {'cpu': 'A1 CPU', 'memory': 'A1 메모리', 'block': '블록 스토리지',
          'object': '오브젝트 스토리지', 'network': '외부 전송', 'other': '기타', 'requests':'Object Storage 요청'}


def decimal(value):
    return Decimal(str(value)) if value is not None else None


def stamp(value):
    return datetime.fromisoformat(str(value).replace('Z', '+00:00')).astimezone(UTC)


def key(row):
    return (row.get('service', ''), row.get('sku_name', ''), row.get('unit', ''))


def category(k):
    service, sku, unit = (v.lower() for v in k)
    if 'a1' in sku and ('ocpu' in sku or 'ocpu' in unit): return 'cpu'
    if 'a1' in sku and ('memory' in sku or 'memory' in service): return 'memory'
    if 'outbound' in sku or 'data transfer' in sku: return 'network'
    if 'block' in service: return 'block'
    if 'object' in service: return 'object'
    return 'other'


def group_usage(rows):
    result = {}
    for r in rows:
        q = decimal(r.get('computed_quantity'))
        if q is None: continue
        k = key(r)
        result[k] = result.get(k, Decimal(0)) + q
    return result


def cost_totals(rows):
    totals = {}
    for r in rows:
        a = decimal(r.get('computed_amount'))
        currency = r.get('currency')
        if a is not None and currency:
            totals[currency] = totals.get(currency, Decimal(0)) + a
    return totals


def amount(value):
    if value == 0: return '0'
    if abs(value) < Decimal('0.001'): return format(value, '.6g')
    return format(value, ',.3f').rstrip('0').rstrip('.')


def money(totals):
    if not totals: return '미집계'
    return ' · '.join(f'{c} {amount(v)}' for c, v in sorted(totals.items()))


def escaped(s):
    return html.escape(str(s), quote=False).replace('`', "'")


def metric_name(k):
    service, sku, unit = (v.lower() for v in k)
    c = category(k)
    if c in ('cpu','memory'): return LABELS[c]
    if c == 'block': return '블록 볼륨 · 무료' if 'free' in sku else '블록 볼륨'
    if c == 'network': return '원문 저장소 외부 전송' if 'object' in service else '네트워크 외부 전송'
    if c == 'object' and 'request' in sku: return '원문 저장소 요청'
    if c == 'object': return '원문 저장 용량'
    return f'{LABELS[c]} · {k[1]}'[:65]


def display_quantity(q, unit):
    if unit == '10K Requests': return f'{amount(q * 10000)}건'
    unit = unit.replace('GB Months', 'GB·월').replace('OCPU Hours', 'OCPU·시간').replace('GB Hours', 'GB·시간')
    value = '<0.001' if 0 < q < Decimal('.001') else amount(q)
    return f'{value} {unit}'


def full_day_keys(rows):
    """Never compare a partly received day with a full day or missing data with zero."""
    buckets = defaultdict(set)
    for r in rows:
        if r.get('computed_quantity') is None: continue
        start, end = stamp(r['time_usage_started']), stamp(r['time_usage_ended'])
        if end - start == timedelta(hours=1): buckets[key(r)].add(start.hour)
    return {k for k, hours in buckets.items() if hours == set(range(24))}


def delta(current, previous):
    d = current - previous
    sign = '+' if d > 0 else ''
    if previous == 0: return f'{sign}{amount(d)} · 기준 0, 비율 제외'
    return f'{sign}{amount(d)} ({d / previous:+.1%})'


def cap_values(usage):
    caps = {}
    for k, quantity in usage.items():
        c, unit = category(k), k[2].lower()
        # Unrecognized billing units are displayed, never silently converted.
        valid = (c == 'cpu' and 'ocpu' in unit and 'hour' in unit) or (
            c == 'memory' and ('gb' in unit or 'gigabyte' in unit) and 'hour' in unit)
        if valid: caps[c] = caps.get(c, Decimal(0)) + quantity
        if c == 'object' and 'request' in k[1].lower() and unit in ('10k requests', 'requests'):
            caps['requests'] = caps.get('requests', Decimal(0)) + quantity * (10000 if unit == '10k requests' else 1)
    return caps


def budget_values(snapshot):
    values = cap_values(group_usage(snapshot['usage_month']))
    for name in ('block', 'object'):
        value = decimal(snapshot.get('capacity', {}).get(name))
        if value is not None and value >= 0: values[name] = value
    return values


def traffic_light(used, limit):
    if used is None: return '⚪ 미확인'
    ratio = used / limit
    return '🔴 한도 도달' if ratio >= 1 else '🟡 주의' if ratio >= Decimal('.8') else '🟢 여유'


def safety_status(costs, values):
    if any(v > 0 for v in costs.values()): return '🔴 비용 발생'
    if any(v >= LIMITS[k] for k, v in values.items()): return '🔴 한도 도달'
    if any(v >= LIMITS[k] * Decimal('.8') for k, v in values.items()): return '🟡 한도 접근'
    if not costs or any(k not in values for k in LIMITS): return '⚪ 일부 미확인'
    return '🟢 확인 항목 여유'


def assess(snapshot):
    alerts = []
    for currency, total in cost_totals(snapshot['cost_month']).items():
        if total > 0:
            # First positive amount, then a new cent bracket; no repeated identical alert.
            bracket = max(1, math.ceil(total * 100))
            alerts.append((f'cost:{currency}', bracket,
                           f'🔴 비용 발생 · {currency} {amount(total)}',
                           '무료 운영 목표를 벗어난 비용 항목을 Cost Analysis에서 확인하세요.'))
    usage = group_usage(snapshot['usage_month'])
    for c, used in budget_values(snapshot).items():
        ratio = used / LIMITS[c]
        if ratio >= Decimal('.8'):
            band = math.floor(ratio * 10)
            alerts.append((f'cap:{c}', band, f'{traffic_light(used, LIMITS[c])} · {BUDGET_NAMES[c]} {ratio:.1%}',
                           f'{amount(used)} / {amount(LIMITS[c])} 사용. 실제 무료 자격과 전체 사용량을 확인하세요.'))
    now, prev = group_usage(snapshot['comparison']), group_usage(snapshot['baseline'])
    complete = full_day_keys(snapshot['comparison']) & full_day_keys(snapshot['baseline'])
    for k in sorted(complete):
        c = category(k)
        # Absolute thresholds use the exact billing unit, in addition to a 2x increase.
        unit = k[2].lower()
        floor = Decimal('12') if c == 'cpu' and 'hour' in unit else (
            Decimal('72') if c == 'memory' and 'hour' in unit else (
            Decimal('1') if unit in ('gb', 'gigabytes', 'gb months') else None))
        if floor is not None and now[k] >= prev[k] * 2 and now[k] - prev[k] >= floor:
            identity = hashlib.sha256('|'.join(k).encode()).hexdigest()[:16]
            alerts.append((f"spike:{snapshot['comparison_date']}:{identity}", 1,
                           f'🟡 {metric_name(k)} 사용량 급증',
                           f'{delta(now[k], prev[k])} {k[2]} · 24개 시간 구간이 있는 날짜끼리 비교'))
    return alerts


def header(title):
    return {'type': 'header', 'text': {'type': 'plain_text', 'text': title[:150]}}


def section(text):
    return {'type': 'section', 'text': {'type': 'mrkdwn', 'text': text[:2900]}}


def links():
    return link_row([('비용·사용량 보기', COST_URL), ('점검 실행 기록', RUN_URL)])


def link_row(items):
    # URL buttons still require an interaction acknowledgement. Static links do not.
    return {'type':'context', 'elements':[{'type':'mrkdwn',
            'text':' · '.join(f'<{escaped(url)}|{escaped(label)}>' for label,url in items)}]}


def daily_message(s, test=False):
    usage, costs = group_usage(s['usage_month']), cost_totals(s['cost_month'])
    caps = budget_values(s)
    status = safety_status(costs, caps)
    blocks = [header(('🧪 [시험 전송] ' if test else '📊 ') + 'Agent Wiki · 비용과 사용량'),
              {'type': 'section', 'fields': [
                  {'type': 'mrkdwn', 'text': f"*이번 달 비용*\n{money(costs)}"},
                  {'type': 'mrkdwn', 'text': f"*판정 · 확인된 항목 기준*\n{status}"}]},
              {'type': 'divider'}, section('*사용량 / 기준 한도*')]
    fields = []
    for c in ('cpu', 'memory', 'block', 'object', 'requests'):
        used = caps.get(c)
        quantity = (f'{amount(used)} / {amount(LIMITS[c])} {BUDGET_UNITS[c]} · *{used/LIMITS[c]:.1%}*'
                    if used is not None else f'미집계 / 기준 {amount(LIMITS[c])} {BUDGET_UNITS[c]}')
        fields.append({'type':'mrkdwn', 'text':f'*{BUDGET_NAMES[c]}*\n{traffic_light(used, LIMITS[c])} · {quantity}'})
    for i in range(0, len(fields), 2): blocks.append({'type':'section', 'fields':fields[i:i+2]})
    blocks.append({'type':'context', 'elements':[{'type':'mrkdwn','text':
        '🟢 80% 미만 · 🟡 80% 이상 · 🔴 100% 이상/비용 발생 · ⚪ 미확인\n'
        'A1은 보수적 월 예산. 볼륨은 Osaka 루트 구획, 원문은 Wiki Standard 버킷의 근사 용량.'}]})
    blocks.append({'type':'divider'})
    current, before = group_usage(s['comparison']), group_usage(s['baseline'])
    complete = full_day_keys(s['comparison']) & full_day_keys(s['baseline'])
    extra = {k:q for k,q in usage.items() if not cap_values({k:q})}
    ordered = sorted(extra, key=lambda k: (list(LABELS).index(category(k)), k))
    fields = []
    for k in ordered[:6]:
        trend = ('\n증감 ' + delta(current[k], before[k])) if k in complete else ''
        fields.append({'type':'mrkdwn', 'text': f'*{escaped(metric_name(k))}*\n월 {escaped(display_quantity(usage[k],k[2]))}{escaped(trend)}'})
    if fields:
        blocks.append(section('*월 누적 참고 · GB·월은 현재 용량이 아님*'))
        for i in range(0, len(fields), 2): blocks.append({'type':'section', 'fields':fields[i:i+2]})

    if len(ordered)>6: blocks.append(section(f'그 외 {len(ordered)-6}개 항목은 OCI에서 확인'))
    if complete:
        comparison = f"증감: {s['comparison_date']} ↔ {s['baseline_date']} (UTC), 24시간 자료가 있는 항목만 비교"
    else: comparison = '증감 비교 대기 · 비교할 이틀의 시간별 자료가 아직 부족해요.'
    blocks += [{'type':'divider'}, section(f"*어제 {s['yesterday_date']} · 잠정*  {money(cost_totals(s['yesterday_cost']))}\n{comparison}"),
               {'type':'context', 'elements':[{'type':'mrkdwn','text':
                f"조회 {s['checked_at']} · 집계 날짜 UTC · 최대 48시간 지연\n미집계는 0이 아니며, 녹색은 표시한 기준의 여유이며 전체 과금 0을 보장하지 않습니다."}]}, links()]
    return {'text': f"{'[시험 전송] ' if test else ''}Agent Wiki 비용·사용량: {money(costs)} · {status}", 'blocks':blocks}


def alert_message(alerts, checked_at, test=False):
    blocks = [header(('🧪 [테스트] ' if test else '⚠️ ') + 'Agent Wiki · 비용·사용량 확인 필요')]
    for _, _, title, detail in alerts[:8]: blocks.append(section(f'*{escaped(title)}*\n{escaped(detail)}'))
    blocks += [section('같은 값은 반복 알리지 않습니다. 비용·사용량 집계에 지연이 있으므로 실시간 차단 기능은 아닙니다.'),
               {'type': 'context', 'elements': [{'type': 'mrkdwn', 'text': '조회 '+checked_at}]}, links()]
    return {'text': ('[테스트] ' if test else '') + 'Agent Wiki 비용·사용량 이상 '+str(len(alerts))+'건', 'blocks': blocks}


def send(payload):
    url = os.environ['SLACK_WEBHOOK_URL']
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != 'hooks.slack.com' or not parsed.path.startswith('/services/'):
        raise ValueError('Invalid webhook host')
    request = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode(),
                                     headers={'Content-Type': 'application/json'}, method='POST')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.read().strip() != b'ok': raise RuntimeError('Slack rejected message')
                return
        except urllib.error.HTTPError as error:
            if error.code != 429 and error.code < 500: raise RuntimeError(f'Slack HTTP {error.code}') from None
            delay = min(30, max(1, int(error.headers.get('Retry-After', '3'))))
        except (urllib.error.URLError, TimeoutError): delay = 3 * (attempt + 1)
        if attempt == 2: raise RuntimeError('Slack delivery failed; checkpoint was not advanced') from None
        time.sleep(delay)


def fetch_snapshot(client, tenancy, now):
    import oci
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = midnight + timedelta(days=1)
    def fetch(kind, start, finish, granularity):
        request = oci.usage_api.models.RequestSummarizedUsagesDetails(
            tenant_id=tenancy, time_usage_started=start, time_usage_ended=finish,
            granularity=granularity, query_type=kind, group_by=['service', 'skuName', 'unit'])
        rows = []
        page = None
        while True:
            options = {'page': page} if page else {}
            response = client.request_summarized_usages(request, **options)
            rows += [oci.util.to_dict(item) for item in response.data.items]
            page = response.headers.get('opc-next-page')
            if not page: return rows
    month = midnight.replace(day=1)
    comparison, baseline = midnight - timedelta(days=3), midnight - timedelta(days=4)
    yesterday = midnight - timedelta(days=1)
    return {'month': month.strftime('%Y-%m'), 'checked_at': now.astimezone(timezone(timedelta(hours=9))).strftime('%m/%d %H:%M KST'),
            'comparison_date': comparison.date().isoformat(), 'baseline_date': baseline.date().isoformat(),
            'yesterday_date': yesterday.date().isoformat(),
            'cost_month': fetch('COST', month, end, 'DAILY'),
            'usage_month': fetch('USAGE', month, end, 'DAILY'),
            'yesterday_cost': fetch('COST', yesterday, midnight, 'HOURLY'),
            'yesterday': fetch('USAGE', yesterday, midnight, 'HOURLY'),
            'comparison': fetch('USAGE', comparison, comparison + timedelta(days=1), 'HOURLY'),
            'baseline': fetch('USAGE', baseline, baseline + timedelta(days=1), 'HOURLY')}


def fetch_capacity(config, namespace, bucket):
    """Read sizes only: never read objects or grant resource lifecycle access."""
    import oci
    values = {}
    try:
        client = oci.core.BlockstorageClient(config, retry_strategy=oci.retry.DEFAULT_RETRY_STRATEGY)
        volumes = oci.pagination.list_call_get_all_results(client.list_volumes, compartment_id=config['tenancy']).data
        boots = oci.pagination.list_call_get_all_results(client.list_boot_volumes, compartment_id=config['tenancy']).data
        sizes = [v.size_in_gbs for v in volumes + boots if v.lifecycle_state != 'TERMINATED']
        if any(v is None for v in sizes): raise ValueError('Missing volume size')
        values['block'] = str(sum(sizes))
    except Exception:
        print('Volume capacity unavailable; not treated as zero.')
    try:
        client = oci.object_storage.ObjectStorageClient(config, retry_strategy=oci.retry.DEFAULT_RETRY_STRATEGY)
        data = client.get_bucket(namespace, bucket, fields=['approximateSize']).data
        if data.storage_tier != 'Standard' or data.approximate_size is None:
            raise ValueError('Unsupported tier or missing bucket size')
        # Keep binary bytes conversion explicit; billing GB-month quantities are not sizes.
        values['object'] = str(Decimal(data.approximate_size) / Decimal(1024**3))
    except Exception:
        print('Object capacity unavailable; not treated as zero.')
    return values


class Checkpoint:
    def __init__(self, client, namespace, bucket):
        self.client, self.namespace, self.bucket = client, namespace, bucket
        self.etag = None
        self.missing = False

    def read(self):
        import oci
        try:
            r = self.client.get_object(self.namespace, self.bucket, STATE_KEY)
            self.etag = r.headers['etag']
            return json.loads(r.data.content)
        except oci.exceptions.ServiceError as e:
            if e.status == 404 and e.code == 'ObjectNotFound':
                self.missing = True
                return {}
            raise  # Authorization, bucket errors and outage must not masquerade as empty state.

    def write(self, state):
        condition = {'if_none_match': '*'} if self.missing else {'if_match': self.etag}
        r = self.client.put_object(self.namespace, self.bucket, STATE_KEY,
                                  json.dumps(state).encode(), content_type='application/json', **condition)
        self.etag, self.missing = r.headers['etag'], False


def run(mode, snapshot, state, save, deliver=send):
    month = snapshot['month']
    notified = state.setdefault('alerts', {}).setdefault(month, {})
    new = [a for a in assess(snapshot) if a[1] > notified.get(a[0], 0)]
    if new:
        deliver(alert_message(new, snapshot['checked_at']))
        for identity, level, _, _ in new: notified[identity] = level
        save(state)
    day = snapshot['checked_at'][:5]
    if mode == 'daily' and state.get('daily') != f'{month}:{day}':
        deliver(daily_message(snapshot))
        state['daily'] = f'{month}:{day}'
        save(state)
    state['last_success'] = snapshot['checked_at']
    state['alerts'] = {k:v for k,v in state['alerts'].items() if k == month}
    save(state)
    print(f'Cost check completed: {len(new)} new alerts; mode={mode}.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['check', 'daily', 'preview', 'sample'], default='preview')
    args = parser.parse_args()
    import oci
    config = json.loads(os.environ['OCI_COST_CONFIG'])
    retry = oci.retry.DEFAULT_RETRY_STRATEGY
    client = oci.usage_api.UsageapiClient(config, retry_strategy=retry, timeout=(10, 60))
    snapshot = fetch_snapshot(client, config['tenancy'], datetime.now(UTC))
    snapshot['capacity'] = fetch_capacity(config, os.environ['OCI_COST_NAMESPACE'], os.environ['OCI_COST_BUCKET'])
    if args.mode == 'sample':
        send(daily_message(snapshot, test=True))
        print('Sample cost summary delivered; notification checkpoint unchanged.')
        print('Capacity fields:', ', '.join(sorted(snapshot['capacity'])) or 'unavailable')
        return
    if args.mode == 'preview':
        # No raw resource IDs or credentials in the preview, only aggregate card fields.
        print(json.dumps(daily_message(snapshot), ensure_ascii=False, indent=2))
        return
    store = Checkpoint(oci.object_storage.ObjectStorageClient(config, retry_strategy=retry),
                       os.environ['OCI_COST_NAMESPACE'], os.environ['OCI_COST_BUCKET'])
    state = store.read()
    run(args.mode, snapshot, state, store.write)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        # SDK exceptions may contain URLs or signed request metadata; never print them.
        print(f'Cost monitor failed ({type(error).__name__}); state was not marked successful.', file=sys.stderr)
        try:
            if '--mode' in sys.argv and sys.argv[sys.argv.index('--mode')+1] != 'preview':
                send({'text': '⚠️ Agent Wiki · 비용 점검 실패', 'blocks': [
                    header('⚠️ 비용 점검 실패'),
                    section('비용·사용량을 확인하지 못했어요. 정상 또는 0원으로 처리하지 않습니다.'),
                    link_row([('점검 기록',RUN_URL)])]})
        except Exception: print('Slack failure notification also failed.', file=sys.stderr)
        sys.exit(1)
