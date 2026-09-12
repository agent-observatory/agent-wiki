#!/bin/bash
# Reapply host prerequisites after cloud-init interruption or an instance reboot.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root'; exit 1; }
install -d -o syslog -g adm -m 0750 /var/log/agent-wiki
if [[ -f /etc/apparmor.d/usr.sbin.rsyslogd ]]; then
  install -d -m 0755 /etc/apparmor.d/rsyslog.d
  printf '/run/wiki-syslog.sock rw,\n' > /etc/apparmor.d/rsyslog.d/agent-wiki
fi
rsyslogd -N1
systemctl restart rsyslog
test -S /run/wiki-syslog.sock
systemctl daemon-reload
systemctl enable agent-wiki
echo 'Host log socket and boot service configured.'
