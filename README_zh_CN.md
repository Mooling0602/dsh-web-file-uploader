# dsh-web-file-uploader

> **🌐 语言切换** · [English](README.md) | [中文](README_zh_CN.md)

一个面向 **DeepSeek Harness** 网页端的文件上传插件。在输入框工具行加入一个 **DeepSeek 网页版风格的回形针附件按钮**，将所选文件上传到 **DSH 宿主机**——内置**模型感知适配**让文件真正能被当前模型使用，并带**内容寻址防重传**避免重复上传刷爆存储。

- **仓库**：https://github.com/Mooling0602/dsh-web-file-uploader

## 功能特性

- 📎 输入框工具行左侧的回形针按钮（细线条、悬停圆形深灰背景 `#3D3D3E`，与工具栏控件风格统一）
- 支持多选；每个文件以**预览式附件卡片**显示在输入框上方（图片显示缩略图）：读取中 → 上传中 → 已保存，带"复制路径"与移除按钮
- 文件保存在 DSH 宿主机，不会只留在浏览器里
- 文件名清洗（拒绝路径分隔符、`..`、控制字符）+ 同名但内容不同的文件自动追加 `-1`/`-2` 后缀
- **内容寻址防重传** —— 见[防重传机制](#防重传机制)
- UI 文案通过应用 `locale` 服务本地化（zh/en，跟随 dsh web 语言设置或系统默认）

## 模型感知适配与附件卡片设计

上传的文件以**附件卡片**形式显示在输入框上方的 dock 行。卡片是注入行为的唯一依据：

| 状态 | 行为 |
|---|---|
| 卡片存在 | 该文件的绝对路径会注入到**此后发送的每一条用户消息**中 |
| 点击卡片 `×` 关闭 | 插件调用 Host 的 `remove` RPC —— 文件从 pending 注册表移除，**不再注入** |
| Ctrl+V 粘贴 | 粘贴的图片走产品原生草稿管道 —— 不产生卡片，插件完全不干预 |

这是一个**有意的设计决策**：卡片在发送后**不会自动消失**（与粘贴预览发送即清空不同），由你决定文件"附着"在对话中的时长。每次注入为一次性（每条消息一份），注入块精确列出当前所有**未关闭**卡片的文件。

注入按模型能力区分：

| 模型类型 | 图片文件（png/jpeg/webp/gif） | 其他文件 |
|---|---|---|
| **多模态**（`inputModalities` 报告含 `image`）| 通过 attachments 服务注入原生 `ImageBlock`，图片成为请求的一部分，等同正常附件，**不加任何文字提示** | 路径文本块 |
| **纯文本**（如 DeepSeek V4 系列）| 路径文本块——模型可调用读取/识图工具自行查看 | 路径文本块 |

能力检测使用 `llm.resolveModelInfo().inputModalities`（缓存 10 分钟，失败安全回退文本模式）。

注入的提示词使用可读的、**仅供模型阅读的英文格式**：

```
-----
[Attached files] Some files have uploaded with this message:
- /path/to/file1.txt
- /path/to/image1.png
Read the files or use tools to analyse (like vision tools), then answer the user.
```

### 与识图工具等插件的兼容性

- **零耦合**：插件只把绝对路径注入提示词，从不调用、包装或假设任何辅助工具——vision-tools 或其他读取工具拿到路径后独立工作即可。
- **原生多模态路径**：对支持图片的模型，图片以原生 `ImageBlock` 注入，模型使用自身的多模态能力，不会被提示词诱导去调用外部工具。
- **非侵入**：注入只针对真实用户消息（`source.kind === 'user'`）；steering/系统消息绝不会被注入；已含 `[Attached files]` 标记的消息不会重复注入（并发/残留实例防线）。Ctrl+V 粘贴图片完全由产品原生管道处理。

## 防重传机制

重复上传不会刷爆存储：

1. 上传时插件计算解码字节的 **SHA-256**（动态模式经 shell 管道 `base64 -d | sha256sum`；静态 bundle 用 `node:crypto`）
2. 持久化索引 `uploads/.dfu-index.json`：`hash → 已存路径`
3. 再次上传**相同内容**（同名或不同名）→ **复用已有存储副本**，不写新文件、不产生 `-1` 副本，响应带 `dedup: true`
4. 上传经 Promise 队列串行化，并发相同上传不会竞态；索引条目失效（文件被删）时自动回退重新存储

| 场景 | 结果 |
|---|---|
| 同一文件上传 N 次 | 磁盘只存 1 份，所有上传解析到同一路径 |
| 同内容、不同文件名 | 复用首个存储副本 |
| 同名字、不同内容 | 正常的 `-1` 冲突处理（正确） |
| 进程重启 | 索引文件持久化，防重传继续生效 |

## 附件大小限制

- **单文件约 48 MiB**（动态模式：RPC 载荷上限 64 MiB base64，约 48 MiB 解码；静态模式：流式接收 HTTP body 时同此上限）。超限文件会在卡片上显示明确错误。
- 多模态原生注入图片时，额外遵循部署的 `attachments` 限制（单消息字节/像素上限）。

## 安装方式

### A. 动态插件（当前会话，免安装）

```text
cordis_define + cordis_run   # host = src/host.js，client = src/client.js
```

批准 Run 卡片后回形针按钮立即出现。插件为进程内临时扩展，重启后需重新定义并运行。

### B. 静态 bundle（持久化，`dsh plugin` 安装）

包声明了 `dsh.bundle.patch`（见 `cordis.patch.yml`），因此 `dsh plugin --profile web add` 会将其识别为 profile 层。pnpm 支持的任意来源均可：

```bash
# Git 仓库（推荐分发渠道）
dsh plugin --profile web add github.com/Mooling0602/dsh-web-file-uploader

# 本地目录（开发用）
dsh plugin --profile web add ../dsh-web-file-uploader

# Tarball
dsh plugin --profile web add ./dsh-web-file-uploader-0.2.0.tgz

# npm registry（发布后）
dsh plugin --profile web add dsh-web-file-uploader
```

重启 dsh web 进程并刷新页面。分发细节与可选的 npm 发布流程（需要你的 npm 凭据）见 [PUBLISHING.md](PUBLISHING.md)。

## 架构

```
浏览器 (Client)                          DSH 宿主机 (Host)
─────────────                             ─────────────────
conversation.input.left                   harness.handle('upload', …)   [动态]
  └ 回形针 ── FileReader ──┐             webServer 路由 POST /upload   [静态]
                           ▼             ┌ sandboxPolicy.resolve() → 工作区根
                    上传载荷              ├ 会话 cwd / DSH_HOME + /uploads/
                           │             ├ SHA-256 → .dfu-index.json 防重传
                           ▼             └ base64 -d（stdin）/ node:fs 写入
conversation.input.dock
  └ 附件卡片（持久）                     harness.handle('remove', …) / remove 路由
       └ × 关闭卡片 → 停止注入              └ pending 条目删除
                                          agent/pre-step 瀑布
                                             ├ resolveModelInfo → 是否多模态？
                                             ├ attachments.saveImage → ImageBlock
                                             └ 路径文本块（仅用户消息）
```

**为什么用 `base64 -d` 而不是 Host 的 `atob`？** Host 的 `atob` 是文本语义（`Buffer.from(s, "base64").toString("utf-8")`），`fs` 服务也只支持 UTF-8 文本写入。把 base64 经 shell 服务的 `stdin` 管道给 `base64 -d`，可无损写入二进制且无需临时文件。

## 保存位置

| 运行模式 | 目的地 |
|---|---|
| 动态插件 | `<会话工作区>/uploads/`（沙箱化 shell/fs 无法写出工作区）|
| 静态 bundle | `$DSH_HOME/uploads`（默认 `~/.dsh/uploads`），经 `node:fs` 直写——即 dsh 数据目录 |

防重传索引（`uploads/.dfu-index.json`）与存储文件同目录。

## 仓库结构

项目采用**核心单一来源 + 薄缝隙层**架构：所有业务逻辑都在 `src/core/*` 中；动态插件与静态 bundle 只是其上的薄适配层，改一处即可两边生效。

```
dsh-web-file-uploader/
├── src/core/
│   ├── host-core.js        # 规范 Host 逻辑（传输无关，依赖注入）
│   └── client-core.js      # 规范 Client 逻辑（传输无关，依赖注入）
├── src/seams/
│   ├── host-dynamic.template.js     # 动态 Host 缝隙（harness + shell/fs）
│   ├── client-dynamic.template.js   # 动态 Client 缝隙（host.call + React）
│   └── client-static.template.js    # 静态 Client 缝隙（fetch + 模块 react）
├── src/host.js             # 生成产物：动态 Host（核心已内联）—— 勿手改
├── src/client.js           # 生成产物：动态 Client（核心已内联）—— 勿手改
├── lib/index.js            # 静态 Host 缝隙（import 核心；node:fs/crypto/webServer）
├── client/src/client.js    # 生成产物：静态 Client 源码 —— 勿手改
├── scripts/
│   ├── build-dynamic.mjs   # 核心内联进缝隙 → src/*.js + client/src/client.js
│   └── build-client.mjs    # 包装 client/src/client.js → lib/client.js
├── cordis.patch.yml        # dsh.bundle 补丁（profile 层行）
├── package.json            # 可发布清单（dsh.bundle + dsh.client）
├── PUBLISHING.md           # 安装与 npm 发布指南
├── README.md / README_zh_CN.md
└── LICENSE                 # MIT
```

**如何修改代码**：编辑 `src/core/*`（或缝隙模板），然后运行 `pnpm build`——它会重新生成动态源码（`src/host.js`、`src/client.js`）与静态客户端包（`lib/client.js`）。运行中的动态插件需用重新生成的 `src/host.js` / `src/client.js` 经 `cordis_define` + `cordis_run` 重新部署。

## 开发状态

- ✅ 动态插件：已在真实会话中实现并验证
- ✅ 卡片驱动注入、模型感知适配、防重传、i18n UI
- ⚠️ 静态 Client 模块：可由 `scripts/build-client.mjs` 构建，但 `__ModuleLoader__` 包装器需在正式分发前对照真实 web 工具链验证

## 许可证

MIT
