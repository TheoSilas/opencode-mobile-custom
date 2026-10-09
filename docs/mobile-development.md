# 手机修改源码 → GitHub 检查 → Actions APK

本 Fork 的日常流程是在手机 App 中修改手机上的仓库，推送到
`TheoSilas/opencode-mobile-custom`，由 GitHub Actions 完成浏览器测试和原生打包。
应用分层与协作规则仍以根目录 `AGENTS.md` 和 `docs/` 为准。

## 1. 每次开始先同步，保留本地工作

先检查实际仓库和跟踪分支，不要把 `upstream/main` 当作本 Fork 的最新代码：

```bash
git status --short --branch
git remote -v
git fetch origin
git rev-list --left-right --count HEAD...origin/main
git log --oneline --left-right HEAD...origin/main
git diff --stat HEAD origin/main
```

`HEAD...origin/main` 的计数左侧是本地独有提交，右侧是远端独有提交。
合并前建立唯一命名的备份分支，如 `backup/phone-before-sync-YYYYMMDD-HHMMSS`。
未提交工作先审阅并提交，或执行 `git stash push -u`；stash 后用
`git stash apply` 恢复，检查无误再删除对应 stash。备份分支只保护已提交历史。

- 仅落后时用 `git merge --ff-only origin/main`。
- 双方都有提交时用 `git merge origin/main` 保留双方历史。
- 冲突时逐项审阅解决；不要整批选远端覆盖本地，必要时用 `git merge --abort`。
- 本地 `main` 应跟踪 `origin/main`：`git branch --set-upstream-to=origin/main main`。
- 不使用 `reset --hard`、`clean -fd` 或强制推送来同步。

## 2. 手机必须运行支持的检查

依赖变化或首次安装时使用 `npm ci --include=dev`；CI 使用 Node 22。
手机可使用支持该依赖树的 Termux Node，版本差异由云端 Node 22 再验证。

```bash
npm run test:ci:static
npm run test:fake-server:self
git diff --check
```

`test:ci:static` 包含 lint、typecheck、Vitest 和所有脚本静态/运行时回归检查。
fake-server 自检覆盖 V1 与 V2。任一支持的检查失败，先修复再推送，不能通过
删测试、降低断言、忽略退出码或移除检查绕过。

Android/Termux 无法原生运行项目的 Playwright 桌面浏览器 E2E，不在手机上安装
Linux 浏览器强行运行。将 `npm run test:e2e:web` 明确记为“待云端 CI”，不能记为通过。
原生 APK 编译也交给 Actions 的 Ubuntu/JDK/Android SDK 环境。
若另一项工具确实受平台限制，记录具体命令和错误并交给 CI；应用断言失败不属于平台限制。

## 3. 推送只是提交云端验证

手机检查通过后，审阅 `git diff`，提交相关文件并正常推送。直接在 `main` 工作时：

```bash
git push origin main
```

功能分支推送后需创建目标为 `main` 的 PR，以触发 `PR Validate`；仅推送功能分支
不会触发现有 push-to-main 工作流。远端有新提交导致推送被拒绝时，重新 fetch、
保留工作并合并，再检查；禁止 force push。

在 GitHub Actions 查看**对应提交 SHA** 的 `Build / validate` 或 `PR Validate / validate`：
静态检查 → fake-server 自检 → Chromium 安装 → 完整 web E2E。
失败、取消或仍在运行均不算通过。检查红灯时查看日志和 `playwright-report`，修复后
重新检查；疑似偶发失败也必须确认并修复稳定性，不能直接绕过。

`tests/e2e/` 或 `tests/fake-opencode/` 的改动仍需明确的人工验证；云端绿灯不能代替
人工验证或真机验收。发布递增版本时同时更新版本和对应 versionCode 的 changelog。

## 4. 全部检查通过后才能构建 APK

打开 **Build 编程助手 ARM64 APK → Run workflow**，选择已推送并通过验证的分支。
该手动工作流对本次运行的同一提交重新执行完整 `validate`，只有它成功后，
`apk` 任务（`needs: validate`）才会启动，读取签名 Secrets、编译并验证 APK。
不允许 `continue-on-error`、测试跳过开关或 `always()` 绕过构建门禁。
推送不会自动生成本 Fork 的 APK。

签名配置、产物下载和真机检查见 [fork-apk.md](fork-apk.md)。
本地检查成功不是完整验证成功；构建完成也不等于真机行为已经验收。

## GitHub 登录与授权

读取公开仓库通常不需要登录；推送、私有资源或触发 Actions 需要有相应权限的账号。
若手机没有 GitHub CLI，可在 Termux 安装 `pkg install gh`，然后运行：

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
gh auth status
```

按终端提示在浏览器打开 GitHub 授权页面，输入设备验证码并确认权限。
Token、密码和签名密钥不得发送到聊天、写入仓库或放进 remote URL；授权在浏览器与
本机凭据存储完成。签名资料只填入 GitHub Actions Repository secrets。
