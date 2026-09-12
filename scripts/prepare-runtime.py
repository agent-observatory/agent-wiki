#!/usr/bin/env python3
"""Prepare private deployment files. No cloud mutation and no secret output."""
import argparse,json,secrets,shutil,subprocess,urllib.parse,re,os
os.umask(0o077)
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--host',required=True);p.add_argument('--image',required=True);args=p.parse_args()
if len(args.image)!=40 or any(c not in '0123456789abcdef' for c in args.image):raise SystemExit('Expected Git commit SHA')
env={}
for line in (root/'.env.local').read_text().splitlines():
 if '=' in line and not line.startswith('#'):
  k,v=line.split('=',1);env[k]=v.strip().strip('\"\'')
state=json.loads(subprocess.check_output(['/tmp/wiki-tools/terraform','-chdir='+str(root/'infra/terraform'),'output','-json']))
if state['public_ip']['value']!=args.host:raise SystemExit('Host does not match Terraform state')
for k in ['PG_OWNER_PASSWORD','PG_APP_PASSWORD','PG_ADMIN_PASSWORD']:env.setdefault(k,secrets.token_hex(24))
domain=env['DUCKDNS_DOMAIN'];domain=domain if '.' in domain else domain+'.duckdns.org'
if not re.fullmatch(r'[a-z0-9-]+\.duckdns\.org',domain):raise SystemExit('Invalid DuckDNS domain')
for k in ['PG_OWNER_PASSWORD','PG_APP_PASSWORD','PG_ADMIN_PASSWORD']:
 if not re.fullmatch(r'[a-f0-9]{48}',env[k]):raise SystemExit('Expected generated strong DB password for '+k)
out=root/'.runtime/deploy';out.mkdir(parents=True,exist_ok=True);out.chmod(0o700)
tls=out/'tls';tls.mkdir(exist_ok=True);tls.chmod(0o700)
def openssl(*args):subprocess.run(['openssl',*map(str,args)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
if not (tls/'ca.key').exists():
 openssl('req','-x509','-newkey','rsa:3072','-nodes','-keyout',tls/'ca.key','-out',tls/'ca.crt','-days','3650','-subj','/CN=Agent Wiki DB CA')
 openssl('req','-newkey','rsa:2048','-nodes','-keyout',tls/'server.key','-out',tls/'server.csr','-subj','/CN='+domain)
 (tls/'ext.cnf').write_text('subjectAltName=DNS:'+domain+',DNS:postgres,IP:'+args.host+'\n')
 openssl('x509','-req','-in',tls/'server.csr','-CA',tls/'ca.crt','-CAkey',tls/'ca.key','-CAcreateserial','-out',tls/'server.crt','-days','365','-extfile',tls/'ext.cnf')
for f in tls.iterdir():f.chmod(0o600)
def write_env(name,data):
 if any('\n' in v or '\r' in v for v in data.values()):raise SystemExit('Multiline env value not supported')
 file=out/name;file.write_text('\n'.join(k+'='+v for k,v in data.items())+'\n');file.chmod(0o600)
def dburl(user,pwd):return 'postgresql://'+user+':'+urllib.parse.quote(pwd,safe='')+'@postgres:5432/agent_wiki?sslmode=verify-full&sslrootcert=/run/wiki-ca.crt'
common={'DATABASE_URL':dburl('wiki_app',env['PG_APP_PASSWORD']),'NODE_ENV':'production','IMAGE_TAG':args.image,'SOURCE_STORAGE':'oci','OCI_NAMESPACE':state['namespace']['value'],'OCI_BUCKET':state['bucket']['value']}
write_env('api.env',{**common,**{k:env[k] for k in ['GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','OWNER_GITHUB_ID']},'APP_URL':'https://'+domain})
write_env('worker.env',{**common,'NVIDIA_API_KEY':env['NVIDIA_API_KEY']})
write_env('migration.env',{'MIGRATION_DATABASE_URL':dburl('wiki_owner',env['PG_OWNER_PASSWORD'])})
write_env('.env',{'DOMAIN':domain,'IMAGE_TAG':args.image,**{k:env[k] for k in ['PG_OWNER_PASSWORD','PG_APP_PASSWORD','PG_ADMIN_PASSWORD']}})
(out/'init-db.sql').write_text("CREATE ROLE wiki_app LOGIN PASSWORD '"+env['PG_APP_PASSWORD']+"';\nCREATE ROLE wiki_admin LOGIN BYPASSRLS PASSWORD '"+env['PG_ADMIN_PASSWORD']+"';\n");(out/'init-db.sql').chmod(0o600)
for name in ['compose.yaml','Caddyfile','pg_hba.conf']:shutil.copyfile(root/'infra/runtime'/name,out/name)
shutil.copyfile(root/'scripts/deploy.sh',out/'deploy.sh')
for f in out.iterdir():
 if f.is_file():f.chmod(0o600)
env.update(PG_ADMIN_HOST=domain,PG_ADMIN_PORT='5432',PG_ADMIN_DATABASE='agent_wiki',PG_ADMIN_USER='wiki_admin',PG_ADMIN_SSLMODE='verify-full',PG_ADMIN_SSLROOTCERT=str(tls/'ca.crt'))
(root/'.env.local').write_text('\n'.join(k+'='+v for k,v in env.items())+'\n');(root/'.env.local').chmod(0o600)
print('Private runtime files prepared in .runtime/deploy; DB connection saved to .env.local.')
