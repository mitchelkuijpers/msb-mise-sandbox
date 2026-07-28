## REMOVED Requirements

### Requirement: Mise is the image builder
**Reason**: Experimental per-project mise OCI builds duplicate the stock setup architecture and require disproportionate platform, registry, archive, and failure-handling machinery.
**Migration**: Use `mise-msb setup` and runtime mise provisioning for the stock workflow. Build and load custom images with external tooling before selecting their explicit image reference.

### Requirement: Build executes on Linux
**Reason**: Removing wrapper-managed mise OCI builds removes the need for a Linux builder microVM on macOS.
**Migration**: Stock setup uses host Docker's native Linux image build. External custom-image workflows own their platform selection.

### Requirement: Configurable build inputs
**Reason**: `build.from`, `build.tag`, and `build.builderImage` exist only for the retired wrapper-managed project-image workflow.
**Migration**: Use stock image mode, or configure custom image mode with an already available image reference.

### Requirement: OCI layout import
**Reason**: The wrapper no longer creates mise OCI layouts or archives them for import.
**Migration**: Stock setup directly saves its Docker-built image and loads it with `msb image load`; custom-image users manage their own loading.

### Requirement: Build output and failures are transparent
**Reason**: The `build` command and its mise-specific stages are removed.
**Migration**: Use `setup --print` and setup diagnostics for the stock image. External image build tooling owns custom-image diagnostics.
