#!/bin/bash
# The existing rsyslog host service unwraps CRI stdout; OCI keeps its existing file source.
set -euo pipefail
[[ $EUID == 0 ]] || exit 1
# rsyslog drops to syslog; kubelet creates root-owned CRI logs.
command -v setfacl >/dev/null || apt-get install -y acl >/dev/null
install -d -m 750 /var/log/pods
setfacl -R -m u:syslog:rX /var/log/pods
find /var/log/pods -type d -exec setfacl -m d:u:syslog:rx {} +
cat > /etc/rsyslog.d/31-agent-wiki-k3s.conf <<'RSYSLOG'
module(load="imfile")
template(name="WikiCRIJSON" type="string" string="%$!wiki_payload%\n")
ruleset(name="WikiCRI") {
 if re_match($msg, "^[^ ]+ (stdout|stderr) F ") then {
  set $!wiki_payload = re_extract($msg, "^[^ ]+ (stdout|stderr) F (.*)\$", 0, 2, "");
  if ($!wiki_payload contains '"severityNumber":' and $!wiki_payload contains '"eventName":') then {
   action(type="omfile" file="/var/log/agent-wiki/events.jsonl" template="WikiCRIJSON" fileCreateMode="0640")
  }
 }
 stop
}
input(type="imfile" File="/var/log/pods/agent-wiki_*/agent-wiki-api/*.log" Tag="wiki-cri" PersistStateInterval="1" Ruleset="WikiCRI")
input(type="imfile" File="/var/log/pods/agent-wiki_*/agent-wiki-worker/*.log" Tag="wiki-cri" PersistStateInterval="1" Ruleset="WikiCRI")
RSYSLOG
if [[ -f /etc/apparmor.d/usr.sbin.rsyslogd ]]; then
 grep -qF '/var/log/pods/** r,' /etc/apparmor.d/rsyslog.d/agent-wiki 2>/dev/null || printf '/var/log/pods/** r,\n' >> /etc/apparmor.d/rsyslog.d/agent-wiki
 apparmor_parser -r /etc/apparmor.d/usr.sbin.rsyslogd
fi
rsyslogd -N1
systemctl restart rsyslog
