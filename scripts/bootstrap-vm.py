#!/usr/bin/env python3
"""Bootstrap the VM recorded in local Terraform state; keep credentials out of output."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request

os.umask(0o077)
root = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--image', required=True)
args = p.parse_args()
state = json.loads(subprocess.check_output(['/tmp/wiki-tools/terraform', '-chdir='+str(root/'infra/terraform'), 'output', '-json']))
host = str(ipaddress.ip_address(state['public_ip']['value']))
subprocess.run(['python3', str(root/'scripts/prepare-runtime.py'), '--host', host, '--image', args.image], check=True)
key = Path.home()/'.ssh/agent_wiki_deploy'
known = root/'.runtime/deploy/known_hosts'
# Initial host-key acceptance is scoped to this dedicated instance and pinned thereafter.
ssh = ['ssh', '-i', str(key), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile='+str(known), 'ubuntu@'+host]
subprocess.run(ssh+['sudo cloud-init status --wait'], check=True, timeout=900)
subprocess.run(ssh+['sudo /usr/local/sbin/wiki-mount && sudo chmod 755 /srv/agent-wiki/data/tls'], check=True, timeout=660)
scp = ['scp', '-i', str(key), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile='+str(known)]
private = root/'.runtime/deploy'
names = ['.env','api.env','worker.env','migration.env','init-db.sql','compose.yaml','Caddyfile','pg_hba.conf']
subprocess.run(scp+[str(private/n) for n in names]+['ubuntu@'+host+':/opt/agent-wiki/'], check=True)
# The CA signing key stays on the developer machine.
subprocess.run(scp+[str(private/'tls'/n) for n in ['server.crt','server.key','ca.crt']]+['ubuntu@'+host+':/opt/agent-wiki/'], check=True)
subprocess.run(ssh+['sudo install -o 999 -g 999 -m 600 /opt/agent-wiki/server.key /srv/agent-wiki/data/tls/server.key && sudo install -m 644 /opt/agent-wiki/server.crt /opt/agent-wiki/ca.crt /srv/agent-wiki/data/tls/ && sudo chown 999:999 /opt/agent-wiki/init-db.sql && sudo chmod 600 /opt/agent-wiki/init-db.sql && sudo chown -R 999:999 /srv/agent-wiki/data/postgres && rm /opt/agent-wiki/server.key /opt/agent-wiki/server.crt /opt/agent-wiki/ca.crt'], check=True)
env = {}
for line in (root/'.env.local').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1);env[k]=v.strip().strip('\"\'')
query = urllib.parse.urlencode({'domains':env['DUCKDNS_DOMAIN'].removesuffix('.duckdns.org'),'token':env['DUCKDNS_TOKEN'],'ip':host})
with urllib.request.urlopen('https://www.duckdns.org/update?'+query,timeout=30) as response:
    if response.read().strip()!=b'OK': raise SystemExit('DuckDNS update failed')
for name,value in {'DEPLOY_HOST':host, 'DEPLOY_KEY':key.read_text(), 'DEPLOY_KNOWN_HOSTS':known.read_text()}.items():
    subprocess.run(['gh','secret','set',name,'--repo','agent-observatory/agent-wiki'],input=value,text=True,check=True)
subprocess.run(['gh','variable','set','DEPLOY_ENABLED','--body','true','--repo','agent-observatory/agent-wiki'],check=True)
print('Runtime prepared, DNS updated and deployment secrets set. Dispatch ci.yml, then verify HTTPS, login and DB TLS.')
