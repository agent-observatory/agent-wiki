#!/bin/bash
# Install management plane without binding application ingress or starting PostgreSQL.
set -euo pipefail
[[ $EUID == 0 ]] || exit 1
root=$(cd "$(dirname "$0")/.." && pwd)
source "$root/infra/k3s/versions.env"
mountpoint -q /srv/agent-wiki/data
install -d -m 700 /etc/rancher/k3s
install -m 600 "$root/infra/k3s/config.yaml" /etc/rancher/k3s/config.yaml
install -d -m 755 /etc/systemd/system/k3s.service.d
cat > /etc/systemd/system/k3s.service.d/mount.conf <<'UNIT'
[Unit]
RequiresMountsFor=/srv/agent-wiki/data
After=network-online.target netfilter-persistent.service
[Service]
ExecStartPre=/usr/local/sbin/agent-wiki-k3s-network
UNIT
# OCI's base image rejects forwarding; allow only this node's private Pod CIDR.
cat > /usr/local/sbin/agent-wiki-k3s-network <<'NETWORK'
#!/bin/bash
set -euo pipefail
for direction in -s -d; do
 iptables -C FORWARD "$direction" 10.52.0.0/16 -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 "$direction" 10.52.0.0/16 -j ACCEPT
 iptables -C INPUT "$direction" 10.52.0.0/16 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 "$direction" 10.52.0.0/16 -j ACCEPT
done
NETWORK
chmod 755 /usr/local/sbin/agent-wiki-k3s-network
/usr/local/sbin/agent-wiki-k3s-network
# Preserve IMDS access for OCI instance-principal authentication in API/Worker Pods.
# No new OCI ingress rules: Kubernetes control ports remain blocked at the VCN.
# Never persist container runtime DNAT/policy chains; K3s reconstructs them at boot.
# Remove old Docker/Kubernetes snapshots while preserving OCI host/IMDS rules.
python3 - <<'PYNETWORK'
from pathlib import Path
import re,subprocess
p=Path('/etc/iptables/rules.v4')
if p.exists():
 lines=[s for s in p.read_text().splitlines() if not re.search(r'DOCKER|docker0|br-[a-f0-9]+|KUBE-|CNI-|K3S-|FLANNEL|flannel',s)]
 clean='\n'.join(lines)+'\n'
 subprocess.run(['iptables-restore','--test'],input=clean,text=True,check=True)
 p.write_text(clean)
PYNETWORK
curl -fsSL https://get.k3s.io -o /tmp/agent-wiki-install-k3s.sh
INSTALL_K3S_VERSION="$K3S_VERSION" INSTALL_K3S_EXEC=server sh /tmp/agent-wiki-install-k3s.sh
systemctl daemon-reload
systemctl start k3s
for attempt in $(seq 1 60); do
 k3s kubectl get node agent-wiki-vm >/dev/null 2>&1 && break
 sleep 2
done
k3s kubectl wait --for=condition=Ready node/agent-wiki-vm --timeout=180s
k3s kubectl apply --server-side -f "https://github.com/cert-manager/cert-manager/releases/download/$CERT_MANAGER_VERSION/cert-manager.yaml"
k3s kubectl -n cert-manager set resources deployment --all --requests=cpu=20m,memory=32Mi --limits=cpu=500m,memory=256Mi
for deployment in cert-manager cert-manager-cainjector cert-manager-webhook; do
 k3s kubectl -n cert-manager rollout status deployment/"$deployment" --timeout=180s
done
printf 'K3s control plane ready; application cutover has not started.\n'
