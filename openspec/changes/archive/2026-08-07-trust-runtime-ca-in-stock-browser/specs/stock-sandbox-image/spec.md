## ADDED Requirements

### Requirement: Stock browser trusts runtime local certificate authorities
The stock lifecycle SHALL make runtime-provided local certificate authorities trusted by the stock image's native Google Chrome before project bootstrap or user commands execute. It SHALL preserve normal certificate verification rather than globally accepting invalid certificates, SHALL apply the trust initialization idempotently, and SHALL fail before project or user execution with actionable diagnostics when a provided local certificate authority cannot be applied. Custom images SHALL remain responsible for their own browser trust integration.

#### Scenario: Fresh stock browser navigates intercepted HTTPS
- **WHEN** a fresh stock sandbox receives a runtime local certificate authority and Chrome navigates to an allowed HTTPS destination whose certificate chains to that authority
- **THEN** Chrome validates the connection and renders the destination without disabling certificate verification

#### Scenario: Existing local browser trust is preserved
- **WHEN** trusted personal bootstrap has already established browser certificate state before stock browser trust initialization
- **THEN** the lifecycle adds or refreshes its owned local certificate entries without deleting unrelated browser trust entries

#### Scenario: Browser trust initialization is repeatable
- **WHEN** stock browser trust initialization runs again with unchanged local certificate authorities
- **THEN** it completes successfully without accumulating duplicate trust entries

#### Scenario: Runtime certificate authority rotates
- **WHEN** a runtime local certificate authority changes while retaining the same wrapper-owned identity
- **THEN** the next stock browser trust initialization replaces the stale browser trust entry with the current certificate

#### Scenario: No runtime local certificate authorities
- **WHEN** stock browser trust initialization finds no runtime-provided local certificate authorities
- **THEN** it completes successfully without weakening Chrome certificate verification

#### Scenario: Runtime certificate authority cannot be applied
- **WHEN** a runtime-provided local certificate authority cannot be added to Chrome's trust database
- **THEN** stock creation exits non-zero before project bootstrap or user commands and identifies browser trust initialization as the failed stage

#### Scenario: Custom image owns browser trust
- **WHEN** custom image mode is selected
- **THEN** the wrapper does not apply the stock browser trust initialization or guarantee Chrome compatibility
