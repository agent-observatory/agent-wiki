variable "slack_webhook_url" {
  type      = string
  sensitive = true
  default   = ""
}

variable "cost_reader_public_key" {
  type    = string
  default = ""
}

variable "cost_reader_email" {
  type      = string
  default   = ""
  sensitive = true
}

locals {
  monitoring_enabled = nonsensitive(var.slack_webhook_url != "")
}

resource "oci_logging_log_group" "wiki" {
  count          = local.monitoring_enabled ? 1 : 0
  compartment_id = var.tenancy_id
  display_name   = "agent-wiki"
}

resource "oci_logging_log" "app" {
  count              = local.monitoring_enabled ? 1 : 0
  display_name       = "app-events"
  log_group_id       = oci_logging_log_group.wiki[0].id
  log_type           = "CUSTOM"
  is_enabled         = true
  retention_duration = 30
}

resource "oci_logging_unified_agent_configuration" "wiki" {
  count          = local.monitoring_enabled ? 1 : 0
  compartment_id = var.tenancy_id
  display_name   = "agent-wiki-app-events"
  description    = "Only structured Wiki API and Worker events; no request bodies"
  is_enabled     = true
  group_association {
    group_list = [oci_identity_dynamic_group.wiki.id]
  }
  service_configuration {
    configuration_type = "LOGGING"
    destination {
      log_object_id = oci_logging_log.app[0].id
    }
    sources {
      source_type = "LOG_TAIL"
      name        = "wiki-app-events"
      paths       = ["/var/log/agent-wiki/events.jsonl"]
      parser {
        parser_type      = "JSON"
        field_time_key   = "timestamp"
        time_format      = "%Y-%m-%dT%H:%M:%S.%LZ"
        is_keep_time_key = true
      }
      advanced_options {
        is_read_from_head = false
      }
    }
  }
}

resource "oci_ons_notification_topic" "errors" {
  count          = local.monitoring_enabled ? 1 : 0
  compartment_id = var.tenancy_id
  name           = "agent-wiki-errors"
  description    = "Agent Wiki API server errors and terminal Worker failures"
}

resource "oci_ons_subscription" "slack" {
  count          = local.monitoring_enabled ? 1 : 0
  compartment_id = var.tenancy_id
  topic_id       = oci_ons_notification_topic.errors[0].id
  protocol       = "SLACK"
  endpoint       = var.slack_webhook_url
}

resource "oci_identity_policy" "error_connector" {
  count          = local.monitoring_enabled ? 1 : 0
  compartment_id = var.tenancy_id
  name           = "agent-wiki-error-delivery"
  description    = "Connector may publish only to the Wiki errors topic"
  statements = [
    "Allow any-user to use ons-topics in tenancy where all {request.principal.type='serviceconnector', request.principal.compartment.id='${var.tenancy_id}', target.topic.id='${oci_ons_notification_topic.errors[0].id}'}"
  ]
}

resource "oci_sch_service_connector" "errors" {
  count          = local.monitoring_enabled ? 1 : 0
  compartment_id = var.tenancy_id
  display_name   = "Agent Wiki - API errors and terminal jobs"
  description    = "Check service, eventName and error_code; open Logging for request/job ID. WARN retries are excluded."
  # Slack direct delivery is raw JSON. The scheduled formatter owns delivery.
  state = "INACTIVE"
  source {
    kind = "logging"
    log_sources {
      compartment_id = var.tenancy_id
      log_group_id   = oci_logging_log_group.wiki[0].id
      log_id         = oci_logging_log.app[0].id
    }
  }
  tasks {
    kind      = "logRule"
    condition = "data.severityNumber >= 17"
  }
  target {
    kind                       = "notifications"
    topic_id                   = oci_ons_notification_topic.errors[0].id
    enable_formatted_messaging = true
  }
  depends_on = [oci_identity_policy.error_connector]
}

# Dedicated CI identity: no VM creation, termination or app-data access.
resource "oci_identity_user" "cost_reader" {
  count          = var.cost_reader_public_key != "" ? 1 : 0
  compartment_id = var.tenancy_id
  name           = "agent-wiki-cost-reader"
  email          = var.cost_reader_email
  description    = "Read billing and Wiki operational logs; persist notification checkpoint"
}

resource "oci_identity_user_capabilities_management" "cost_reader" {
  count                        = length(oci_identity_user.cost_reader)
  user_id                      = oci_identity_user.cost_reader[0].id
  can_use_api_keys             = true
  can_use_auth_tokens          = false
  can_use_console_password     = false
  can_use_customer_secret_keys = false
  can_use_smtp_credentials     = false
}

resource "oci_identity_group" "cost_reader" {
  count          = length(oci_identity_user.cost_reader)
  compartment_id = var.tenancy_id
  name           = "agent-wiki-cost-readers"
  description    = "Cost reporting automation only"
}

resource "oci_identity_user_group_membership" "cost_reader" {
  count    = length(oci_identity_user.cost_reader)
  user_id  = oci_identity_user.cost_reader[0].id
  group_id = oci_identity_group.cost_reader[0].id
}

resource "oci_identity_api_key" "cost_reader" {
  count     = length(oci_identity_user.cost_reader)
  user_id   = oci_identity_user.cost_reader[0].id
  key_value = var.cost_reader_public_key
}

resource "oci_identity_policy" "cost_reader" {
  count          = length(oci_identity_user.cost_reader)
  compartment_id = var.tenancy_id
  name           = "agent-wiki-cost-reader"
  description    = "Read billing and Wiki log group; update only the notification checkpoint"
  statements = [
    "Allow group ${oci_identity_group.cost_reader[0].name} to read usage-report in tenancy",
    "Allow group ${oci_identity_group.cost_reader[0].name} to read log-content in tenancy where target.loggroup.id='${oci_logging_log_group.wiki[0].id}'",
    "Allow group ${oci_identity_group.cost_reader[0].name} to read log-groups in tenancy where target.loggroup.id='${oci_logging_log_group.wiki[0].id}'",
    "Allow group ${oci_identity_group.cost_reader[0].name} to manage objects in tenancy where all {target.bucket.name='${oci_objectstorage_bucket.sources.name}', target.object.name='ops/cost-alert-state.json', any {request.permission='OBJECT_READ', request.permission='OBJECT_CREATE', request.permission='OBJECT_OVERWRITE'}}"
  ]
}

resource "oci_budget_budget" "wiki" {
  count          = local.monitoring_enabled ? 1 : 0
  compartment_id = var.tenancy_id
  display_name   = "agent-wiki-free-only"
  description    = "SGD 1 visibility budget, not a spending cap. Slack checker alerts on any positive cost."
  amount         = 1
  reset_period   = "MONTHLY"
  target_type    = "COMPARTMENT"
  targets        = [var.tenancy_id]
}

output "monitoring" {
  value = local.monitoring_enabled ? {
    log_group_id    = oci_logging_log_group.wiki[0].id
    log_id          = oci_logging_log.app[0].id
    topic_id        = oci_ons_notification_topic.errors[0].id
    subscription_id = oci_ons_subscription.slack[0].id
    connector_id    = oci_sch_service_connector.errors[0].id
  } : null
}

output "cost_reader" {
  value = length(oci_identity_user.cost_reader) > 0 ? {
    user_id     = oci_identity_user.cost_reader[0].id
    fingerprint = oci_identity_api_key.cost_reader[0].fingerprint
  } : null
}
