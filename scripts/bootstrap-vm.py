#!/usr/bin/env python3
"""Migrate the existing, initialized Wiki VM to K3s. Secrets and DB stay on the VM."""
import argparse,ipaddress,json,re,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--image',required=True);a=p.parse_args()
if not re.fullmatch('[a-f0-9]{40}',a.image):raise SystemExit('Expected deployed Git SHA')
root=Path(__file__).resolve().parents[1]
state=json.loads(subprocess.check_output(['/tmp/wiki-tools/terraform','-chdir='+str(root/'infra/terraform'),'output','-json']))
host=str(ipaddress.ip_address(state['public_ip']['value']))
opts=['-i',str(Path.home()/'.ssh/agent_wiki_deploy'),'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(root/'.runtime/deploy/known_hosts')]
ssh=['ssh',*opts,'ubuntu@'+host];scp=['scp',*opts]
def run(cmd):subprocess.run(ssh+[cmd],check=True)
run('test -f /opt/agent-wiki/api.env && sudo test -f /srv/agent-wiki/data/postgres/PG_VERSION && test ! -f /opt/agent-wiki/.k3s-active')
run('mkdir -p /opt/agent-wiki/k3s-migration/infra /opt/agent-wiki/k3s-migration/scripts')
subprocess.run(scp+['-r',str(root/'infra/k3s'),'ubuntu@'+host+':/opt/agent-wiki/k3s-migration/infra/'],check=True)
names=['install-k3s.sh','cutover-k3s.sh','deploy-k3s.sh','render-k3s.py','k3s-secrets.py','configure-k3s-logs.sh']
subprocess.run(scp+[str(root/'scripts'/x) for x in names]+['ubuntu@'+host+':/opt/agent-wiki/k3s-migration/scripts/'],check=True)
run('sudo bash /opt/agent-wiki/k3s-migration/scripts/install-k3s.sh')
run('sudo bash /opt/agent-wiki/k3s-migration/scripts/cutover-k3s.sh '+a.image)
print('K3s cutover finished. Verify public HTTPS, DB TLS, Collector, logs and the next Actions deployment.')
