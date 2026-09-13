import copy
import unittest
from datetime import datetime,timedelta,timezone
from error_report import extract,run,message

NOW=datetime(2026,9,12,9,tzinfo=timezone.utc)

def event(identity='e1',severity=17,code='SERVER_ERROR'):
    return {'logContent':{'time':NOW.isoformat(),'id':identity,'data':{
        'timestamp':NOW.isoformat(),'severityNumber':severity,'eventName':'api_server_error',
        'body':'sensitive-prompt-must-never-appear',
        'resource':{'service.name':'agent-wiki-api'},
        'attributes':{'agent_wiki.event_id':identity,'agent_wiki.error_code':code,
                      'agent_wiki.request_id':'req-123'}}}}

class ErrorTests(unittest.TestCase):
    def test_real_api_and_worker_errors_use_compact_delivery_format(self):
        for service,event_name,code,title in [
            ('agent-wiki-api','api_server_error','SERVER_ERROR','API 요청 처리 오류'),
            ('agent-wiki-worker','worker_unhandled_error','UNSPECIFIED','애플리케이션 오류'),
        ]:
            with self.subTest(service=service):
                item=event(code=code)
                data=item['logContent']['data']
                data['eventName']=event_name
                data['resource']['service.name']=service
                data['attributes']['agent_wiki.job_id']='job-123'
                sent=[]
                run([item],{},lambda _:None,NOW,'https://example.com/logs',sent.append)
                self.assertEqual(len(sent),1)
                payload=sent[0]
                self.assertEqual(len(payload['blocks']),2)
                summary=payload['blocks'][0]['text']['text']
                self.assertIn(title,summary)
                self.assertIn(code,summary)
                self.assertIn('1건',summary)
                self.assertEqual(len(summary.splitlines()),2)
                self.assertFalse(any('fields' in block for block in payload['blocks']))
                for removed in ('req-123','job-123','5분마다','로그를 확인하세요','KST','시험 알림'):
                    self.assertNotIn(removed,str(payload))
                self.assertIn('오류 로그',str(payload['blocks'][1]))
                self.assertIn('점검 기록',str(payload['blocks'][1]))

    def test_warn_and_info_do_not_notify(self):
        self.assertIsNone(extract(event(severity=9)))
        self.assertIsNone(extract(event(severity=13)))

    def test_oci_flattened_json_preserves_service_code_and_event_identity(self):
        original=event();flat=copy.deepcopy(original);data=flat['logContent']['data']
        for prefix in ('resource','attributes'):
            data.update({prefix+'.'+k:v for k,v in data.pop(prefix).items()})
        flat['logContent']['id']='different-ingestion-id'
        self.assertEqual(extract(original),extract(flat))

    def test_duplicates_grouped_and_secret_body_excluded(self):
        sent=[];saved=[];state={}
        run([event(),event(),event('e2')],state,lambda s:saved.append(copy.deepcopy(s)),NOW,'https://example.com',sent.append)
        self.assertEqual(len(sent),1)
        self.assertIn('2건',sent[0]['text'])
        self.assertNotIn('sensitive-prompt',str(sent))
        self.assertIn('API 요청 처리 오류',str(sent))
        self.assertNotIn('ocid1.',str(sent))

    def test_repeat_errors_suppressed_and_realert_after_hour(self):
        sent=[];state={}
        run([event()],state,lambda _:None,NOW,'https://example.com',sent.append)
        run([event(),event('e2')],state,lambda _:None,NOW+timedelta(minutes=5),'https://example.com',sent.append)
        self.assertEqual(len(sent),1)
        run([event('e3')],state,lambda _:None,NOW+timedelta(hours=1),'https://example.com',sent.append)
        self.assertEqual(len(sent),2)

    def test_failed_send_is_not_checkpointed(self):
        saved=[];state={}
        def fail(_):raise RuntimeError('synthetic')
        with self.assertRaises(RuntimeError):run([event()],state,saved.append,NOW,'https://example.com',fail)
        self.assertEqual(saved,[])
        self.assertNotIn('seen',state['errors'])

    def test_existing_cost_checkpoint_is_preserved(self):
        state={'alerts':{'2026-09':{'cost:SGD':1}},'daily':'2026-09:09/12'}
        run([],state,lambda _:None,NOW,'https://example.com')
        self.assertEqual(state['alerts'],{'2026-09':{'cost:SGD':1}})
        self.assertEqual(state['daily'],'2026-09:09/12')

    def test_switch_ignores_old_errors_and_idle_or_recovery_never_sends(self):
        sent=[];state={'errors':{'started_at':NOW.isoformat()}}
        old=event('old');old['logContent']['time']=(NOW-timedelta(minutes=1)).isoformat()
        reset={'type':'RESET','severity':'ERROR'}
        run([old, reset, {'type':'FIRING_TO_OK'}, event(severity=9)],state,lambda _:None,NOW,'https://example.com',sent.append)
        self.assertEqual(sent,[])
        run([event('new')],state,lambda _:None,NOW+timedelta(minutes=5),'https://example.com',sent.append)
        self.assertEqual(len(sent),1)
        run([],state,lambda _:None,NOW+timedelta(minutes=10),'https://example.com',sent.append)
        self.assertEqual(len(sent),1)

    def test_invalid_identity_prevents_silent_loss(self):
        e=event(identity='');e['logContent']['id']=''
        with self.assertRaises(ValueError):extract(e)

if __name__=='__main__':unittest.main()
