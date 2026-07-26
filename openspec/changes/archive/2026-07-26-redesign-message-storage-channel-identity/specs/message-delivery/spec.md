## ADDED Requirements

### Requirement: Delivery Failure Event Contract
Gateway MUST persist a rejected passive send as a same-channel `yesimbot.event` with `schemaVersion: 1`, `eventType: "delivery.failed"`, and frozen `text`.

#### Scenario: Passive send rejects
- **WHEN** `Session.send()` rejects for a ChannelRuntime output
- **THEN** Gateway MUST route one delivery-failure EventRecord through the producing runtime without recursively creating another failure
