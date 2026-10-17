# dsh-web-file-uploader

> **🌐 语言切换** · [English](README.md) | [中文](README_zh_CN.md)

一个面向 **DeepSeek Harness** 网页端的文件上传插件。在输入框工具行加入一个 **DeepSeek 网页版风格的回形针附件按钮**，将所选文件上传到 **DSH 宿主机**——内置**模型感知适配**让文件真正能被当前模型使用，并带**内容寻址防重传**避免重复上传刷爆存储。

- **仓库**：https://github.com/Mooling0602/dsh-web-file-uploader

## 功能特性

- 📎 输入框工具行里的回形针按钮：外观沿用 shell 的「＋」添加按钮（28px 圆形、`--dsw-specific-selector` 底色、`--dsw-alias-label-primary` 图标颜色、悬停 `--dsw-alias-interactive-bg-hover-solid`），回形针旋转 45°、viewBox 随之放大以保持与 shell 相同的笔画比例，两枚回形针并排时一眼可分；按钮固定在**「＋」添加按钮右侧、权限/模式按钮之前**
- 可**替代官方添加文件入口**：把 shell 的「添加 → 文件」这一项（`＋` 菜单与 `/` 斜杠菜单共用同一菜单源）原位换成插件自己的入口——文字仍是「文件」、斜向回形针图标、命令名为 `attach-file`。单独的输入框按钮默认保持显示，也可以在替代开启时隐藏，让菜单入口成为唯一上传入口
- 支持多选；每个文件以**预览式附件卡片**显示在输入框上方（图片显示缩略图）：读取中 → 上传中 → 已保存，带"复制路径"与移除按钮，以及仅创建该存储副本的卡片才有的永久删除按钮
- 文件保存在 DSH 宿主机，不会只留在浏览器里
- 文件名清洗（拒绝路径分隔符、`..`、控制字符）+ 同名但内容不同的文件自动追加 `-1`/`-2` 后缀
- **内容寻址防重传** —— 见[防重传机制](#防重传机制)
- UI 文案通过应用 `locale` 服务本地化（zh/en，跟随 dsh web 语言设置或系统默认）

## 模型感知适配与附件卡片设计

上传的文件以**附件卡片**形式显示在输入框上方的 dock 行。卡片是注入行为的唯一依据：

| 状态 | 行为 |
|---|---|
| 卡片存在 | 该文件的绝对路径会注入到**此后发送的每一条用户消息**中 |
| 点击卡片 `×` 关闭 | 插件调用 Host 的 `remove` RPC —— 文件从 pending 注册表移除，**不再注入**，且**保留在磁盘**（模型仍可从 uploads 目录重新读取） |
| 点击卡片 🗑 删除 | 插件调用 Host 的 `delete` RPC —— 文件**从 DSH Host 永久删除**，并同步清理去重索引。仅创建该存储副本的卡片显示 🗑；重复上传命中复用的卡片只保留 `×` |
| Ctrl+V 粘贴 | 粘贴的图片走产品原生草稿管道 —— 不产生卡片，插件完全不干预 |

`×` 与 🗑 的区分是有意为之：`×` 只是停止注入（你可能还希望模型稍后能找到该文件），而 🗑 表示你**永远不再需要这个文件**。删除最后一个引用时文件会从磁盘移除；若另一个活跃会话仍引用同一份去重副本，则保留文件、仅撤销当前会话的引用。

重复上传会命中去重、复用同一个存储路径（见[防重传机制](#防重传机制)），因此这类卡片只是**借用**已有副本、并不拥有它。这类卡片不显示 🗑 —— 从这里永久删除会连带删掉其他引用仍在使用的文件 —— 只保留 `×` 解除引用；文件级删除请到插件设置页操作，那里的「使用中」规则仍会保护被活跃会话引用的文件。

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

1. 上传时插件计算解码字节的 **SHA-256**（宿主机边收边写同一遍完成，用 `node:crypto`）
2. 持久化索引 `uploads/.dfu-index.json`：`hash → { path, at }`（`at` 为上传时间戳，用于清理）
3. 再次上传**相同内容**（同名或不同名）→ **复用已有存储副本**，不写新文件、不产生 `-1` 副本，响应带 `dedup: true`
4. 上传经 Promise 队列串行化，并发相同上传不会竞态；索引条目失效（文件被删）时自动回退重新存储

| 场景 | 结果 |
|---|---|
| 同一文件上传 N 次 | 磁盘只存 1 份，所有上传解析到同一路径 |
| 同内容、不同文件名 | 复用首个存储副本 |
| 同名字、不同内容 | 正常的 `-1` 冲突处理（正确） |
| 进程重启 | 索引文件持久化，防重传继续生效 |

索引条目为 `hash → { path, at }`（`at` = 上传时间戳，毫秒，供下面的 TTL 清理使用）。旧版 `hash → path` 条目会被透明读取，并在下次写入时升级为对象格式；不带时间戳的旧条目**永不被 TTL 回收**（仅当文件已不存在时被清理），保护迁移前的历史文件不被误删。

## 清理与保留（TTL 自动回收 + 手动删除）

上传文件通过两种互补方式回收：

### 自动 TTL 回收

每次上传成功、每次永久删除、以及插件启动时，都会触发一次**懒回收**。超过 TTL 且**不在任何活跃会话 pending 引用**中的文件会被从磁盘删除，并同步清理其索引条目。回收与上传走同一条串行队列，不会与在途写入竞争；无需后台任务。

- **默认 TTL**：`7d`（7 天）。
- **保留期单位**：`1s`（秒）、`1m`（分钟）、`1h`（小时）、`1d`（天）；不带单位的纯数字按**天**（兼容旧行为）。`0`（或空/非法值）**禁用自动 GC** —— 此后文件只会通过显式删除离开磁盘：创建该存储副本的卡片上的 🗑，或设置页的文件管理。
- **配置**：在 **设置 → 文件上传**（DSH 原生设置面板；该选项卡带专属回形针图标，与输入框按钮同为斜 45° 的同一枚图标，不会和其他插件的齿轮图标混淆）中，保留期输入框与两个上传入口开关（「替代官方添加文件入口」「始终显示单独的附件上传按钮」）共用同一个保存按钮。插件将三项写入 `~/.dsh/dsh-web-file-uploader.json`（`{ ttl, replaceOfficial, alwaysShowButton }`），且按字段合并更新——保存一项不会清掉其他项。环境变量 `DSH_UPLOAD_TTL`（如 `DSH_UPLOAD_TTL=30m`）作为兜底在默认值之前生效。

### 输入框按钮的位置与「替代官方添加文件入口」

输入框工具行依次是：「＋」添加按钮 → 插件回形针按钮 → 权限/模式按钮。本插件按钮被放在**「＋」按钮右侧、权限/模式按钮之前**。整个过程不搬动任何 React 拥有的节点：shell 的插槽容器是 `display: contents`，因此用 flex `order` 重排行即可——插件按钮为 1，shell 在「＋」之后绘制的内容为 2。

官方上传入口位于 shell 的命令菜单里：`＋` 添加按钮与 `/` 斜杠菜单渲染同一个命令源，其「添加」分组中有一项「文件」。两个设置决定本插件把上传入口放在哪里：

| 「替代官方添加文件入口」 | 「始终显示单独的附件上传按钮」 | 效果 |
|---|---|---|
| 关闭（默认） | 开启（默认） | 两个上传入口：本插件输入框按钮 + shell 自己菜单里的「文件」项 |
| 开启 | 开启 | shell 的「文件」项原位换成插件入口（文字仍是「文件」、斜向回形针、命令名 `attach-file`，保留原「添加」分组与位置）；输入框按钮照常显示 |
| 开启 | 关闭 | 同上替换，并隐藏输入框旁的单独按钮——菜单项成为唯一上传入口 |
| 关闭 | 关闭 | 输入框按钮照常显示：未开启替代时不会有插件菜单项，再隐藏按钮就没有入口了 |

- 保存后立即生效，无需刷新；此后新挂载的输入框同样生效。
- 替换后的菜单项沿用官方项的位置与「添加」分组，菜单除图标与命令名外，观感不变；其动作打开的就是输入框按钮使用的同一个文件选择器——只有一条上传路径。
- 若此刻 shell 自己都不提供「文件」项（例如附件能力不可用），插件也不会额外插入自己的项，避免出现点不了的入口。替换依赖 shell 的命令服务（`commandUi`）；shell 不提供该服务时替换不会生效，官方入口保持原样。
- 关闭替代并保存、停用或卸载插件，官方「文件」项都会在两个菜单里恢复成 shell 原本的样子；被隐藏的单独按钮也会恢复正常行内位置。
- 隐藏按钮采用「脱离布局但不卸载」的方式，菜单动作仍能点击它挂载的 file input；除此之外工具行保持原样。
- 替代开启期间，原生的「文件」动作在两个菜单里消失，选文件一律走本插件的选择器——上传、进度与自动清理全部由本插件负责。
- 本插件按钮不会因运行中而禁用——此时选择的文件会在下一步注入。

### 两种卡片操作（回顾）

| 操作 | Host 调用 | 磁盘上的文件 |
|---|---|---|
| `×` 关闭 | `remove` | **保留** —— 模型可重新读取 |
| 🗑 删除 | `delete` | **永久移除** —— 仅创建该存储副本的卡片提供；复用副本的重复上传卡片不显示 |

关闭一张**仍在上传中**的卡片会先弹确认：字节还在路上，两个答案都是真实的选择——「确认取消上传」立刻中断传输并丢弃已暂存的字节（不会落盘），「返回继续上传」则关闭询问、保留卡片（以及它传完后的引用）。两种选择都不会留下孤儿文件；确认只在上传进行中出现，已完成的卡片仍然一键关闭（= 取消引用，不删文件）。

`delete` Host 调用先撤销本会话引用，检查是否还有其它活跃会话引用同一份去重副本：仅当无其它引用时才删除文件并清理索引；若仍被引用则保留文件（`removed: false`），但当前会话的卡片仍会被清除。

## 附件大小限制

- **没有单文件上限**：宿主机把浏览器发来的请求体**边收边写**进暂存文件、同一遍算 SHA-256，不会把整个文件读进内存（实测 120 MiB 上传期间进程内存增长 < 1 MiB），最终只受磁盘空间限制。
- 上传期间卡片显示百分比：来自 XHR 的 `upload.onprogress`。
- **编码回退路径**：调用方若不传 `File` 而直接给 base64，会在浏览器侧解码后走同一条流式路由 POST 出去——没有单文件上限，但解码后的副本会占用页面内存。
- 多模态原生注入图片时，额外遵循部署的 `attachments` 限制（单消息字节/像素上限）。

## 安装方式

插件以**静态 bundle** 形式分发——即持久的 dsh profile 层。**可安装产物是附加在 GitHub Release 上的已构建 tarball**。包声明了 `dsh.bundle.patch`（见 `cordis.patch.yml`），因此 `dsh plugin --profile web add` 会将其识别为 profile 层：

```bash
# GitHub Release tarball（推荐：已构建好）
dsh plugin --profile web add \
  https://github.com/Mooling0602/dsh-web-file-uploader/releases/download/1.0.0-alpha.2/dsh-web-file-uploader-1.0.0-alpha.2.tgz

# npm registry（预发布版本发布在 `next` 标签下）
dsh plugin --profile web add dsh-web-file-uploader@next

# Git 仓库（安装时重新构建；pnpm 会询问是否允许构建脚本）
dsh plugin --profile web add github:Mooling0602/dsh-web-file-uploader

# 本地目录（开发用；先在目录里跑 `pnpm build`）
dsh plugin --profile web add ../dsh-web-file-uploader
```

仓库**只提交源码**：`lib/` 与 `client/src/client.js` 是 git 忽略的构建产物，由 `pnpm build`（以及安装时运行的 `prepare` 脚本）生成。刚从 clone 出来的目录没有 bundle，因此想要开箱即装的包请用 Release tarball（或 npm）；从 git 安装则需允许 pnpm 执行 `prepare` 脚本。tarball URL 会被钉在 profile 里，跨版本更新需要 `remove` 后再 `add` 新 URL。

> **Git 规格说明**：pnpm 的 git 简写是 `github:<owner>/<repo>`（如
> `github:Mooling0602/dsh-web-file-uploader`）。裸写 `github.com/<owner>/<repo>`
> 会被 pnpm 当作*本地目录*，报 "non-existent directory" 警告。其他合法形式：
> `git+https://github.com/Mooling0602/dsh-web-file-uploader.git` 或
> `https://github.com/Mooling0602/dsh-web-file-uploader.git`。

重启 dsh web 进程并刷新页面。分发细节与「推送裸版本号标签即自动发布 pre-release」的发布流程见 [PUBLISHING.md](PUBLISHING.md)。

### 更新

`dsh plugin` 只是把参数转发给 profile 目录下的 pnpm，因此更新也走它（不要手改
`~/.dsh/profiles/web/node_modules`——下次 pnpm 操作会直接覆盖）：

```bash
# GitHub Release tarball：URL 被钉住，需要换到新版本资源
dsh plugin --profile web remove dsh-web-file-uploader
dsh plugin --profile web add \
  https://github.com/Mooling0602/dsh-web-file-uploader/releases/download/<version>/dsh-web-file-uploader-<version>.tgz

# git 渠道：重新解析分支并在安装时重建
dsh plugin --profile web update dsh-web-file-uploader
# 若 lockfile 钉住的解析不肯移动，可以退回重装：
dsh plugin --profile web remove dsh-web-file-uploader
dsh plugin --profile web add github:Mooling0602/dsh-web-file-uploader
```

更新后重启 dsh web 进程；浏览器端 bundle URL 自带内容哈希版本号（`?rev=…`），刷新页面即可拿到新构建，无需手动清缓存。本地目录安装则在重新 add 前先在源码目录跑一次 `pnpm build`。详见 [PUBLISHING.md](PUBLISHING.md#update)。

## 架构

```
浏览器 (Client)                          DSH 宿主机 (Host)
─────────────                             ─────────────────
conversation.input.left                   webServer 路由 POST /upload
  └ 回形针 ── File（请求体）─────────────► 先写 .dfu-tmp-*，同一遍增量 SHA-256
                                            提交：去重 → 定名 → 移入 → .dfu-index.json
                                            $DSH_HOME/uploads
ui-commands（＋ / 斜杠菜单）
  └ attach-file 行（替代开启时）── 打开同一个文件选择器
conversation.input.dock                   remove 路由（保留文件）
  └ 附件卡片（持久）                       └ pending 条目删除（文件保留）
       └ × 关闭卡片 → 停止注入             delete 路由（永久删除）
       └ 🗑 删除卡片                        └ 撤销 pending → 删除文件 + 清理索引
                                           懒 TTL 回收（上传 / 删除 / 启动）
                                              └ 删除超 TTL 且不在 pending 中的文件
                                           agent/pre-step 瀑布
                                              ├ resolveModelInfo → 是否多模态？
                                              ├ attachments.saveImage → ImageBlock
                                              └ 路径文本块（仅用户消息）
```

浏览器不会以 base64 形式持有字节：`File` 本身就是请求体，宿主机边收边写进暂存文件，同一遍完成哈希。

## 保存位置

上传文件落在 `$DSH_HOME/uploads`（默认 `~/.dsh/uploads`），经 `node:fs` 直写——即 dsh 数据目录。

防重传索引（`uploads/.dfu-index.json`）与存储文件同目录。

## 仓库结构

项目采用**核心单一来源 + 薄缝隙层**架构，全部以 TypeScript 编写：所有业务逻辑都在 `src/core/` 中，发布产物只是其上的薄适配层，改一处即可生效。

```
dsh-web-file-uploader/
├── src/
│   ├── core/
│   │   ├── host.ts             # 规范 Host 逻辑（传输无关，依赖注入）
│   │   └── client.ts           # 规范 Client 逻辑（传输无关，依赖注入）
│   ├── index.ts                # Host 缝隙：webServer 路由 + node:fs/crypto
│   ├── client-static.ts        # Client 缝隙：XHR/fetch 传输 + 模块 react
│   └── types.ts                # 手工维护的 dsh 插件 API 类型子集
├── lib/                        # 构建产物（git 忽略）：发布用 bundle
│   ├── index.js                # 编译后的 Host 半（只 import ./core/*）
│   ├── core/host.js
│   └── client.js               # Client 核心已内联进 web loader 工厂
├── client/src/client.js        # 构建产物（git 忽略）：由 src/ 生成
├── test/
│   ├── host.test.ts            # Host 核心回归套件（流式 intake 路径）
│   ├── settings-panel.test.ts  # 设置面板套件（桩 React，无浏览器）
│   ├── cards.test.ts           # 输入框附件卡片套件（桩 React，无浏览器）
│   ├── bundle.test.ts          # 通过 loader 契约加载已发布客户端 bundle
│   └── release-notes.test.ts   # 发布日志合成 CLI（发布日志门禁）
├── scripts/
│   ├── build.ts                # tsc + 内联 Client 核心 + 包装工厂
│   ├── release-notes.ts        # 由 CHANGELOG.md 合成发布说明正文
│   └── sync-profile.ts         # 热补丁已安装 profile 并校验
├── tsconfig.json               # strict；将 src/ 编译进 lib/
├── cordis.patch.yml            # dsh.bundle 补丁（profile 层行）
├── package.json                # 可发布清单（dsh.bundle + dsh.client）
├── PUBLISHING.md               # 安装与发布指南
├── CHANGELOG.md                # 发布日志：全局 Header/Endfix + 各版本小节
├── README.md / README_zh_CN.md
└── LICENSE                     # MIT
```

**如何修改代码**：编辑 `src/core/*`（或缝隙层），然后运行 `pnpm build`——它把 Host 半编译进 `lib/`，并重新生成客户端包（`lib/client.js` 与 `client/src/client.js`）。两者都被 git 忽略：仓库只有源码，`pnpm install` 会通过 `prepare` 脚本执行同样的构建，发布工作流也会在打包 tarball 前先构建。每次改动都应通过 `pnpm typecheck` 与 `pnpm test`；所有套件与工具脚本都是 TypeScript，由 Node 直接运行（类型剥离），因此 bundle 套件会现场构建并加载已发布 bundle，发布日志套件也会直接跑其 CLI，无需额外编译步骤。

## 开发状态

- ✅ 静态 bundle：卡片驱动注入、模型感知适配、防重传、i18n UI、带批量删除的设置面板，以及可替换的「添加/斜杠」菜单入口——全部由测试覆盖
- ✅ 分发：每个裸版本号标签都会跑 CI、构建 bundle，并把可安装 tarball 附加到 GitHub Release（安装端无需构建）
- ⚠️ `scripts/build.ts` 中的客户端包装器是对 DSH web 工具链产物的尽力模拟；正式分发前需对照真实 web 构建验证（与官方 `@deepseek-ai/dsh-client-*` 的 `lib/client.js` 对比）

## 许可证

MIT
