# 砚纸研习 · YanZhi Study (Antigravity 独立护眼全栈皮肤)

一套**完全独立、零第三方依赖、纯 MIT 协议开源**的 Google Antigravity 护眼双模皮肤、字体排版、中文界面汉化与本地实时性能指标工具。

---

## ✨ 核心特性

1. **昼夜双护眼调色板（低眩光、柔边界）**
   - **☀️ 晨光竹纸（Day）**：主画布 `#F6F4ED`、侧栏 `#ECE9DF`、卡片/输入区 `#FBF9F4`、深墨炭字 `#252724`（对比度约 `12.5:1`）、聚焦强调色为**松烟青绿 `#3D6B52`**。
   - **🌙 夜读松烟（Night）**：主画布 `#1B1D1A`、侧栏 `#151714`、卡片 `#232622`、羊皮暖白字 `#DDD9CE`（对比度约 `10.8:1`）、聚焦强调色为**浅翠松烟 `#6CA584`**。

2. **规范的中西文四层字体匹配与 KaTeX 公式保护**
   - **UI 控件 / 侧栏 / 输入框**：`Anthropic Sans` + `Noto Sans SC` + `MiSans` + `Segoe UI Variable`
   - **对话正文与长文阅读**（侧栏底部支持一键切换）：
     - **黑体**：`Anthropic Sans` + `Noto Sans SC`（`15.5px` / 行高 `1.72`）
     - **宋体**：`Anthropic Serif` + `Noto Serif SC`（替代 Windows 默认 `SimSun` 宋体）
   - **代码块 / 终端 / 指标**：`Cascadia Mono` + `Anthropic Mono` + `Noto Sans SC`（等宽数字 `tabular-nums`）
   - **KaTeX 数学公式保护**：严格保留 `.katex` 原生数学字体，同时使公式内 `\text{...}` 中文与正文保持一致。

3. **独立本地实时性能指标胶囊（`node:sqlite` + CDP）**
   - 直接只读解析本地 `~/.gemini/antigravity/conversations/<cascadeId>.db` 的 `gen_metadata` 记录，在输入框底部同行实时展示：
     - **生成速度 (`tok/s`)**、**首字耗时 (`TTFT`)**、**上下文水位 (`Ctx / Limit`)**、**本轮输出 (`Out`)**
     - 鼠标悬停显示完整双层统计卡片（含思考 Token、缓存命中率与累计会话输出）。

4. **独立原创中文界面汉化（含常见 Skills 详细说明）**
   - 内置纯原创 UI 词典与常见内置/扩展 Skill 说明翻译，采用 `WeakMap` 记录原始英文文本，支持随时关闭或卸载并无损还原；严格隔离代码块、输入区、对话正文与历史标题防误翻。

5. **极简热重载与非侵入式注入**
   - 仅通过本地 `127.0.0.1` CDP 注入渲染层，**不修改 Antigravity 客户端安装包与 `.asar` 文件**；修改 `config.json` / `src/*` 后 2 秒自动热刷新。

---

## 🚀 一键安装与使用

前置要求：**Node.js `>= 22.0.0`**（推荐 `>= 22.13.0` 以启用内置 `node:sqlite` 实时指标胶囊）。

```bash
git clone https://github.com/Over9rowth/yanzhi-antigravity-skin.git
cd yanzhi-antigravity-skin
node cli.mjs install
node cli.mjs verify
```

### 常用命令

| 命令 | 说明 |
| :--- | :--- |
| `node cli.mjs install` | 安装至 `~/.gemini/yanzhi-skin`，自动开启调试端口与登录自启，并启动守护进程 |
| `node cli.mjs verify` | 立即向已打开的 Antigravity 窗口注入并输出实时验收状态 |
| `node cli.mjs doctor` | 检查 Node 版本、`node:sqlite`、守护进程状态与 CDP 端口连通性 |
| `node cli.mjs uninstall` | 停用注入并无损还原窗口原貌，同时清理开机自启项 |

---

## 📁 项目结构

```text
yanzhi-antigravity-skin/
├── cli.mjs          # 一键安装、验证、自检与卸载 CLI
├── config.json      # 开关配置（enabled / mode / font / fontSize / features）
├── src/
│   ├── daemon.mjs   # 独立 CDP 守护进程、node:sqlite 指标解析与热重载
│   ├── runtime.js   # 浏览器端注入引擎（主题、快捷条、指标胶囊、WeakMap 汉化）
│   ├── theme.css    # 晨光竹纸 & 夜读松烟双模护眼样式表
│   └── i18n.json    # 原创中文界面与常见 Skill 说明词典
├── LICENSE          # MIT License
└── README.md
```

---

## 📄 开源协议

本项目全部代码均从零独立编写，采用 [MIT License](LICENSE) 开源。
