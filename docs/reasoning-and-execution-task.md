# 推理内容、执行状态与停止按钮

## 本轮目标与分层

1. **思考内容折叠**：`lib/opencode/` 保留服务端实际公开的 reasoning 文本（包括空白和流式增量的最终快照）；无内容不显示推理区。`components/chat/cards/` 按消息展示可展开／折叠的原文；切换聊天和历史重新读取可恢复原文，折叠状态只是 UI 本地状态。
2. **执行状态**：来自 provider 的会话状态及当前工具，不从推理文本或推理结束事件推定完成。工具仍在运行时继续显示运行状态和取消入口；失联时显示“状态待确认”，恢复连接后由服务端状态核对。
3. **停止按钮**：现有按钮是**取消／中断执行**（V2 `POST /api/session/{sessionID}/interrupt`，V1 `session.abort`），不是可恢复的暂停。发送请求后保持“取消确认中”；仅在服务端回读证实任务不再活跃时清理本地提交守卫与通知，并允许重新发送。无法确认时保持待确认，重连后复核，不能本地乐观标记完成。

## 验收

- 有 reasoning 内容的消息可展开和折叠，更新时保留实际返回的全文，历史重载可见；没有 reasoning 时不显示空白区或猜测内容。
- 推理输出结束但工具仍运行：执行指示及取消按钮继续可见；工具完成后以服务端终态更新。
- 取消请求成功但状态未终止、请求失败或断线：UI 明示待确认，禁止误报已完成；重连后按服务端状态恢复或结束。确认中避免重复取消，仍可跨聊天查看。
- fake-server／E2E 行为改动的代码人工审查须由人另行完成；测试通过和需求确认不等同于代码审查。

## 交付记录

当前代码实现位于 `lib/opencode/format/transcript.ts`、`lib/opencode/transcript.ts`、`components/chat/cards/message-card.tsx`、`components/chat/content/transcript-list.tsx`、`providers/use-prompt-lifecycle.ts`；fake 场景和浏览器流程独立验证推理流、工具和取消确认。基线已安装 APK `96dedaf` **不含本任务的新代码**；以新提交 SHA、云端门禁和后续独立原生验收补充。正式后端切换另见 `docs/backend-switch-runbook.md`，目前保持 4096 服务不变。
