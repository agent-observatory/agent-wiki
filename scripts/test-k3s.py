import importlib.util,unittest,json,ipaddress
from pathlib import Path
s=importlib.util.spec_from_file_location('render',Path(__file__).with_name('render-k3s.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class RuntimeContract(unittest.TestCase):
 def setUp(self):self.r=m.render('a'*40,'example.duckdns.org')
 def test_images_are_immutable_and_no_cloud_balancer_for_apps(self):
  for d in self.r['apps']:
   if d['kind']=='Deployment':self.assertTrue(d['spec']['template']['spec']['containers'][0]['image'].endswith('a'*40))
   if d['kind']=='Service':self.assertNotIn('type',d['spec'])
 def test_no_double_writer_and_retained_local_disk(self):
  pv=self.r['db'][0];self.assertEqual(pv['spec']['persistentVolumeReclaimPolicy'],'Retain');self.assertEqual(pv['spec']['local']['path'],'/srv/agent-wiki/data/postgres')
  db=next(x for x in self.r['db'] if x['kind']=='StatefulSet');self.assertEqual(db['spec']['replicas'],1)
  worker=next(x for x in self.r['apps'] if x['metadata']['name']=='agent-wiki-worker');self.assertEqual(worker['spec']['strategy']['type'],'Recreate');self.assertEqual(worker['spec']['template']['spec']['terminationGracePeriodSeconds'],120)
 def test_web_has_no_database_or_cloud_egress(self):
  web=next(x for x in self.r['network'] if x['metadata']['name']=='web')
  self.assertEqual({p['port'] for e in web['spec']['egress'] for p in e['ports']},{53,3001})
  default=self.r['network'][0];self.assertEqual(default['spec']['ingress'],[]);self.assertEqual(default['spec']['egress'],[])
 def test_tls_and_http_are_separate_so_acme_can_route(self):
  routes=[x for x in self.r['routing'] if x['kind']=='Ingress']
  http=next(x for x in routes if x['metadata']['name']=='agent-wiki-http');self.assertNotIn('tls',http['spec'])
  self.assertEqual(http['metadata']['annotations']['traefik.ingress.kubernetes.io/router.entrypoints'],'web')
  api=next(x for x in routes if x['metadata']['name']=='agent-wiki');web=next(x for x in routes if x['metadata']['name']=='agent-wiki-web')
  self.assertIn('tls',api['spec']);self.assertIn('tls',web['spec'])
  self.assertGreater(int(api['metadata']['annotations']['traefik.ingress.kubernetes.io/router.priority']),int(web['metadata']['annotations']['traefik.ingress.kubernetes.io/router.priority']))
 def test_no_runtime_secrets_or_public_management_port(self):
  payload=json.dumps(self.r)
  self.assertNotIn('DATABASE_URL',payload);self.assertNotIn('nodePort',payload)
  db=next(x for x in self.r['db'] if x['kind']=='StatefulSet');self.assertEqual(db['spec']['template']['spec']['containers'][0]['ports'][0]['hostPort'],5432)
 def test_cidr_does_not_overlap_oci(self):
  vcn=ipaddress.ip_network('10.42.0.0/16')
  for cidr in ('10.52.0.0/16','10.53.0.0/16'):self.assertFalse(vcn.overlaps(ipaddress.ip_network(cidr)))
 def test_invalid_interpolation_rejected(self):
  with self.assertRaises(ValueError):m.render('latest','example.duckdns.org')
  with self.assertRaises(ValueError):m.render('a'*40,'example.duckdns.org; touch /tmp/x')
if __name__=='__main__':unittest.main()
