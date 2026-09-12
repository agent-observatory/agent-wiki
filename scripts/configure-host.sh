#!/bin/bash
# Reapply host prerequisites after cloud-init interruption or an instance reboot.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root'; exit 1; }
install -d -o syslog -g adm -m 0750 /var/log/agent-wiki
cat > /etc/rsyslog.d/30-agent-wiki.conf <<'RSYSLOG'
input(type="imuxsock" Socket="/run/wiki-syslog.sock" CreatePath="on")
template(name="WikiJSON" type="string" string="%msg%\n")
if $programname startswith 'agent-wiki-' then {
  if ($msg contains '"severityNumber":' and $msg contains '"eventName":') then {
    action(type="omfile" file="/var/log/agent-wiki/events.jsonl" template="WikiJSON" fileCreateMode="0640")
  }
  action(type="omfile" file="/var/log/agent-wiki/apps.jsonl" template="WikiJSON" fileCreateMode="0640")
  stop
}
RSYSLOG
if [[ -f /etc/apparmor.d/usr.sbin.rsyslogd ]]; then
  install -d -m 0755 /etc/apparmor.d/rsyslog.d
  printf '/run/wiki-syslog.sock rw,\n' > /etc/apparmor.d/rsyslog.d/agent-wiki
fi
rsyslogd -N1
systemctl restart rsyslog
test -S /run/wiki-syslog.sock
install -m 644 "$(dirname "$0")/agent-wiki.service" /etc/systemd/system/agent-wiki.service
systemctl daemon-reload
systemctl enable agent-wiki
echo 'Host log socket and boot service configured.'
