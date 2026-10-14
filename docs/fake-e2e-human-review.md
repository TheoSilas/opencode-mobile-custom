# Fake-server／E2E 人工代码审查材料

## 基线 PR 和已验证提交

- PR：https://github.com/TheoSilas/opencode-mobile-custom/pull/1
- 已完成隔离账号／标准 PTY 真机验收的**最终基线提交**：`96dedafc089e269cf71f744bf2e43e17bc032f3d`。
- 该提交的 PR validate `38496376606`，APK workflow `38497340289`（同 SHA 的 validate 与 apk）均成功；详见本机 `DEVICE-ACCEPTANCE.md`。自动测试和真机 UI 验收**不等同于** fake-server／E2E 的人工代码审查。
- 本轮推理／执行／取消的实现快照：`a29e926b9988801da36abe76949b8890e9aa67ca`；本轮新增的单条格式测试位于其后的审查材料提交。新功能必须以 PR 最终 head SHA 的云端结论为准；审查时执行 `git diff 96dedaf..HEAD -- tests/fake-opencode tests/e2e`，不能把旧 APK 的 `96dedaf` 当成新功能的验证。

## 基线关键差异（`origin/main...96dedaf`）

- `tests/fake-opencode/server-v2.mjs`、`session-helpers.mjs`：凭据删除及已受理任务的 failed/idle 结局，`post-admission-failure` 保持运行直到删除；会话 outcome 与 idle 时间返回客户端；不会用默认 B 替代失效 A。
- `tests/e2e/flows.spec.mjs`：发送前已删除 A 时拒绝发送、不创建 user 消息；发送后路径先等 prompt HTTP 200 和正确 sessionID，再删除、验证服务端 failed 与 UI 错误。单例先于全套运行，避免把“请求被 400 拒绝”误认为发送后失败。
- `tests/fake-opencode/self-test.mjs`：账号、inbox 等协议自检。逐项检查事件抑制、定时器和历史 outcome 的处理，确保旧失败不会覆盖后续成功，也不会串到其他聊天。

## 本轮新增差异及审查要点（待最终 SHA）

- `tests/fake-opencode/session-helpers.mjs`：`reasoning-tool` 专用场景创建纯 reasoning 助手消息和仍在运行的工具；不自动完成。
- `tests/fake-opencode/server-v2.mjs`：工具消息序列化、推理快照更新、独立的完成／取消确认控制；interrupt HTTP 返回时仍保持 active，模拟服务器确认延迟。
- `tests/fake-opencode/self-test.mjs`：验证原文空白和续写、工具仍在运行、interrupt 响应不等于终态，确认后才 inactive。
- `tests/e2e/flows.spec.mjs`：验证无伪造推理、展开／折叠、流式更新与 reload 恢复、工具继续执行时取消按钮可用、服务端确认前不得标记结束。
- 人工审查需确认：所有控制端点仅用于 fake 场景；SSE 丢帧可由轮询恢复；取消请求失败／断线／重连不误报完成；同会话新请求和跨聊天／跨连接不串状态；无敏感凭据写入夹具。

**审查状态：待由人逐行确认并记录审查者、实际 commit SHA、结果和日期。用户需求确认不得记录为代码审查。**
