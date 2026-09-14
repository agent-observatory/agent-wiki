import copy
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from cost_report import (assess, category, daily_message, full_day_keys, group_usage,
                         run, cost_totals, cap_values, traffic_light, budget_values, safety_status)


def row(q=1, currency='SGD', cost=0, service='Compute', sku='Compute - Ampere A1 - OCPU', unit='OCPU Hours', hour=0, day=8):
    t = datetime(2026, 9, day, hour, tzinfo=timezone.utc)
    return dict(service=service, sku_name=sku, unit=unit, computed_quantity=q,
                computed_amount=cost, currency=currency, time_usage_started=t.isoformat(),
                time_usage_ended=(t+timedelta(hours=1)).isoformat())


def snapshot():
    return dict(month='2026-09', checked_at='09/12 09:13 KST', yesterday_date='2026-09-11',
                comparison_date='2026-09-09', baseline_date='2026-09-08',
                cost_month=[row()], usage_month=[row(q=48)], yesterday_cost=[], yesterday=[],
                comparison=[row(q=1,hour=h,day=9) for h in range(24)],
                baseline=[row(q=1,hour=h) for h in range(24)])


class CostTests(unittest.TestCase):
    def test_missing_is_not_zero_and_currencies_are_not_added(self):
        self.assertEqual(cost_totals([row(cost=None)]), {})
        self.assertEqual(cost_totals([row(cost=1),row(cost=2,currency='USD')]),
                         {'SGD':Decimal(1),'USD':Decimal(2)})
        s=snapshot();s['usage_month']=[];s['cost_month']=[]
        self.assertIn('미집계',str(daily_message(s)))
        self.assertEqual(assess(s), [])

    def test_partial_days_and_new_skus_do_not_trigger_spike(self):
        s=snapshot();s['comparison']=[row(q=10,hour=h,day=9) for h in range(23)]
        self.assertEqual(full_day_keys(s['comparison']),set())
        self.assertFalse(assess(s))
        s['baseline']=[]
        self.assertFalse(assess(s))

    def test_units_are_separate_and_unknown_units_are_not_budgeted(self):
        self.assertEqual(len(group_usage([row(),row(unit='GB Hours')])),2)
        self.assertEqual(cap_values(group_usage([row(unit='GB Months')])),{})

    def test_spike_requires_ratio_and_absolute_growth(self):
        s=snapshot();s['comparison']=[row(q=2,hour=h,day=9) for h in range(24)]
        self.assertEqual(len(assess(s)),1)
        s['comparison']=[row(q=.002,hour=h,day=9) for h in range(24)]
        s['baseline']=[row(q=.001,hour=h) for h in range(24)]
        self.assertEqual(assess(s),[])

    def test_partial_month_cost_and_free_budget_thresholds(self):
        s=snapshot();s['cost_month']=[row(cost=.0001)];s['usage_month']=[row(q=1200)]
        self.assertEqual(len(assess(s)),2)

    def test_repeats_suppressed_and_higher_cost_realerts(self):
        s=snapshot();s['cost_month']=[row(cost=.01)]
        state={};saved=[];sent=[]
        save=lambda s:saved.append(copy.deepcopy(s))
        run('daily',s,state,save,sent.append);run('daily',s,state,save,sent.append)
        self.assertEqual(len(sent),2)  # anomaly + daily, not four
        s['cost_month']=[row(cost=.02)]
        run('check',s,state,save,sent.append)
        self.assertEqual(len(sent),3)

    def test_auto_falls_back_to_daily_summary_after_the_target_time(self):
        s=snapshot();s.update(daily_key='2026-09-12', daily_due=True)
        sent=[];state={}
        run('auto',s,state,lambda _:None,sent.append)
        self.assertEqual(len(sent),1)
        self.assertEqual(state['daily'],'2026-09-12')

    def test_auto_keeps_a_pre_target_check_quiet(self):
        s=snapshot();s.update(daily_key='2026-09-12', daily_due=False)
        sent=[]
        run('auto',s,{},lambda _:None,sent.append)
        self.assertEqual(sent,[])

    def test_delivery_failure_does_not_acknowledge(self):
        s=snapshot();s['cost_month']=[row(cost=1)];state={};saved=[]
        def fail(_):raise RuntimeError('synthetic network failure')
        with self.assertRaises(RuntimeError):run('daily',s,state,saved.append,fail)
        self.assertEqual(saved,[])
        self.assertEqual(state['alerts']['2026-09'],{})

    def test_month_rollover_resets_notified_cost(self):
        s=snapshot();s['cost_month']=[row(cost=1)];state={'alerts':{'2026-08':{'cost:SGD':999}}};sent=[]
        run('check',s,state,lambda _:None,sent.append)
        self.assertEqual(len(sent),1)
        self.assertNotIn('2026-08',state['alerts'])

    def test_traffic_light_boundaries_and_missing_values(self):
        self.assertEqual(traffic_light(None,Decimal(100)), '⚪ 미확인')
        self.assertEqual(traffic_light(Decimal(0),Decimal(100)), '🟢 여유')
        self.assertEqual(traffic_light(Decimal('79.9'),Decimal(100)), '🟢 여유')
        self.assertEqual(traffic_light(Decimal(80),Decimal(100)), '🟡 주의')
        self.assertEqual(traffic_light(Decimal(100),Decimal(100)), '🔴 한도 도달')
        self.assertEqual(traffic_light(Decimal(120),Decimal(100)), '🔴 한도 도달')

    def test_storage_uses_capacity_not_gb_months_and_requests_convert_once(self):
        s=snapshot();s['usage_month']=[row(q=3,service='Block Storage',sku='Block Volume - Free',unit='GB Months'),
            row(q=4,service='Object Storage',sku='Object Storage - Requests',unit='10K Requests')]
        s['capacity']={'block':'100','object':'2'}
        self.assertEqual(budget_values(s), {'requests':Decimal(40000),'block':Decimal(100),'object':Decimal(2)})
        self.assertEqual(len(assess(s)),1)
        del s['capacity'];self.assertNotIn('block',budget_values(s))
        self.assertIn('⚪ 미확인',str(daily_message(s)))

    def test_actual_charge_overrides_green_capacity(self):
        self.assertEqual(safety_status({'SGD':Decimal('.001')},{'cpu':Decimal(1)}), '🔴 비용 발생')
        self.assertEqual(safety_status({},{}), '⚪ 일부 미확인')

    def test_message_has_fallback_and_bounded_blocks(self):
        msg=daily_message(snapshot(),test=True)
        self.assertIn('[시험 전송]',msg['text'])
        self.assertLess(len(msg['blocks']),50)
        self.assertIn('UTC',str(msg))


if __name__=='__main__':unittest.main()
