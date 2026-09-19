# 给上游（zitaofeng-china/Skerry）的改动映射

Fork：https://github.com/atom30260-jpg/Skerry-macOS  
对照提交：`79a901b`（`docs: 重写 Skerry 项目介绍`）

本文只列「相对上游 main 多了什么」。原作者在 GitHub 打开该 fork 的 Compare / Pull request，点 Create 即可；下面是审阅清单。

macOS 代码签名不进仓库：本地用环境变量或本机 `tauri.conf` 覆盖，不要把 Apple 证书、Apple ID、Team ID 写进源码。

---

## 1. 品牌与双端打包

| 文件 | 改什么 |
| --- | --- |
| `package.json` | `name`: `agents-gzt` → `skerry`；`test`/`check` 补 `command-risk`、`paths`、`file-icons` |
| `src-tauri/Cargo.toml` / `Cargo.lock` | crate 名 `skerry` |
| `src-tauri/tauri.conf.json` | `identifier` `com.skerry.workbench`；`targets` 加 `dmg`；补 `icon.icns`；`minimumSystemVersion` `12.0`。无签名身份字段 |
| `rust-toolchain.toml` | `stable`（不再写死 `x86_64-pc-windows-msvc`） |
| `public/index.html` `public/shell.js` `public/provider-card.js` | 文案/品牌对齐 Skerry |
| `public/icons/skerry.svg` `src-tauri/icons/skerry.svg` | 新图标 |
| `public/icons/agents-gzt.svg` `src-tauri/icons/agents-gzt.svg` | 删除 |
| `src-tauri/gen/schemas/macOS-schema.json` | 与已跟踪的 windows/desktop schema 并列 |
| `README.md` | 平台写 Windows+macOS；数据目录 `~/.skerry`；产物补 dmg |
| `launch-desktop.sh` | macOS/Linux 启动脚本（Windows 仍用 `.vbs`/`.ps1`，仅路径随二进制名） |

## 2. 桌面宿主（Tauri）

`src-tauri/src/main.rs`

- `node_bin`：Windows `node.exe`，其它 `node`
- `data_dir()`：`AGENTS_DATA_DIR` 或 `~/.skerry`（不再用 `app_data_dir` / `com.agentsgzt.workbench`）
- 未使用的 `app` 参数已去掉

`scripts/prepare-desktop.mjs`：复制 `src/`+`public/`+本机 `node` 到 `src-tauri/resources`（gitignore 仍排除该目录）。

`scripts/start.mjs`：浏览器开发启动不绑死 Windows。

## 3. 路径与密钥

| 文件 | 改什么 |
| --- | --- |
| `src/paths.mjs` **新** | 配置目录、工作区母目录（默认 `~/Downloads/Skerry工作区`）、静态文件不得逃出 `public` |
| `src/paths.test.mjs` **新** | 覆盖上述 |
| `src/secret-store.mjs` | Windows 仍 DPAPI；macOS Keychain 服务名 `Skerry`；测试/`MULTI_AGENT_SECRETS` 退回 0600 文件 |
| `src/server.mjs` | `workspace.json` 损坏时不崩；`/api/layout` 改工作区母目录；选文件夹 Windows/macOS 分流；项目 relocate；`layout` 进 `/api/state` |

## 4. 权限 / HITL / 进程（审计 P0）

| 文件 | 改什么 |
| --- | --- |
| `src/agent/command-risk.mjs` **新** | 命令风险分级 |
| `src/agent/command-risk.test.mjs` **新** | 含 `full-auto` 只读归一到厂家档 |
| `src/agent/permissions.mjs` | `decidePermission` 吃 `command` / `extraAuthorized`；完全访问只认 `never`/`bypassPermissions`；`always-proceed` 不再当独立档 |
| `public/permission-modes.js` | 历史别名只读归一（`manual`→default，`full-auto`→codex `never` 否则 `bypassPermissions`） |
| `src/agent/workspace-io.mjs` | `realpath` 走现存祖先，修 macOS `/var`→`/private/var`；`killProcessTree`；`abortWorkspaceCommands`；posix 用 zsh/bash `-lc` |
| `src/agent/loop.mjs` `chat.mjs` `agy/claude/codex/grok.mjs` | 接新权限与中止 |
| `src/auth.mjs` | Gemini 无 `GEMINI_OAUTH_CLIENT_ID` 时登录按钮灰掉 |

## 5. 前端（流畅 + 界面统一）

| 文件 | 改什么 |
| --- | --- |
| `public/file-icons.js` **新** | 仅扩展名→kind；侧栏用现有 SVG，无 emoji 表 |
| `public/app.js` | 文件选择 `fileKind`+`icons.folder/generic`；compose 切档局部更新；登录等待 `setTimeout`，device 仍 `auth/poll`，页隐藏不打接口 |
| `public/chat.js` | 流式 `text_delta` rAF + `textContent`；停止按钮图标 |
| `public/style.css` | effort chip、HITL 卡片与原 compose 对齐 |

## 6. 测试

`npm test`：198 tests，197 pass，1 skip（Windows DPAPI）。新增/改动的 `*.test.mjs` 一并带上。

## 建议 PR 标题

`feat: macOS 桌面端与权限/路径加固（Windows 行为保持）`

合入后 Windows 安装包标识会变成 `com.skerry.workbench`，旧 `%APPDATA%/com.agentsgzt.workbench` 不会自动迁到 `~/.skerry`（文档已写明不自动复制旧数据）。
