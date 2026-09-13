#!/usr/bin/env python3
"""VM-only: load the existing private runtime without printing credentials."""
import base64,json,subprocess,sys
from pathlib import Path

def env(path):
 return {k:v.strip().strip('\"\'') for k,v in (line.split('=',1) for line in Path(path).read_text().splitlines() if '=' in line and not line.startswith('#'))}
def secret(name,values,typ='Opaque'):
 data={k:base64.b64encode(v.encode() if isinstance(v,str) else v).decode() for k,v in values.items()}
 subprocess.run(['k3s','kubectl','apply','-f','-'],input=json.dumps({'apiVersion':'v1','kind':'Secret','metadata':{'name':name,'namespace':'agent-wiki'},'type':typ,'data':data}),text=True,check=True,stdout=subprocess.DEVNULL)
root=Path('/opt/agent-wiki'); runtime=env(root/'.env')
for role,filename in [('api','api.env'),('worker','worker.env'),('migration','migration.env')]:secret('agent-wiki-'+role+'-env',env(root/filename))
secret('agent-wiki-db-env',{'POSTGRES_USER':'wiki_owner','POSTGRES_DB':'agent_wiki','POSTGRES_PASSWORD':runtime['PG_OWNER_PASSWORD']})
if len(sys.argv)>1:
 token=sys.stdin.readline().strip()
 if not token:raise SystemExit('Missing registry credential')
 secret('ghcr',{'.dockerconfigjson':json.dumps({'auths':{'ghcr.io':{'auth':base64.b64encode((sys.argv[1]+':'+token).encode()).decode()}}})},'kubernetes.io/dockerconfigjson')
# Reuse the valid Caddy certificate for an uninterrupted TLS handoff, only once.
if subprocess.run(['k3s','kubectl','-n','agent-wiki','get','secret','agent-wiki-tls'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
 domain=runtime['DOMAIN']
 certs=list(Path('/srv/agent-wiki/data/caddy').glob('**/certificates/*/'+domain+'/'+domain+'.crt'))
 if len(certs)!=1:raise SystemExit('Expected one existing domain certificate')
 cert=certs[0];key=cert.with_suffix('.key')
 secret('agent-wiki-tls',{'tls.crt':cert.read_bytes(),'tls.key':key.read_bytes()},'kubernetes.io/tls')
print('Existing runtime secrets installed; values withheld.')
