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
