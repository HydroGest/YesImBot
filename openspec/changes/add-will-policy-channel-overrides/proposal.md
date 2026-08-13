## Why

Willingness 目前只能为所有频道共用一组增益参数。不同群的消息频率和交互密度差异很大，全局参数容易让高活跃群过度触发，或让低活跃群难以触发。

## What Changes

- 在 willingness 配置中新增有序 `channelOverrides` 规则表。
- 规则按 `platform`、`channelId` 和可选 `isDirect` 匹配频道。
- 首期仅允许覆盖 `textGain` 和 `keywordMultiplier`，保持范围最小。
- 按配置顺序采用第一条匹配规则；未匹配时保持全局值。
- 私聊规则接受普通账号，匹配时规范化为 `private:<account>`。

## Impact

变更限于 `plugins/will-policy` 的配置 Schema、类型、频道引擎初始化、测试和文档。WillEngine 和 Core 接口不变；不配置规则时行为完全兼容。
