# Kubernetes remains inside the existing A1; no managed cluster or cloud LB.
locals {
  public_tcp_ports = toset([22, 80, 443, 5432])
  k3s_pod_cidr     = "10.52.0.0/16"
  k3s_service_cidr = "10.53.0.0/16"
}
output "k3s_network" {
  value = {
    pod_cidr     = local.k3s_pod_cidr
    service_cidr = local.k3s_service_cidr
  }
}
check "separate_k3s_networks" {
  assert {
    condition     = local.k3s_pod_cidr != "10.42.0.0/16" && local.k3s_service_cidr != local.k3s_pod_cidr
    error_message = "K3s networks must not overlap the existing OCI VCN."
  }
}
