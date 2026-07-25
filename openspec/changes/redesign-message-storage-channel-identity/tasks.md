## 1. Capture The Approved Design

- [x] 1.1 Reconstruct the active proposal, design, tasks, and nine delta specs from the approved design and verified implementation evidence.

## 2. Split Input Contracts

- [x] 2.1 Implement and test `MessageRecord | EventRecord`, `yesimbot.message`, `yesimbot.event`, schema version guards, frozen text, and projection.

## 3. Gateway And Platform Ingress

- [x] 3.1 Implement strict ordinary-message admission, source-element capture, OneBot freezing, and non-message event resolution.

## 4. Logical Channel Identity

- [x] 4.1 Rename the stable hash API to `channelIdentity` without changing its canonical bytes or conformance vectors.

## 5. Manifest-Backed Channel Storage

- [x] 5.1 Implement readable v1 directories, authoritative Manifests, startup scanning, and removal of `channels.json`.

## 6. Runtime And Will Routing

- [x] 6.1 Route the input union through one identity-keyed runtime FIFO with persist-observe-decide ordering.

## 7. Plugin Identity Consumers

- [x] 7.1 Update Workspace and MemOS to use `ensureStorage` and `channelIdentity` without path derivation or aliases.

## 8. Integration Verification

- [x] 8.1 Controller evidence: `rtk yarn check-types` and `rtk yarn build` passed; focused suites passed; `rtk yarn test` retained only three accepted stale OneBot reaction failures. Asset expectation debt was fixed in `b457546`.

## 9. Synchronize Main Specifications

- [x] 9.1 Merged the verified requirements into all nine main specifications. `rtk openspec validate redesign-message-storage-channel-identity --type change --strict --no-interactive` passed; `rtk openspec validate --specs --strict --no-interactive` passed with 20 passed and 0 failed.
