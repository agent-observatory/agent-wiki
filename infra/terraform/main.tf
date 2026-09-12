terraform {

  required_version = ">= 1.9.0"
  required_providers {
    oci = {
      source = "oracle/oci", version = "~> 7.0"
    }

  }


}

provider "oci" {
  region = "ap-osaka-1"
}

variable "tenancy_id" {
  type = string
}

variable "availability_domain" {
  type = string
}

variable "image_id" {
  type = string
}

variable "ssh_public_key" {
  type = string
}

resource "oci_core_vcn" "wiki" {

  compartment_id = var.tenancy_id
  cidr_blocks    = ["10.42.0.0/16"]
  display_name   = "agent-wiki"
  dns_label      = "agentwiki"

}

resource "oci_core_internet_gateway" "wiki" {

  compartment_id = var.tenancy_id
  vcn_id         = oci_core_vcn.wiki.id
  display_name   = "agent-wiki"
  enabled        = true

}

resource "oci_core_route_table" "wiki" {

  compartment_id = var.tenancy_id
  vcn_id         = oci_core_vcn.wiki.id
  route_rules {
    network_entity_id = oci_core_internet_gateway.wiki.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }


}

resource "oci_core_security_list" "wiki" {

  compartment_id = var.tenancy_id
  vcn_id         = oci_core_vcn.wiki.id
  display_name   = "agent-wiki"
  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  dynamic "ingress_security_rules" {

    for_each = toset([22, 80, 443, 5432])
    content {
      protocol = "6"
      source   = "0.0.0.0/0"
      tcp_options {
        min = ingress_security_rules.value
        max = ingress_security_rules.value
      }


    }


  }


}

resource "oci_core_subnet" "wiki" {

  compartment_id    = var.tenancy_id
  vcn_id            = oci_core_vcn.wiki.id
  cidr_block        = "10.42.1.0/24"
  display_name      = "agent-wiki-public"
  dns_label         = "wiki"
  route_table_id    = oci_core_route_table.wiki.id
  security_list_ids = [oci_core_security_list.wiki.id]

}

resource "oci_core_instance" "wiki" {
  fault_domain = var.fault_domain
  # OCI uses this field at creation and launch_options for later updates.
  is_pv_encryption_in_transit_enabled = true

  compartment_id      = var.tenancy_id
  availability_domain = var.availability_domain
  display_name        = "agent-wiki"
  shape               = "VM.Standard.A1.Flex"
  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }

  launch_options {
    is_pv_encryption_in_transit_enabled = true
  }

  source_details {
    source_type             = "image"
    source_id               = var.image_id
    boot_volume_size_in_gbs = 50
    boot_volume_vpus_per_gb = 10
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.wiki.id
    assign_public_ip = true
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = filebase64("${path.module}/cloud-init.yaml")
  }

  agent_config {
    is_monitoring_disabled = false
    is_management_disabled = false
    plugins_config {
      name          = "Custom Logs Monitoring"
      desired_state = "ENABLED"
    }


  }

  lifecycle {
    prevent_destroy = true
    # Create-only fields must not replace a VM with persistent data.
    # launch_options manages encryption updates; configure-host.sh updates existing hosts.
    ignore_changes = [is_pv_encryption_in_transit_enabled, metadata["user_data"]]
  }


}

resource "oci_core_volume" "data" {

  compartment_id      = var.tenancy_id
  availability_domain = var.availability_domain
  display_name        = "agent-wiki-data"
  size_in_gbs         = 50
  vpus_per_gb         = 10
  lifecycle {
    prevent_destroy = true
  }


}

resource "oci_core_volume_attachment" "data" {

  attachment_type                     = "paravirtualized"
  instance_id                         = oci_core_instance.wiki.id
  volume_id                           = oci_core_volume.data.id
  device                              = "/dev/oracleoci/oraclevdb"
  is_pv_encryption_in_transit_enabled = true

}

data "oci_objectstorage_namespace" "wiki" {
  compartment_id = var.tenancy_id
}

resource "oci_objectstorage_bucket" "sources" {

  compartment_id = var.tenancy_id
  namespace      = data.oci_objectstorage_namespace.wiki.namespace
  name           = "agent-wiki-sources"
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  versioning     = "Disabled"
  lifecycle {
    prevent_destroy = true
  }


}

resource "oci_identity_dynamic_group" "wiki" {

  compartment_id = var.tenancy_id
  name           = "agent-wiki-vm"
  description    = "Agent Wiki instance principal"
  matching_rule  = "ALL {instance.id = '${oci_core_instance.wiki.id}'}"

}

resource "oci_identity_policy" "wiki" {

  compartment_id = var.tenancy_id
  name           = "agent-wiki-runtime"
  description    = "Only Wiki source bucket and host logging"
  statements = [
    "Allow dynamic-group agent-wiki-vm to manage objects in tenancy where target.bucket.name = '${oci_objectstorage_bucket.sources.name}'",
    "Allow dynamic-group agent-wiki-vm to use log-content in tenancy"
  ]

}

output "public_ip" {
  value = oci_core_instance.wiki.public_ip
}

output "instance_id" {
  value = oci_core_instance.wiki.id
}

output "namespace" {
  value = data.oci_objectstorage_namespace.wiki.namespace
}

output "bucket" {
  value = oci_objectstorage_bucket.sources.name
}

variable "fault_domain" {
  type    = string
  default = null
}
