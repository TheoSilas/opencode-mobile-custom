# 编程助手：手动 ARM64 APK 构建

本 Fork 基于 [alvarolorentedev/OpenCode Mobile](https://github.com/alvarolorentedev/opencode-mobile)，保留 Apache-2.0 `LICENSE`、原项目 README 和署名；新增 `NOTICE` 说明来源与修改。

## 构建配置

`.github/workflows/fork-apk.yml` 仅支持 `workflow_dispatch`，在 GitHub 的 Ubuntu runner 上复用 `npm run build:android`：

- 名称：`编程助手`（`EXPO_APP_NAME`）。
- 独立包名：`app.theosilas.opencode`（`EXPO_ANDROID_PACKAGE`）。
- 架构：仅 `arm64-v8a`。
- production release，`assembleRelease` 内置 JS/Hermes 与 Expo DOM 资源，不需要 Metro；应用功能仍需要连接 OpenCode 服务。
- `ANDROID_RELEASE_APK_ONLY=1` 跳过 AAB，仅生成 APK。
- 使用固定的外部签名密钥；未配置 Secrets 时直接失败，不生成临时签名密钥。
- 独立 `validate` 任务先运行静态、fake-server 与完整 web E2E 检查；`apk` 任务通过 `needs: validate` 强制等待同一提交的全部检查成功，再构建并验证签名、包名、名称、ABI 与内置 JS bundle。E2E 失败时上传报告供排查。
- 产物 `programming-assistant-arm64-<run number>` 包含 APK、SHA256SUMS、LICENSE 与 NOTICE，保留 14 天。
- 不上传 Play Store，也不创建 GitHub Release。

原 `build.yml` 的 Android/Play/FOSS 发布任务与 `cleanup.yml` 的清理任务限定为原作者仓库运行；Fork 的 push/PR 仍可运行原验证任务。清理任务不会提前删除本 Fork 的 APK 产物。

## GitHub Secrets

在 Fork → Settings → Secrets and variables → Actions → Repository secrets 设置：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 固定 JKS/PKCS12 密钥库文件的完整 Base64 编码 |
| `ANDROID_KEYSTORE_PASSWORD` | 密钥库密码 |
| `ANDROID_KEY_ALIAS` | 密钥库内私钥的 alias |
| `ANDROID_KEY_PASSWORD` | 私钥密码；PKCS12 请与密钥库密码保持一致，现有脚本使用库密码签名 |

不需要 Expo/EAS token 或 Google Play 服务账号。包名与名称已在工作流中固定，无需 Repository variables。

如果尚无签名密钥，在可信桌面电脑上使用 JDK 的 `keytool` 创建一次并离线备份，例如：

```bash
keytool -genkeypair -v -storetype JKS -keystore programming-assistant.jks -alias programming-assistant -keyalg RSA -keysize 4096 -validity 10000
base64 -w 0 programming-assistant.jks > programming-assistant.jks.base64
```

命令交互输入密码；macOS 可用 `base64 -i programming-assistant.jks | tr -d '\n'` 编码。将编码内容设为 Secret，密钥库、编码文件和密码都不要放入仓库。后续更新必须复用同一密钥，并在实际发布更新时递增 `android.versionCode`、同步版本与对应 changelog。实际版本以 `app.config.ts` 为准。

## 后续手动操作

先按照 [手机开发与协作流程](mobile-development.md) 完成本地检查、提交推送和对应提交的云端验证。设置上述 Secrets，然后在 Actions 中选择 **Build 编程助手 ARM64 APK** → **Run workflow**，选择已通过检查的分支；工作流仍会重新验证本次提交。成功后下载 Artifacts，解压安装 `programming-assistant-arm64.apk`。

Android/Termux 的浏览器 E2E 与原生打包由云端执行，不把平台不可运行的检查记为通过。首次云端构建与真机启动（关闭 Metro 后检查启动、终端、通知与语音）仍需验证。
