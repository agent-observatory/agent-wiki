# Mocked plan only: no OCI calls or resource creation.
mock_provider "oci" {}

variables {
  tenancy_id          = "synthetic-tenancy"
  availability_domain = "synthetic-ad"
  image_id            = "synthetic-image"
  ssh_public_key      = "synthetic-public-key"
}

run "single_free_a1" {
  command = plan

  assert {
    condition     = oci_core_instance.wiki.shape == "VM.Standard.A1.Flex" && oci_core_instance.wiki.shape_config[0].ocpus == 2 && oci_core_instance.wiki.shape_config[0].memory_in_gbs == 12
    error_message = "The first deployment must remain one A1 with 2 OCPU and 12 GB."
  }

  assert {
    condition     = tonumber(oci_core_instance.wiki.source_details[0].boot_volume_size_in_gbs) == 50 && tonumber(oci_core_volume.data.size_in_gbs) == 50
    error_message = "Boot and data volumes must each remain 50 GB."
  }

  assert {
    condition     = var.fault_domain == null
    error_message = "Let OCI select the fault domain unless a deployment request explicitly changes it."
  }

  assert {
    condition     = oci_objectstorage_bucket.sources.access_type == "NoPublicAccess" && oci_objectstorage_bucket.sources.storage_tier == "Standard"
    error_message = "Raw sources must remain in a private Standard bucket."
  }

  assert {
    condition     = oci_core_volume_attachment.data.attachment_type == "paravirtualized" && oci_core_volume_attachment.data.device == "/dev/oracleoci/oraclevdb"
    error_message = "The data attachment must match the cloud-init mount device."
  }

  assert {
    condition     = oci_core_instance.wiki.is_pv_encryption_in_transit_enabled && oci_core_instance.wiki.launch_options[0].is_pv_encryption_in_transit_enabled && oci_core_volume_attachment.data.is_pv_encryption_in_transit_enabled
    error_message = "The instance and data attachment must both enable paravirtualized in-transit encryption."
  }
}

run "k3s_keeps_management_private" {
  command = plan
  assert {
    condition     = local.public_tcp_ports == toset([22, 80, 443, 5432]) && local.k3s_pod_cidr == "10.52.0.0/16" && local.k3s_service_cidr == "10.53.0.0/16"
    error_message = "Keep existing public ports only and use non-overlapping K3s networks."
  }
}

run "monitoring_without_function" {
  command = plan
  variables {
    slack_webhook_url      = "https://hooks.slack.com/services/synthetic/synthetic/synthetic"
    cost_reader_public_key = "synthetic-key"
    cost_reader_email      = "synthetic@example.invalid"
  }
  assert {
    condition     = oci_logging_log.app[0].retention_duration == 30 && oci_logging_unified_agent_configuration.wiki[0].service_configuration[0].sources[0].paths == tolist(["/var/log/agent-wiki/events.jsonl"])
    error_message = "Only structured application events should enter the 30-day log."
  }
  assert {
    condition     = oci_sch_service_connector.errors[0].state == "ACTIVE" && oci_sch_service_connector.errors[0].target[0].kind == "monitoring" && oci_sch_service_connector.errors[0].tasks[0].condition == "data.severityNumber >= 17"
    error_message = "Only ERROR and FATAL logs may produce native Monitoring metrics; never forward raw logs to Slack."
  }
  assert {
    condition     = oci_monitoring_alarm.errors[0].message_format == "ONS_OPTIMIZED" && !oci_monitoring_alarm.errors[0].is_enabled && oci_monitoring_alarm.errors[0].query == "ErrorLogCount[5m].grouping().count() > 0" && oci_monitoring_alarm.errors[0].evaluation_slack_duration == "PT5M" && !oci_monitoring_alarm.errors[0].is_notifications_per_metric_dimension_enabled
    error_message = "Keep native Slack alarm delivery disabled so RESET/OK cannot bypass the error-only log reporter."
  }
  assert {
    condition     = !oci_identity_user_capabilities_management.cost_reader[0].can_use_console_password && !oci_identity_user_capabilities_management.cost_reader[0].can_use_auth_tokens
    error_message = "The monitoring reader must not gain console or auth-token access."
  }
  assert {
    condition     = oci_budget_budget.wiki[0].amount == 1
    error_message = "Keep the visibility budget small; it is not a spending authorization."
  }
}
