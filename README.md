# 实时股价 · Real-time Stock Price

[中文](#中文) | [English](#english)

一个基于 Manifest V3 的浏览器扩展：在所有网页之上显示全局可拖动的股价悬浮球，实时展示最新价与涨跌幅，支持自行配置多只 A股 / 港股 / 美股 / 场内 ETF·LOF 并一键切换，内置技术预测、主力资金流与龙虎榜信号、热榜资讯参考。

A Manifest V3 browser extension that shows a draggable global floating ball over every web page with real-time stock prices and change percentages. Configure your own watchlist across A-shares / HK / US stocks / ETFs·LOFs and switch between them with one click. Built-in technical prediction, main capital flow & Dragon-Tiger List signals, and hot-list news references.

---

## 中文

### 简介

「实时股价」是一款面向普通投资者的轻量级行情扩展。它不预设任何股票，所有标的均由你自行搜索添加、完全自由配置。悬浮球常驻所有网页之上，盘中每 3 秒自动刷新，收盘后每 15 秒刷新，按市场自动识别交易时段。

数据源为腾讯行情（主），A股失败时自动降级东方财富（备）。样式使用 Shadow DOM 完全隔离，不污染网页。

### 功能特性

- **全局悬浮球**：在所有网页之上显示可拖动的悬浮球，实时展示最新价、涨跌幅（红涨绿跌）；松手自动贴边停靠，位置跨网页记忆，首次使用有操作提示
- **多股票支持**：A股（沪深北）/ 港股 / 美股 / 场内 ETF·LOF / 上金所现货（黄金9999 等），行情卡顶部标签栏一键切换；完全无预设股票，全部由你自行搜索添加
- **行情详情卡**：点击悬浮球展开，展示今开 / 昨收 / 最高 / 最低 / 成交量 / 成交额 / 换手率 / 振幅 / 市盈率 / 市净率 / 总市值 / 流通市值 / 涨停 / 跌停，以及实时迷你走势
- **双模式预测参考**：基于近 80 个交易日历史统计（均线 MA5/10/20、RSI14、波动率、上涨天数占比）给出方向、次日预测区间与上涨概率；支持「次日」模式（日K统计 + 回测校准）与「实时」模式（分时K线 + 盘中量价），并跨会话追踪预测命中率
- **主力资金流与龙虎榜信号**（仅A股）：主力净流入/流出、5 日累计、连续流入/流出天数、强度等级；龙虎榜近 5 条上榜记录（买卖金额、上榜原因）
- **热榜资讯参考**：聚合热榜数据，按股票名称/代码匹配相关资讯，并对标题做积极/消极情绪分析
- **配置实时同步**：配置修改后所有已打开网页即时生效
- **低权限**：仅申请 `storage` 权限

### 支持的证券类型与代码示例

| 市场 | 示例代码 | 说明 |
| --- | --- | --- |
| A股沪深 | `002895`（川恒股份）、`600519`（贵州茅台）、`300750`（宁德时代） | 直接输入 6 位代码 |
| 北交所 | `835185`（贝特瑞） | 4/8 开头代码 |
| 港股 | `hk00700`（腾讯控股） | 前缀 `hk` |
| 美股 | `usAAPL`（苹果）、`usTSLA`（特斯拉） | 前缀 `us` |
| ETF/LOF | `510300`（沪深300ETF）、`159919`（沪深300ETF嘉实） | 直接输入 6 位代码 |
| 上金所现货 | `AU9999`（黄金9999）、`AU9995`（黄金9995） | 搜「黄金」或「黄金999」即出 |

### 安装方法（Chrome / Edge）

1. 打开浏览器，地址栏输入并回车：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
2. 打开右上角「开发者模式」开关
3. 点击「加载已解压的扩展程序」，选择本仓库文件夹（含 `manifest.json` 的那一层）
4. 加载成功后，打开任意网页即可看到悬浮球

> 要求 Chrome 109+ / Edge 111+（支持 Manifest V3）。

### 如何添加股票

- **方式一（最快）**：点击浏览器工具栏的扩展图标，弹出配置面板。在搜索框输入名称/代码（如：`茅台`、`002895`、`hk00700`、`usAAPL`、`510300`），点击候选项即加入列表并设为当前展示；点击已配置列表中的某项可切换展示，悬停可移除
- **方式二**：点击悬浮球展开行情卡 → 「设置」按钮 → 完整设置页添加 / 切换 / 移除
- **方式三**：在扩展管理页（`chrome://extensions`）点击本扩展「详情」→「扩展程序选项」

### 预测参考说明

预测基于历史价格统计：均线排列判断方向（多头 / 空头 / 震荡）、近 20 日收益率标准差估算次日 ±1σ 区间、上涨天数占比估算概率、RSI14 提示超买超卖。

> ⚠️ 该预测为简易技术性参考，**不构成任何投资建议**，市场有风险，投资需谨慎。港美股仅展示核心行情与市盈率，预测仍可用（基于其日K线统计）。

### 数据源与隐私

- 行情数据：腾讯行情（主）；A股失败自动降级东方财富（备用）
- 主力资金流 / 龙虎榜：东方财富（仅A股）
- 热榜资讯：moyuhot.com、nowhots.com
- 全部为公开免费接口，仅供展示；接口偶有波动，扩展已做双源切换与重试
- 配置保存在浏览器扩展存储（`chrome.storage.local`）中，**卸载扩展后配置会清除**，不上传任何数据

### 升级说明

- 若已安装旧版（2.x 及更早），请先在扩展管理页「移除」，再重新加载本文件夹
- 旧版单股票配置会自动迁移为列表中的第一只股票；新版完全无预设股票

### 注意事项

- 浏览器内置页面（`chrome://`、应用商店、PDF 查看器等）出于安全限制不显示悬浮球
- 数据与预测仅供参考，不构成投资建议

### 项目结构

```
├── manifest.json      # Manifest V3 清单
├── background.js      # Service Worker：行情抓取、预测、资金流/龙虎榜、热榜资讯
├── content.js         # 内容脚本：悬浮球与行情卡 UI（Shadow DOM 隔离）
├── config.js          # 公共配置逻辑（存储、市场/类型标签、搜索与行情接口）
├── popup.html / popup.js   # 工具栏弹窗：快速搜索添加、切换
├── options.html / options.js # 完整设置页
├── icons/             # 扩展图标（16 / 48 / 128）
└── 安装说明.txt        # 安装与使用说明
```

### License

MIT

---

## English

### Introduction

**Real-time Stock Price** is a lightweight quotes extension for everyday investors. It ships with **zero preset stocks** — you search and add every instrument yourself, with full freedom of configuration. The floating ball stays on top of all web pages, auto-refreshing every 3 seconds during trading hours and every 15 seconds after close, automatically detecting each market's trading sessions.

Quotes come from Tencent (primary), with automatic fallback to Eastmoney (backup) for A-shares. All styles are fully isolated via Shadow DOM and never pollute the host page.

### Features

- **Global floating ball**: a draggable ball on top of every web page showing the latest price and change % (red up / green down). It snaps to the screen edge on release and remembers its position across pages; first-time users get a quick hint
- **Multi-stock watchlist**: A-shares (Shanghai / Shenzhen / Beijing), HK stocks, US stocks, exchange-traded ETFs/LOFs, and SGE spot gold (e.g. AU9999 gold). Switch between them via the tab bar on the quote card — zero preset stocks, you configure everything
- **Detail quote card**: click the ball to expand — open / prev close / high / low / volume / turnover / turnover rate / amplitude / P/E / P/B / total market cap / float market cap / limit-up / limit-down prices, plus a real-time mini chart
- **Dual-mode prediction reference**: based on statistics over the last 80 trading days (MA5/10/20, RSI14, volatility, ratio of up days) it estimates direction, a next-day prediction range, and the probability of an up move. Two modes: **Next-day** (daily-K stats + backtest calibration) and **Real-time** (intraday tick K-line + volume-price). Prediction hit rate is tracked across sessions
- **Main capital flow & Dragon-Tiger List signals** (A-shares only): main net inflow/outflow, 5-day cumulative flow, consecutive inflow/outflow streak, and strength level; up to 5 recent Dragon-Tiger List appearances (buy/sell amounts and reasons)
- **Hot-list news reference**: aggregates trending news, matches items to your stocks by name/code, and scores headline sentiment (positive / negative)
- **Live config sync**: changes apply instantly to every already-open page
- **Minimal permissions**: only `storage` is requested

### Supported securities & example codes

| Market | Example codes | Notes |
| --- | --- | --- |
| A-shares (SH/SZ) | `002895` (Chuanheng), `600519` (Kweichow Moutai), `300750` (CATL) | type the 6-digit code directly |
| Beijing Stock Exchange | `835185` (BTR) | codes starting with 4/8 |
| Hong Kong | `hk00700` (Tencent) | prefix `hk` |
| US | `usAAPL` (Apple), `usTSLA` (Tesla) | prefix `us` |
| ETF/LOF | `510300` (CSI 300 ETF), `159919` (CSI 300 ETF Jiashi) | type the 6-digit code directly |
| SGE spot gold | `AU9999` (Gold 9999), `AU9995` (Gold 9995) | search "黄金" or "黄金999" |

### Installation (Chrome / Edge)

1. Open your browser and go to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this repository folder (the one containing `manifest.json`)
4. Once loaded, the floating ball appears on any web page

> Requires Chrome 109+ / Edge 111+ (Manifest V3 support).

### How to add stocks

- **Fastest way**: click the extension icon in the toolbar. Type a name or code in the search box (e.g. `Moutai`, `002895`, `hk00700`, `usAAPL`, `510300`), then click a suggestion to add it and make it active. Click any item in the configured list to switch; hover to remove
- **Via the card**: click the floating ball → **Settings** button → full settings page for add / switch / remove
- **Via browser**: `chrome://extensions` → this extension's **Details** → **Extension options**

### About the prediction

The prediction is based on historical price statistics: MA alignment for direction (bullish / bearish / ranging), the std-dev of the last 20 days' returns for a ±1σ next-day range, the ratio of up days for probability, and RSI14 for overbought/oversold hints.

> ⚠️ This is a simple technical reference and **does NOT constitute investment advice**. Markets are risky. For HK/US stocks only core quotes and P/E are shown; the prediction still works (based on their daily K-line statistics).

### Data sources & privacy

- Quotes: Tencent (primary); automatic fallback to Eastmoney (backup) for A-shares
- Main capital flow / Dragon-Tiger List: Eastmoney (A-shares only)
- Hot-list news: moyuhot.com, nowhots.com
- All public free APIs, display purposes only; the extension handles source switching and retries on API hiccups
- Your config is stored in `chrome.storage.local` and is **cleared when the extension is uninstalled**. No data is uploaded anywhere

### Upgrading

- If you have an old version (2.x or earlier), **remove** it on the extensions page first, then reload this folder
- The old single-stock config auto-migrates to the first item of the list; the new version has zero preset stocks

### Notes

- The floating ball does not render on built-in browser pages (`chrome://`, Web Store, PDF viewer, etc.) due to security restrictions
- Data and predictions are for reference only and do not constitute investment advice

### Project structure

```
├── manifest.json      # Manifest V3 manifest
├── background.js      # Service worker: quotes, prediction, flow/Dragon-Tiger, hot news
├── content.js         # Content script: floating ball & quote card UI (Shadow DOM isolated)
├── config.js          # Shared config logic (storage, market/type labels, search & quote APIs)
├── popup.html / popup.js   # Toolbar popup: quick search & switch
├── options.html / options.js # Full settings page
├── icons/             # Extension icons (16 / 48 / 128)
└── 安装说明.txt        # Installation & usage notes (Chinese)
```

### License

MIT
