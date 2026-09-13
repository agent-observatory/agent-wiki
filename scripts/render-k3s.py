#!/usr/bin/env python3
"""Render public Kubernetes configuration. Secrets are installed separately on the VM."""
import argparse,json,re,copy
from pathlib import Path

def render(image,domain):
 if not re.fullmatch('[a-f0-9]{40}',image): raise ValueError('Expected immutable Git SHA')
 if not re.fullmatch('[a-z0-9-]+\\.duckdns\\.org',domain): raise ValueError('Unexpected domain')
 ns='agent-wiki'
 def obj(kind,name,spec=None,api='v1',**extra):
  d={'apiVersion':api,'kind':kind,'metadata':{'name':name,'namespace':ns},**extra}
  if spec is not None:d['spec']=spec
  return d
 def service(name,port):return obj('Service',name,{'selector':{'app':name},'ports':[{'name':'tcp','port':port,'targetPort':port}]})
 ca={'name':'db-ca','hostPath':{'path':'/srv/agent-wiki/data/tls/ca.crt','type':'File'}}
 camount={'name':'db-ca','mountPath':'/run/wiki-ca.crt','readOnly':True}
 def pod(name,command=None,port=None):
  c={'name':name,'image':f'ghcr.io/agent-observatory/{name}:{image}','imagePullPolicy':'IfNotPresent',
     'resources':{'requests':{'cpu':'100m','memory':'256Mi'},'limits':{'cpu':'1500m','memory':'2Gi'}},
     'env':[{'name':'IMAGE_TAG','value':image},{'name':'SERVICE_NAME','value':name}],
     'securityContext':{'allowPrivilegeEscalation':False,'capabilities':{'drop':['ALL']}}}
  if command:c['command']=command
  if port:c['ports']=[{'containerPort':port}]
  s={'automountServiceAccountToken':False,'imagePullSecrets':[{'name':'ghcr'}],
     'securityContext':{'runAsUser':1000,'runAsGroup':1000,'runAsNonRoot':True,'seccompProfile':{'type':'RuntimeDefault'}},
     'terminationGracePeriodSeconds':45,'containers':[c]}
  if name!='agent-wiki-web':
   c['envFrom']=[{'secretRef':{'name':name+'-env'}}];c['volumeMounts']=[camount];s['volumes']=[ca]
  return s,c
 apps=[]
 for name,port in [('agent-wiki-api',3001),('agent-wiki-web',3000),('agent-wiki-worker',None)]:
  command=None if name.endswith('web') else ['node',f'dist/apps/{name}/src/server.js']
  spec,c=pod(name,command,port)
  if name.endswith('web'):
   c['env'] += [{'name':'NODE_ENV','value':'production'},{'name':'HOSTNAME','value':'0.0.0.0'},{'name':'INTERNAL_API_URL','value':'http://agent-wiki-api:3001'}]
  if port:
   health={'httpGet':{'path':'/readyz' if port==3001 else '/','port':port},'periodSeconds':5,'timeoutSeconds':3,'failureThreshold':3}
   c['readinessProbe']=health;c['startupProbe']={**health,'failureThreshold':60}
   c['lifecycle']={'preStop':{'exec':{'command':['node','-e','setTimeout(()=>{},5000)']}}}
  else:
   spec['terminationGracePeriodSeconds']=120;c['resources']['limits']['cpu']='1'
   c['livenessProbe']={'exec':{'command':['node','-e',"process.exit(Date.now()-Number(require('fs').readFileSync('/tmp/agent-wiki-worker-heartbeat','utf8'))<300000?0:1)"]},'initialDelaySeconds':60,'periodSeconds':30,'failureThreshold':3}
  strategy={'type':'Recreate'} if not port else {'type':'RollingUpdate','rollingUpdate':{'maxSurge':1,'maxUnavailable':0}}
  apps.append(obj('Deployment',name,{'replicas':1,'revisionHistoryLimit':2,'progressDeadlineSeconds':300,'strategy':strategy,'selector':{'matchLabels':{'app':name}},'template':{'metadata':{'labels':{'app':name}},'spec':spec}},'apps/v1'))
  if port:apps.append(service(name,port))
 dbname='agent-wiki-db'
 db=[obj('PersistentVolume','agent-wiki-db-data',{'capacity':{'storage':'20Gi'},'volumeMode':'Filesystem','accessModes':['ReadWriteOnce'],'persistentVolumeReclaimPolicy':'Retain','storageClassName':'','local':{'path':'/srv/agent-wiki/data/postgres'},'nodeAffinity':{'required':{'nodeSelectorTerms':[{'matchExpressions':[{'key':'kubernetes.io/hostname','operator':'In','values':['agent-wiki-vm']}]}]}}}),obj('PersistentVolumeClaim','agent-wiki-db-data',{'accessModes':['ReadWriteOnce'],'resources':{'requests':{'storage':'20Gi'}},'storageClassName':'','volumeName':'agent-wiki-db-data'}),service(dbname,5432)]
 db[0]['metadata'].pop('namespace')
 db.append(obj('ConfigMap','agent-wiki-postgres',data={'pg_hba.conf':Path(__file__).resolve().parents[1].joinpath('infra/k3s/pg_hba.conf').read_text()}))
 c={'name':dbname,'image':'postgres:17.9-bookworm','imagePullPolicy':'IfNotPresent','envFrom':[{'secretRef':{'name':'agent-wiki-db-env'}}],
 'args':['postgres','-c','ssl=on','-c','ssl_cert_file=/tls/server.crt','-c','ssl_key_file=/tls/server.key','-c','hba_file=/etc/postgresql/pg_hba.conf','-c','max_connections=60','-c','shared_buffers=512MB','-c','log_statement=none'],
 'ports':[{'containerPort':5432,'hostPort':5432}],
 'resources':{'requests':{'cpu':'250m','memory':'768Mi'},'limits':{'cpu':'1500m','memory':'3Gi'}},
 'volumeMounts':[{'name':'data','mountPath':'/var/lib/postgresql/data'},{'name':'tls','mountPath':'/tls','readOnly':True},{'name':'hba','mountPath':'/etc/postgresql','readOnly':True}],
 'readinessProbe':{'exec':{'command':['pg_isready','-U','wiki_owner','-d','agent_wiki']},'periodSeconds':5},
 'startupProbe':{'exec':{'command':['pg_isready','-U','wiki_owner','-d','agent_wiki']},'periodSeconds':5,'failureThreshold':60}}
 db.append(obj('StatefulSet',dbname,{'serviceName':dbname,'replicas':1,'selector':{'matchLabels':{'app':dbname}},'template':{'metadata':{'labels':{'app':dbname}},'spec':{'automountServiceAccountToken':False,'terminationGracePeriodSeconds':120,'containers':[c],'volumes':[{'name':'data','persistentVolumeClaim':{'claimName':'agent-wiki-db-data'}},{'name':'tls','hostPath':{'path':'/srv/agent-wiki/data/tls','type':'Directory'}},{'name':'hba','configMap':{'name':'agent-wiki-postgres'}}]}}},'apps/v1'))
 # Migration pod uses only the owner connection; output must never include Secret values.
 ms,mc=pod('agent-wiki-api',['node','dist/packages/core/src/migrate.js'])
 mc['envFrom']=[{'secretRef':{'name':'agent-wiki-migration-env'}}];ms['restartPolicy']='Never'
 migration=[obj('Job','agent-wiki-migrate-'+image[:12],{'backoffLimit':0,'activeDeadlineSeconds':180,'ttlSecondsAfterFinished':600,'template':{'metadata':{'labels':{'app':'agent-wiki-migrate'}},'spec':ms}},'batch/v1')]
 versions=dict(x.split('=',1) for x in Path(__file__).resolve().parents[1].joinpath('infra/k3s/versions.env').read_text().splitlines() if '=' in x)
 gateway=[{'apiVersion':'helm.cattle.io/v1','kind':'HelmChart','metadata':{'name':'agent-wiki-gateway','namespace':'kube-system'},'spec':{'chart':'traefik','repo':'https://traefik.github.io/charts','version':versions['TRAEFIK_CHART_VERSION'],'targetNamespace':'kube-system','valuesContent':json.dumps({'fullnameOverride':'agent-wiki-gateway','deployment':{'replicas':1},'service':{'type':'LoadBalancer','spec':{'externalTrafficPolicy':'Local'}},'resources':{'requests':{'cpu':'100m','memory':'64Mi'},'limits':{'cpu':'1','memory':'256Mi'}},'ingressClass':{'enabled':True,'isDefaultClass':False,'name':'traefik'},'log':{'level':'ERROR'},'accessLog':{'enabled':False},'providers':{'kubernetesCRD':{'enabled':True},'kubernetesIngress':{'enabled':True}}})}}]
 middleware=obj('Middleware','agent-wiki-headers',{'headers':{'contentTypeNosniff':True,'frameDeny':True,'referrerPolicy':'same-origin','stsSeconds':31536000}},'traefik.io/v1alpha1')
 redirect=obj('Middleware','agent-wiki-https',{'redirectScheme':{'scheme':'https','permanent':True}},'traefik.io/v1alpha1')
 ingress=obj('Ingress','agent-wiki',{'ingressClassName':'traefik','tls':[{'hosts':[domain],'secretName':'agent-wiki-tls'}],'rules':[{'host':domain,'http':{'paths':[{'path':path,'pathType':typ,'backend':{'service':{'name':name,'port':{'number':port}}}} for path,typ,name,port in [('/api','Prefix','agent-wiki-api',3001),('/readyz','Exact','agent-wiki-api',3001),('/healthz','Exact','agent-wiki-api',3001),('/','Prefix','agent-wiki-web',3000)]]}}]},'networking.k8s.io/v1')
 ingress['metadata']['annotations']={'traefik.ingress.kubernetes.io/router.middlewares':'agent-wiki-agent-wiki-https@kubernetescrd,agent-wiki-agent-wiki-headers@kubernetescrd','traefik.ingress.kubernetes.io/router.entrypoints':'websecure'}
 http_ingress=copy.deepcopy(ingress);http_ingress['metadata']['name']='agent-wiki-http';http_ingress['metadata']['annotations']['traefik.ingress.kubernetes.io/router.entrypoints']='web';http_ingress['spec'].pop('tls')
 web_ingress=copy.deepcopy(ingress);web_ingress['metadata']['name']='agent-wiki-web';web_ingress['metadata']['annotations']['traefik.ingress.kubernetes.io/router.priority']='10';web_ingress['spec']['rules'][0]['http']['paths']=ingress['spec']['rules'][0]['http']['paths'][-1:]
 ingress['metadata']['annotations']['traefik.ingress.kubernetes.io/router.priority']='100';ingress['spec']['rules'][0]['http']['paths']=ingress['spec']['rules'][0]['http']['paths'][:-1]
 issuer=obj('Issuer','agent-wiki-acme',{'acme':{'server':'https://acme-v02.api.letsencrypt.org/directory','privateKeySecretRef':{'name':'agent-wiki-acme-account'},'solvers':[{'http01':{'ingress':{'ingressClassName':'traefik'}}}]}},'cert-manager.io/v1')
 certificate=obj('Certificate','agent-wiki-tls',{'secretName':'agent-wiki-tls','dnsNames':[domain],'issuerRef':{'name':'agent-wiki-acme','kind':'Issuer'},'privateKey':{'algorithm':'ECDSA','size':256,'rotationPolicy':'Always'}},'cert-manager.io/v1')
 def sel(names):return {'podSelector':{'matchExpressions':[{'key':'app','operator':'In','values':names}]}}
 def ports(*items):return [{'protocol':proto,'port':port} for proto,port in items]
 def policy(name,selector,**rules):return obj('NetworkPolicy',name,{'podSelector':selector,'policyTypes':['Ingress','Egress'],**rules},'networking.k8s.io/v1')
 dns={'to':[{'namespaceSelector':{'matchLabels':{'kubernetes.io/metadata.name':'kube-system'}},'podSelector':{'matchLabels':{'k8s-app':'kube-dns'}}}],'ports':ports(('UDP',53),('TCP',53))}
 edge={'namespaceSelector':{'matchLabels':{'kubernetes.io/metadata.name':'kube-system'}},'podSelector':{'matchLabels':{'app.kubernetes.io/name':'traefik'}}}
 internet={'to':[{'ipBlock':{'cidr':'0.0.0.0/0','except':['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','169.254.0.0/16']}}],'ports':ports(('TCP',443))}
 imds={'to':[{'ipBlock':{'cidr':'169.254.169.254/32'}}],'ports':ports(('TCP',80))}
 todb={'to':[sel([dbname])],'ports':ports(('TCP',5432))}
 policies=[policy('default-deny',{},ingress=[],egress=[]),policy('web',{'matchLabels':{'app':'agent-wiki-web'}},ingress=[{'from':[edge],'ports':ports(('TCP',3000))}],egress=[dns,{'to':[sel(['agent-wiki-api'])],'ports':ports(('TCP',3001))}]),policy('api',{'matchLabels':{'app':'agent-wiki-api'}},ingress=[{'from':[edge,sel(['agent-wiki-web','agent-wiki-worker'])],'ports':ports(('TCP',3001))}],egress=[dns,todb,internet,imds]),policy('worker',{'matchLabels':{'app':'agent-wiki-worker'}},ingress=[],egress=[dns,todb,internet,imds,{'to':[sel(['agent-wiki-api'])],'ports':ports(('TCP',3001))}]),policy('migration',{'matchLabels':{'app':'agent-wiki-migrate'}},ingress=[],egress=[dns,todb]),policy('database',{'matchLabels':{'app':dbname}},ingress=[{'from':[sel(['agent-wiki-api','agent-wiki-worker','agent-wiki-migrate']),{'ipBlock':{'cidr':'0.0.0.0/0','except':['10.52.0.0/16']}}],'ports':ports(('TCP',5432))}],egress=[]),policy('acme-solver',{'matchLabels':{'acme.cert-manager.io/http01-solver':'true'}},ingress=[{'from':[edge],'ports':ports(('TCP',8089))}],egress=[dns])]
 return {'namespace':[{'apiVersion':'v1','kind':'Namespace','metadata':{'name':ns}}],'db':db,'apps':apps,'migration':migration,'gateway':gateway,'routing':[middleware,redirect,ingress,web_ingress,http_ingress],'certificate':[issuer,certificate],'network':policies}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--image',required=True);p.add_argument('--domain',required=True);p.add_argument('--out',required=True);a=p.parse_args()
 out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
 for name,items in render(a.image,a.domain).items():
  (out/(name+'.json')).write_text(json.dumps({'apiVersion':'v1','kind':'List','items':items},indent=2)+'\n')
 print('Rendered K3s public manifests')
