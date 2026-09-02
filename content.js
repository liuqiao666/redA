/* 实时股价 · 内容脚本（多股票版）
 * 在所有网页顶部注入全局悬浮球（Shadow DOM 隔离样式）。
 * 股票列表存于 chrome.storage（chhStocks），当前展示索引存于 chhActive；
 * 无内置默认股票，全部由用户自行添加；配置修改后所有页面实时生效。
 * 行情经后台 Service Worker 拉取，异常时降级为页面内直接 fetch。 */
(() => {
'use strict';

if (window.__CHH_FLOAT_INSTALLED__) return;
window.__CHH_FLOAT_INSTALLED__ = true;

var TX_URL = 'https://qt.gtimg.cn/q=';
var MARKET_LABEL = { sz: '深交所', sh: '上交所', bj: '北交所', hk: '港股', us: '美股', sg: '上金所' };
var THEME = {
  blue: '#2563eb', blueDeep: '#1d4ed8', blueLight: '#eff6ff',
  ink: '#0f172a', ink2: '#475569', ink3: '#94a3b8',
  line: '#e2e8f0', lineSoft: '#eef2f7',
  up: '#e5484d', down: '#10a37f'
};

var stocks = [];
var activeIdx = 0;
var cfg = null;
var state = { price: null, prevClose: null, open: null, high: null, low: null, volHand: null,
  amtYuan: null, turnover: null, pe: null, pb: null, totalCap: null, floatCap: null,
  lu: null, ld: null, change: null, pct: null, t: '' };
var hist = [];
var paused = false;
var visible = true;
var timer = null;
var lastStatus = '';
var srcKind = 'tx';

/* ================= 构建 Shadow DOM ================= */
var host = document.createElement('div');
host.id = 'chh-float-host';
host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;pointer-events:none;';
(document.documentElement || document.body).appendChild(host);

var root = host.attachShadow({ mode: 'closed' });
var CSS = `
:host{all:initial}
*{margin:0;padding:0;box-sizing:border-box;font-family:'PingFang SC','Noto Sans CJK SC','Microsoft YaHei',-apple-system,sans-serif}
.ball{
  position:fixed;width:78px;height:78px;border-radius:50%;cursor:grab;touch-action:none;
  pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
  background:#ffffff;border:2px solid ${THEME.blue};
  box-shadow:0 6px 22px rgba(37,99,235,.26),0 2px 6px rgba(15,23,42,.06);
  transition:transform .18s ease,box-shadow .4s ease;user-select:none;-webkit-user-select:none;
}
.ball:hover{transform:scale(1.06);box-shadow:0 10px 30px rgba(37,99,235,.38)}
.ball.dragging{cursor:grabbing;transform:scale(1.1);transition:none}
.ball .tag{font-size:9.5px;font-weight:600;letter-spacing:.04em;color:${THEME.blue};margin-top:1px}
.ball .price{font-family:'DIN Alternate','Bahnschrift Condensed','Rajdhani','Avenir Next Condensed',sans-serif;font-size:16px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;color:${THEME.ink}}
.ball .pct{font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-size:9px;letter-spacing:.04em;font-variant-numeric:tabular-nums}
.ball .hold{display:none;font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-size:8.5px;font-weight:600;letter-spacing:.02em;font-variant-numeric:tabular-nums}
.ball .hold.on{display:block}
.ball .hold.up{color:${THEME.up}}
.ball .hold.down{color:${THEME.down}}
.ball .hold.flat{color:${THEME.ink3}}
.ball.up .price,.ball.up .pct{color:${THEME.up}}
.ball.down .price,.ball.down .pct{color:${THEME.down}}
.ball.flat .price{color:${THEME.ink}}
.ball.flat .pct{color:${THEME.ink3}}
.ball.empty .tag,.ball.empty .price{color:${THEME.ink3}}
@keyframes ring{0%{transform:scale(.55);opacity:.9}100%{transform:scale(1.4);opacity:0}}
.ball.flash::after{content:'';position:absolute;inset:-5px;border-radius:50%;border:2px solid ${THEME.blue};animation:ring .7s ease-out forwards;pointer-events:none}
.ball .x{
  position:absolute;top:-6px;right:-6px;width:21px;height:21px;border-radius:50%;
  background:#0f172a;color:#fff;font-size:12px;font-weight:600;line-height:17px;text-align:center;
  border:2px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.3);cursor:pointer;
  opacity:.6;transition:opacity .18s,transform .18s,background .2s;
  font-family:-apple-system,'PingFang SC',sans-serif;pointer-events:auto;
}
.ball:hover .x{opacity:1}
.ball .x:hover{background:${THEME.up};transform:scale(1.12)}
.ball.dragging .x{opacity:.35}

.hint{
  position:fixed;pointer-events:none;white-space:nowrap;
  background:#0f172a;border:1px solid #1e293b;color:#fff;
  font-size:11px;letter-spacing:.06em;padding:6px 12px;border-radius:8px;
  box-shadow:0 8px 24px rgba(15,23,42,.25);
  opacity:0;transform:translateY(6px);transition:opacity .3s,transform .3s;
}
.hint.show{opacity:1;transform:none}

.card{
  position:fixed;width:700px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);
  overflow-y:auto;overflow-x:hidden;
  scrollbar-width:thin;scrollbar-color:#cbd5e1 transparent;
  background:#ffffff;border:1px solid ${THEME.line};border-radius:16px;
  box-shadow:0 24px 60px rgba(15,23,42,.16),0 4px 14px rgba(15,23,42,.06);
  opacity:0;transform:scale(.94) translateY(8px);pointer-events:none;
  transition:opacity .22s ease,transform .24s cubic-bezier(.2,.9,.3,1.18);
}
.card::-webkit-scrollbar{width:8px}
.card::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px;border:2px solid #fff}
.card::-webkit-scrollbar-thumb:hover{background:#94a3b8}
.card.open{opacity:1;transform:none;pointer-events:auto}
/* 顶部双栏：左侧 股票名+实时价，右侧 AI 智能研判 */
.card .top{display:flex;gap:14px;padding:16px 18px 0}
.card .topL{flex:0 0 240px;min-width:0;display:flex;flex-direction:column;gap:10px}
.card .topL .hd{padding:0;flex-direction:column;align-items:flex-start;gap:4px}
.card .nameWrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.card .nameWrap .status{margin-top:0}
.card .topL .pxrow{padding:0;flex-wrap:wrap;row-gap:2px}
.card .topR{flex:1;min-width:0;display:flex}
.card .ai{position:relative;flex:1;min-width:0;border:1px solid ${THEME.line};border-radius:12px;
  background:linear-gradient(180deg,#f8fbff,#eef4fc);padding:9px 12px 8px;overflow:hidden}
.card .ai::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:${THEME.ink3}}
.card .ai.up::before{background:${THEME.up}}
.card .ai.down::before{background:${THEME.down}}
.card .aiHd{display:flex;align-items:center;gap:7px;margin-bottom:7px}
.card .aiT{font-size:11px;font-weight:700;letter-spacing:.1em;color:${THEME.ink}}
.card .aiTag{font-size:9.5px;padding:1px 8px;border-radius:99px;font-weight:600;letter-spacing:.04em}
.card .aiTag.pos{color:#b91c1c;background:#fee2e2}
.card .aiTag.neg{color:#047857;background:#d1fae5}
.card .aiTag.neu{color:${THEME.ink2};background:${THEME.lineSoft}}
.card .aiRef{margin-left:auto;font-size:11px;width:20px;height:20px;border-radius:6px;border:1px solid ${THEME.line};background:#fff;color:${THEME.ink2};cursor:pointer;transition:all .15s;line-height:1;font-family:inherit}
.card .aiRef:hover{color:${THEME.blue};border-color:${THEME.blue}}
.card .aiGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.card .aiC{background:#fff;border:1px solid ${THEME.lineSoft};border-radius:8px;padding:5px 6px 6px;min-width:0}
.card .aiLb{display:block;font-size:9.5px;color:${THEME.ink3};letter-spacing:.05em;margin-bottom:3px}
.card .aiV{display:block;font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;color:${THEME.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .aiV.sm{font-size:11.5px}
.card .aiV.xs{font-size:10.5px}
.card .aiV.up{color:${THEME.up}}
.card .aiV.down{color:${THEME.down}}
.card .aiV.flat{color:${THEME.ink2}}
.card .aiBar{display:block;height:4px;border-radius:99px;background:${THEME.lineSoft};margin-top:4px;overflow:hidden}
.card .aiBar i{display:block;height:100%;border-radius:99px;background:${THEME.blue};transition:width .5s ease}
.card .aiSum{font-size:9.5px;color:${THEME.ink3};margin-top:7px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:620px){
  .card .top{flex-wrap:wrap}
  .card .topL{flex-basis:100%}
}
@media (prefers-reduced-motion: reduce){
  .ball,.ball *,.card,.card *,.hint{animation:none!important;transition:none!important}
}
.card .hd{display:flex;align-items:flex-start;justify-content:space-between;padding:16px 18px 0}
.card .name{font-size:17px;font-weight:700;letter-spacing:.02em;color:${THEME.ink}}
.card .code{margin-top:3px;font-size:11px;color:${THEME.ink3};letter-spacing:.06em}
.card .status{display:flex;align-items:center;gap:6px;font-size:11px;color:${THEME.ink2};border:1px solid ${THEME.line};border-radius:99px;padding:4px 10px;margin-top:2px;background:#fff}
.card .status .dot{width:7px;height:7px;border-radius:50%;background:#cbd5e1}
.card .status.live .dot{background:${THEME.blue};box-shadow:0 0 8px ${THEME.blue};animation:pulse 1.6s ease-in-out infinite}
.card .status.dead .dot{background:${THEME.up}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}

.sw{display:flex;gap:6px;padding:12px 18px 2px;overflow-x:auto;scrollbar-width:none}
.sw::-webkit-scrollbar{display:none}
.sw .s{flex-shrink:0;font-size:11px;padding:4px 11px;border-radius:99px;border:1px solid ${THEME.line};color:${THEME.ink2};background:#fff;cursor:pointer;transition:all .15s;white-space:nowrap}
.sw .s:hover{border-color:${THEME.blue};color:${THEME.blue}}
.sw .s.on{background:${THEME.blue};border-color:${THEME.blue};color:#fff}

.card .pxrow{display:flex;align-items:baseline;gap:14px;padding:12px 18px 4px}
.card .px{font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-size:38px;font-weight:700;line-height:1;letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:${THEME.ink}}
.card .px.pop{animation:pop .45s ease}
@keyframes pop{0%{transform:scale(1)}40%{transform:scale(1.06)}100%{transform:scale(1)}}
.card .chg{display:flex;flex-direction:column;gap:2px}
.card .amt{font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-size:15px;font-variant-numeric:tabular-nums}
.card .pctB{font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-size:11px;letter-spacing:.04em;border-radius:5px;padding:1px 7px;font-variant-numeric:tabular-nums}
.card.up .px,.card.up .amt{color:${THEME.up}}
.card.up .pctB{color:#fff;background:${THEME.up}}
.card.down .px,.card.down .amt{color:${THEME.down}}
.card.down .pctB{color:#fff;background:${THEME.down}}
.card.flat .px,.card.flat .amt{color:${THEME.ink}}
.card.flat .pctB{color:${THEME.ink2};background:${THEME.lineSoft}}
.card .spwrap{margin:8px 16px 2px;border:1px solid ${THEME.line};border-radius:10px;background:#fbfdff;overflow:hidden}
.card .chartbar{display:flex;align-items:center;gap:5px;padding:7px 8px;border-bottom:1px solid ${THEME.lineSoft}}
.card .chartbar .ctitle{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;color:${THEME.ink2};margin-right:auto;cursor:pointer;user-select:none}
.card .chartbar .ctitle:hover{color:${THEME.blue}}
.card .chartbar .chev{display:inline-block;font-size:8px;font-style:normal;color:${THEME.ink3};transition:transform .25s}
.card .spwrap.collapsed .chartbar .chev{transform:rotate(-90deg)}
.card .spwrap.collapsed .chartwrap{display:none}
.card .chartbar .cbtn{font-size:10px;padding:3px 7px;border:1px solid ${THEME.line};border-radius:5px;color:${THEME.ink2};background:#fff;cursor:pointer}
.card .chartbar .cbtn.on{color:#fff;background:${THEME.blue};border-color:${THEME.blue}}
.card .chartwrap{position:relative;height:170px;touch-action:none;cursor:crosshair}
.card .chartwrap canvas{display:block;width:100%;height:100%}
.card .charttip{position:absolute;display:none;pointer-events:none;z-index:2;background:#0f172a;color:#fff;border-radius:6px;padding:5px 7px;font-size:10px;line-height:1.5;white-space:nowrap;box-shadow:0 4px 12px rgba(15,23,42,.2)}
.card .charttip.show{display:block}
.card .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px 6px;padding:8px 16px 4px}
.card .cell{background:#f8fafc;border:1px solid ${THEME.lineSoft};border-radius:8px;padding:6px 8px 7px}
.card .cell .lbl{display:block;font-size:10px;color:${THEME.ink3};letter-spacing:.06em;margin-bottom:3px}
.card .cell .val{font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-size:12.5px;color:${THEME.ink};font-variant-numeric:tabular-nums}
.card .luro{display:flex;align-items:center;justify-content:space-between;padding:6px 18px 0;font-size:10.5px;color:${THEME.ink3}}
.card .luro b{font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;color:${THEME.ink2};font-weight:600;margin-left:4px;font-variant-numeric:tabular-nums}
.prd{margin:8px 16px 0;border:1px solid ${THEME.line};border-radius:10px;background:#f8fafc}
.bk{margin:8px 16px 0;border:1px solid ${THEME.line};border-radius:10px;background:#f8fafc}
.bk .bar{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none}
.bk .bar .t{font-size:12px;font-weight:700;letter-spacing:.08em;color:${THEME.ink}}
.bk .bar .sum{flex:1;font-size:10.5px;color:${THEME.ink3};text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bk .bar .chev{font-size:10px;color:${THEME.ink3};transition:transform .2s}
.bk.open .bar .chev{transform:rotate(180deg)}
.bk .body{display:none;padding:2px 12px 12px}
.bk.open .body{display:block}
.bk5{display:grid;grid-template-columns:1fr 52px 1fr;gap:2px 8px;align-items:center}
.bk5 .bcol{display:flex;flex-direction:column;gap:2px}
.bk5 .brow{display:flex;align-items:center;gap:6px;padding:3.5px 8px;border-radius:6px;font-size:11.5px;border:1px solid transparent}
.bk5 .brow .lab{width:22px;font-size:9.5px;letter-spacing:.04em;flex-shrink:0;font-weight:600}
.bk5 .brow .bp{flex:1;font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-weight:700;font-variant-numeric:tabular-nums}
.bk5 .brow .bv{font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-size:10.5px;font-variant-numeric:tabular-nums}
/* 卖盘红系 / 买盘绿系：首档最深，逐档变淡（五档深度渐变） */
.bk5 .ask .brow{background:rgba(229,72,77,.06);border-color:rgba(229,72,77,.10)}
.bk5 .ask .brow .lab{color:rgba(229,72,77,.72)}
.bk5 .ask .brow .bp{color:#d63a3f}
.bk5 .ask .brow.lv1{background:rgba(229,72,77,.17);border-color:rgba(229,72,77,.30)}
.bk5 .ask .brow.lv1 .lab{color:#c22a2f}
.bk5 .ask .brow.lv1 .bp{color:#c22a2f}
.bk5 .ask .brow.lv2{background:rgba(229,72,77,.13)}
.bk5 .ask .brow.lv3{background:rgba(229,72,77,.10)}
.bk5 .ask .brow.lv4{background:rgba(229,72,77,.08)}
.bk5 .ask .brow.lv5{background:rgba(229,72,77,.06)}
.bk5 .bid .brow{background:rgba(16,163,127,.06);border-color:rgba(16,163,127,.10)}
.bk5 .bid .brow .lab{color:rgba(16,163,127,.72)}
.bk5 .bid .brow .bp{color:#0d9775}
.bk5 .bid .brow.lv1{background:rgba(16,163,127,.17);border-color:rgba(16,163,127,.30)}
.bk5 .bid .brow.lv1 .lab{color:#0b805f}
.bk5 .bid .brow.lv1 .bp{color:#0b805f}
.bk5 .bid .brow.lv2{background:rgba(16,163,127,.13)}
.bk5 .bid .brow.lv3{background:rgba(16,163,127,.10)}
.bk5 .bid .brow.lv4{background:rgba(16,163,127,.08)}
.bk5 .bid .brow.lv5{background:rgba(16,163,127,.06)}
.bk5 .brow .bv{color:${THEME.ink2}}
.bk5 .mid{text-align:center;font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-size:15px;font-weight:700;color:#fff;border-radius:8px;padding:7px 0;background:${THEME.ink3};box-shadow:0 1px 3px rgba(15,23,42,.15);font-variant-numeric:tabular-nums}
.bk5 .mid.up{background:${THEME.up}}
.bk5 .mid.down{background:${THEME.down}}
.bkrel{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.bkchip{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid ${THEME.lineSoft};border-radius:99px;padding:3px 9px;font-size:11px}
.bkchip .n{color:${THEME.ink2}}
.bkchip .v{font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-weight:600;font-variant-numeric:tabular-nums}
.bkchip .v.up{color:${THEME.up}}
.bkchip .v.down{color:${THEME.down}}
.bkchip .v.flat{color:${THEME.ink3}}
.prd .bar{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;font-size:10.5px;color:${THEME.ink2}}
.prd .bar .t{color:${THEME.blue};font-weight:600;letter-spacing:.06em}
.prd .bar .sum{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${THEME.ink3};font-size:10px}
.prd .bar .chev{font-size:9px;color:${THEME.ink3};transition:transform .25s}
.prd.open .bar .chev{transform:rotate(180deg)}
.prd .body{display:none;padding:2px 12px 10px}
.prd.open .body{display:block}
.prd .ptabs{display:flex;gap:6px;padding:6px 0 2px;border-bottom:1px solid ${THEME.lineSoft}}
.prd .ptab{font-size:10.5px;padding:3px 12px;border-radius:99px;border:1px solid transparent;color:${THEME.ink3};cursor:pointer;transition:all .15s}
.prd .ptab:hover{color:${THEME.blue}}
.prd .ptab.on{color:${THEME.blue};background:${THEME.blueLight};border-color:#bfdbfe;font-weight:600}
.prd .pane{display:none;padding-top:8px}
.prd .pane.on{display:block}
.prd .r1{display:flex;align-items:center;gap:10px;padding:4px 0 8px;border-bottom:1px dashed ${THEME.line}}
.prd .r1 .dir{font-size:13px;font-weight:700;letter-spacing:.04em}
.prd .r1 .dir.up{color:${THEME.up}}
.prd .r1 .dir.down{color:${THEME.down}}
.prd .r1 .dir.flat{color:${THEME.ink2}}
.prd .r1 .range{font-size:11px;color:${THEME.ink3}}
.prd .r1 .range b{font-family:'DIN Alternate',sans-serif;color:${THEME.ink};font-weight:600;font-variant-numeric:tabular-nums}
.prd .r1 .prob{margin-left:auto;font-size:10.5px;color:${THEME.ink3}}
.prd .r1 .prob b{font-family:'DIN Alternate',sans-serif;font-weight:700}
.prd .r2{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:8px 0 4px}
.prd .r2 span{font-size:10px;color:${THEME.ink3}}
.prd .r2 b{display:block;font-family:'DIN Alternate',sans-serif;font-size:11.5px;color:${THEME.ink2};font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums}
.prd .r3{font-size:10px;color:${THEME.ink3};padding-top:2px;line-height:1.7}
.prd .r3 b{font-family:'DIN Alternate',sans-serif;color:${THEME.ink2};font-weight:600;font-variant-numeric:tabular-nums}
.prd .nhead{display:flex;align-items:center;gap:6px;font-size:10.5px;color:${THEME.ink2};padding:2px 0 6px}
.prd .nhead b{font-weight:700}
.prd .nhead .sub{font-size:10px;color:${THEME.ink3};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prd .nhead .tg{font-size:9.5px;padding:1px 7px;border-radius:99px;font-weight:600}
.prd .nhead .tg.pos{color:#b91c1c;background:#fee2e2}
.prd .nhead .tg.neg{color:#047857;background:#d1fae5}
.prd .nhead .tg.neu{color:${THEME.ink2};background:${THEME.lineSoft}}
.prd .nhead .nref{margin-left:auto;font-size:9.5px;padding:2px 9px;border-radius:99px;border:1px solid ${THEME.line};background:#fff;color:${THEME.ink2};cursor:pointer;transition:all .15s;font-family:inherit;line-height:1.6;flex-shrink:0}
.prd .nhead .nref:hover{color:${THEME.blue};border-color:${THEME.blue}}
.prd .nhead .nref:disabled{opacity:.55;cursor:default}
.prd .nlist{max-height:152px;overflow-y:auto}
.prd .nlist::-webkit-scrollbar{width:4px}
.prd .nlist::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
.prd .nitem{display:flex;align-items:center;gap:6px;padding:6px 2px;border-bottom:1px dashed ${THEME.lineSoft}}
.prd .nitem:last-child{border-bottom:none}
.prd .nitem .nt{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;color:${THEME.ink};cursor:pointer;text-decoration:none}
.prd .nitem .nt:hover{color:${THEME.blue}}
.prd .nitem .np{font-size:9px;color:${THEME.ink3};flex-shrink:0}
.prd .nitem .ntag{font-size:9px;padding:1px 6px;border-radius:99px;flex-shrink:0;font-weight:600}
.prd .nitem .ntag.pos{color:#b91c1c;background:#fee2e2}
.prd .nitem .ntag.neg{color:#047857;background:#d1fae5}
.prd .nitem .ntag.neu{color:${THEME.ink2};background:${THEME.lineSoft}}
.prd .nemp{font-size:10px;color:${THEME.ink3};padding:10px 0 4px;text-align:center}
.prd .qbars{padding:8px 2px 2px}
.prd .qbar{display:flex;align-items:center;gap:7px;padding:3.5px 0}
.prd .qbar .lb{width:32px;flex-shrink:0;font-size:10.5px;color:${THEME.ink2};letter-spacing:.04em}
.prd .qbar .track{flex:1;height:7px;border-radius:99px;background:${THEME.lineSoft};overflow:hidden}
.prd .qbar .fill{display:block;height:100%;border-radius:99px;background:${THEME.blue};transition:width .45s ease}
.prd .qbar .vl{width:30px;text-align:right;font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:${THEME.ink}}
.prd .qbar .wl{width:34px;text-align:right;font-size:9.5px;color:${THEME.ink3};flex-shrink:0}
.prd .qrow2{display:flex;flex-direction:column;gap:3px;padding:6px 2px 2px}
.prd .qsg{font-size:10px;line-height:1.6;color:${THEME.ink2};padding-left:12px;position:relative}
.prd .qsg::before{content:'';position:absolute;left:2px;top:6px;width:5px;height:5px;border-radius:50%}
.prd .qsg.pos::before{background:${THEME.up}}
.prd .qsg.neg::before{background:${THEME.down}}
.prd .qsg.neu::before{background:${THEME.ink3}}
.prd .qrow2 .qhead{font-size:9.5px;color:${THEME.ink3};letter-spacing:.1em;margin-bottom:2px}
.prd .note{font-size:9px;color:${THEME.ink3};padding-top:6px;text-align:right}
.prd .hsum{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:2px 0 8px;border-bottom:1px dashed ${THEME.line}}
.prd .hs{background:#fff;border:1px solid ${THEME.lineSoft};border-radius:8px;padding:6px 8px}
.prd .hs span{display:block;font-size:9px;color:${THEME.ink3};letter-spacing:.04em}
.prd .hs b{display:block;font-family:'DIN Alternate','Bahnschrift Condensed',sans-serif;font-size:13px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums;color:${THEME.ink}}
.prd .hs b.up{color:${THEME.up}}
.prd .hs b.down{color:${THEME.down}}
.prd .hs b.flat{color:${THEME.ink3}}
.prd .hlist{max-height:172px;overflow-y:auto}
.prd .hlist::-webkit-scrollbar{width:4px}
.prd .hlist::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
.prd .hitem{display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px dashed ${THEME.lineSoft}}
.prd .hitem:last-child{border-bottom:none}
.prd .hitem .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;color:${THEME.ink}}
.prd .hitem .sub{font-size:9px;color:${THEME.ink3};flex-shrink:0}
.prd .hitem .pl{font-family:'DIN Alternate',sans-serif;font-size:11px;font-weight:700;flex-shrink:0;min-width:66px;text-align:right;font-variant-numeric:tabular-nums}
.prd .hitem .pl.up{color:${THEME.up}}
.prd .hitem .pl.down{color:${THEME.down}}
.prd .hitem .pl.flat{color:${THEME.ink3}}
.prd .hitem .dp{font-family:'DIN Alternate',sans-serif;font-size:9.5px;flex-shrink:0;min-width:54px;text-align:right;font-variant-numeric:tabular-nums}
.prd .hitem .dp.up{color:${THEME.up}}
.prd .hitem .dp.down{color:${THEME.down}}
.prd .hitem .dp.flat{color:${THEME.ink3}}
.prd .hemp{font-size:10px;color:${THEME.ink3};padding:10px 0 4px;text-align:center}
.prd .hgo{margin-top:6px;text-align:center}
.prd .hgo button{font-size:9.5px;padding:3px 12px;border-radius:99px;border:1px solid ${THEME.line};background:#fff;color:${THEME.blue};cursor:pointer;transition:all .15s;font-family:inherit}
.prd .hgo button:hover{border-color:${THEME.blue};background:${THEME.blueLight}}
.card .srcRow{display:flex;align-items:center;gap:6px;justify-content:flex-end;padding:4px 18px 0;font-size:10px;color:${THEME.ink3}}
.card .srcRow i{width:6px;height:6px;border-radius:50%;background:${THEME.blue}}
.card .srcRow.alt i{background:#f59e0b}
.card .srcRow.off i{background:${THEME.up}}
.card .ft{display:flex;gap:8px;padding:12px 16px 14px}
.card .ft button{flex:1;font-size:11px;letter-spacing:.08em;color:${THEME.ink2};background:#fff;border:1px solid ${THEME.line};border-radius:8px;padding:7px 0;cursor:pointer;transition:color .2s,border-color .2s,background .2s}
.card .ft button:hover{color:${THEME.blue};border-color:${THEME.blue};background:${THEME.blueLight}}
.card .ft button.primary{color:${THEME.blue};border-color:${THEME.blue};background:${THEME.blueLight}}
.card .ft button.primary:hover{background:#dbeafe}
`;
var styleEl = document.createElement('style');
styleEl.textContent = CSS;
root.appendChild(styleEl);

root.innerHTML += `
<div class="ball flat empty" id="ball" role="button" tabindex="0" aria-label="展开股价行情">
  <div class="x" id="btnHideBall" role="button" tabindex="0" aria-label="隐藏悬浮球">×</div>
  <div class="tag" id="ballTag">未配置</div>
  <div class="price" id="ballPx">--</div>
  <div class="pct" id="ballPct"></div>
  <div class="hold" id="ballHold"></div>
</div>
<div class="hint" id="hint">拖动移动 · 点击展开行情</div>
<div class="card" id="card">
  <div class="top">
    <div class="topL">
      <div class="hd">
        <div class="nameWrap"><span class="name" id="cardName">--</span><span class="status" id="status"><span class="dot"></span><span id="stText">连接中</span></span></div>
        <div class="code" id="cardCode">--</div>
      </div>
      <div class="pxrow">
        <div class="px" id="px">--</div>
        <div class="chg"><div class="amt" id="amt">--</div><div class="pctB" id="pctB">--</div></div>
      </div>
    </div>
    <div class="topR">
      <div class="ai" id="aiPanel">
        <div class="aiHd"><span class="aiT">AI 智能研判</span><span class="aiTag" id="aiTag">--</span><button class="aiRef" id="aiRef" title="刷新研判">↻</button></div>
        <div class="aiGrid">
          <div class="aiC"><span class="aiLb">方向判断</span><b class="aiV" id="aiDir">--</b></div>
          <div class="aiC"><span class="aiLb">上行概率</span><b class="aiV" id="aiProb">--</b><span class="aiBar"><i id="aiBar"></i></span></div>
          <div class="aiC"><span class="aiLb" id="aiRngLb">预测区间</span><b class="aiV xs" id="aiRng">--</b></div>
          <div class="aiC"><span class="aiLb">量化评分</span><b class="aiV sm" id="aiScore">--</b></div>
        </div>
        <div class="aiSum" id="aiSum">研判加载中…</div>
      </div>
    </div>
  </div>
  <div class="sw" id="sw"></div>
  <div class="spwrap">
    <div class="chartbar"><span class="ctitle" id="chartToggle"><i class="chev">▾</i>K线走势</span><button class="cbtn on" data-period="intra">分时</button><button class="cbtn" data-period="day">日</button><button class="cbtn" data-period="month">月</button><button class="cbtn" data-period="year">年</button></div>
    <div class="chartwrap" id="chartWrap"><canvas id="spark"></canvas><div class="charttip" id="chartTip"></div></div>
  </div>
  <div class="grid" id="grid"></div>
  <div class="luro">
    <span>涨停<b id="lu">--</b></span>
    <span>跌停<b id="ld">--</b></span>
    <span>更新 <b id="ut">--</b></span>
  </div>
  <div class="prd" id="prd">
    <div class="bar" id="prdBar"><span class="t">智能预测</span><span class="sum" id="prdSum">--</span><span class="chev">▾</span></div>
    <div class="body">
      <div class="ptabs" id="ptabs">
        <span class="ptab on" data-tab="intraday">实时</span>
        <span class="ptab" data-tab="day">次日</span>
        <span class="ptab" data-tab="flow">资金</span>
        <span class="ptab" data-tab="news">资讯</span>
        <span class="ptab" data-tab="quant">量化</span>
        <span class="ptab" data-tab="hold">持仓</span>
      </div>
      <div class="pane" id="paneIntraday">
        <div class="r1">
          <span class="dir" id="idDir">--</span>
          <span class="range">剩余上沿 <b id="idHi">--</b> · 下沿 <b id="idLo">--</b></span>
          <span class="prob">上行概率 <b id="idProb">--</b></span>
        </div>
        <div class="r2">
          <span>现价/均价<b id="idVwap">--</b></span>
          <span>动量<b id="idMom">--</b></span>
          <span>量能<b id="idVol">--</b></span>
          <span>强度<b id="idStr">--</b></span>
        </div>
        <div class="r3">大盘 <b id="idIdx">--</b> · 今低 <b id="idLow">--</b> · 均价 <b id="idVwapLv">--</b> · 昨收 <b id="idPrev">--</b> · 日MA5 <b id="idMa5">--</b></div>
      </div>
      <div class="pane" id="paneDay">
        <div class="r1">
          <span class="dir" id="dDir">--</span>
          <span class="range">次日区间 <b id="dLo">--</b> ~ <b id="dHi">--</b></span>
          <span class="prob">上涨概率 <b id="dProb">--</b></span>
        </div>
        <div class="r2">
          <span>MA5<b id="dMa5">--</b></span>
          <span>MA10<b id="dMa10">--</b></span>
          <span>MA20<b id="dMa20">--</b></span>
          <span>RSI<b id="dRsi">--</b></span>
          <span>MACD<b id="dMacd">--</b></span>
          <span>KDJ<b id="dKdj">--</b></span>
          <span>BOLL<b id="dBoll">--</b></span>
          <span>ATR<b id="dAtr">--</b></span>
        </div>
        <div class="r3">支撑 <b id="dSup">--</b> · 压力 <b id="dRes">--</b> · 跳空 <b id="dGap">--</b> · 置信 <b id="dConf">--</b> · 命中 <b id="dHit">--</b> · 样本 <b id="dN">--</b>日</div>
      </div>
      <div class="pane" id="paneFlow">
        <div class="nhead"><b>资金信号</b><span class="tg neu" id="flTag">--</span><span class="sub" id="flSub">--</span><button class="nref" id="flRef">↻ 刷新</button></div>
        <div class="r1">
          <span class="dir" id="flDir">--</span>
          <span class="range">今日主力净流入 <b id="flMain">--</b></span>
          <span class="prob">占比 <b id="flPct">--</b></span>
        </div>
        <div class="r2">
          <span>超大单<b id="flSuper">--</b></span>
          <span>大单<b id="flBig">--</b></span>
          <span>中单<b id="flMid">--</b></span>
          <span>小单<b id="flSmall">--</b></span>
        </div>
        <div class="r3" id="flRow1">近5日累计 <b id="fl5d">--</b> · 趋势 <b id="flStreak">--</b> · 数据日 <b id="flDate">--</b></div>
        <div class="r3" id="flRow2">龙虎榜 <b id="flLhb">--</b></div>
      </div>
      <div class="pane" id="paneNews">
        <div class="nhead"><b>相关资讯</b><span class="tg neu" id="nTag">--</span><span class="sub" id="nSub">--</span><button class="nref" id="nRef">↻ 刷新</button></div>
        <div class="nlist" id="nList"></div>
      </div>
      <div class="pane" id="paneQuant">
        <div class="nhead"><b>量化评分</b><span class="tg neu" id="qTag">--</span><span class="sub" id="qSub">--</span><button class="nref" id="qRef">↻ 刷新</button></div>
        <div class="r1">
          <span class="dir" id="qDir">--</span>
          <span class="range">综合评分 <b id="qScore">--</b> / 100</span>
          <span class="prob">评级 <b id="qLevel">--</b></span>
        </div>
        <div class="qbars" id="qBars"></div>
        <div class="qrow2" id="qSignals"></div>
        <div class="r3" id="qRow">五因子加权合成，权重可在设置页调整；仅供技术参考，不构成投资建议</div>
      </div>
      <div class="pane" id="paneHold">
        <div class="nhead"><b>持仓汇总</b><span class="tg neu" id="hTag">本地记账</span><span class="sub" id="hSub">--</span><button class="nref" id="hRef">↻ 刷新</button></div>
        <div class="hsum" id="hSum">
          <div class="hs"><span>总市值</span><b id="hMv">--</b></div>
          <div class="hs"><span>累计盈亏</span><b id="hPl">--</b></div>
          <div class="hs"><span>当日盈亏</span><b id="hDay">--</b></div>
        </div>
        <div class="hlist" id="hList"></div>
        <div class="hgo"><button id="hGo">去设置页管理持仓</button></div>
      </div>
      <div class="note">基于历史统计与公开资讯的简易参考，不构成投资建议</div>
    </div>
  </div>
  <div class="bk" id="bk">
    <div class="bar" id="bkBar"><span class="t">盘口</span><span class="sum" id="bkSum">--</span><span class="chev">▾</span></div>
    <div class="body">
      <div class="bk5" id="bk5">
        <div class="bcol ask" id="bkAsk"></div>
        <div class="mid" id="bkMid">--</div>
        <div class="bcol bid" id="bkBid"></div>
      </div>
      <div class="bkrel" id="bkRel"></div>
    </div>
  </div>
  <div class="srcRow" id="srcRow" style="display:none"></div>
  <div class="ft">
    <button id="btnPause">暂停</button>
    <button id="btnNow">刷新</button>
    <button id="btnOpts">设置</button>
    <button class="primary" id="btnClose">收起</button>
    <button id="btnHide">隐藏</button>
  </div>
</div>`;

var ball = root.getElementById('ball');
var card = root.getElementById('card');
var sw = root.getElementById('sw');
var ballTag = root.getElementById('ballTag');
var cardName = root.getElementById('cardName');
var cardCode = root.getElementById('cardCode');
var pxEl = root.getElementById('px');
var amtEl = root.getElementById('amt');
var pctBEl = root.getElementById('pctB');
var ballPx = root.getElementById('ballPx');
var ballPct = root.getElementById('ballPct');
var ballHold = root.getElementById('ballHold');
var stText = root.getElementById('stText');
var statusEl = root.getElementById('status');
var gridEl = root.getElementById('grid');
var utEl = root.getElementById('ut');
var luEl = root.getElementById('lu');
var ldEl = root.getElementById('ld');
var srcRow = root.getElementById('srcRow');
var spark = root.getElementById('spark');
var chartWrap = root.getElementById('chartWrap');
var chartToggle = root.getElementById('chartToggle');
var spwrapEl = root.querySelector('.spwrap');
var chartTip = root.getElementById('chartTip');
var chartBtns = root.querySelectorAll('.cbtn');
var chartPeriod = 'intra', chartRows = [], chartStart = 0, chartEnd = 0, chartHover = -1, chartDrag = null;
var chartAt = 0;
var btnPause = root.getElementById('btnPause');
var btnNow = root.getElementById('btnNow');
var btnOpts = root.getElementById('btnOpts');
var btnClose = root.getElementById('btnClose');
var btnHideBall = root.getElementById('btnHideBall');
var btnHide = root.getElementById('btnHide');
var prd = root.getElementById('prd');
var prdBar = root.getElementById('prdBar');
var prdSum = root.getElementById('prdSum');
var bk = root.getElementById('bk');
var bkBar = root.getElementById('bkBar');
var bkSum = root.getElementById('bkSum');
var bk5 = root.getElementById('bk5');
var bkAsk = root.getElementById('bkAsk');
var bkBid = root.getElementById('bkBid');
var bkMid = root.getElementById('bkMid');
var bkRel = root.getElementById('bkRel');
var boardAt = 0;
var ptabs = root.getElementById('ptabs');
var hMv = root.getElementById('hMv');
var hPlEl = root.getElementById('hPl');
var hDayEl = root.getElementById('hDay');
var hList = root.getElementById('hList');
var hSub = root.getElementById('hSub');
var hRef = root.getElementById('hRef');
var hGo = root.getElementById('hGo');
var holdData = null;
var holdTimer = null;
var idDir = root.getElementById('idDir');
var idIdx = root.getElementById('idIdx');
var idHi = root.getElementById('idHi');
var idLo = root.getElementById('idLo');
var idProb = root.getElementById('idProb');
var idVwap = root.getElementById('idVwap');
var idMom = root.getElementById('idMom');
var idVol = root.getElementById('idVol');
var idStr = root.getElementById('idStr');
var idLow = root.getElementById('idLow');
var idVwapLv = root.getElementById('idVwapLv');
var idPrev = root.getElementById('idPrev');
var idMa5 = root.getElementById('idMa5');
var dDir = root.getElementById('dDir');
var dLo = root.getElementById('dLo');
var dHi = root.getElementById('dHi');
var dProb = root.getElementById('dProb');
var dMa5 = root.getElementById('dMa5');
var dMa10 = root.getElementById('dMa10');
var dMa20 = root.getElementById('dMa20');
var dRsi = root.getElementById('dRsi');
var dMacd = root.getElementById('dMacd');
var dKdj = root.getElementById('dKdj');
var dBoll = root.getElementById('dBoll');
var dAtr = root.getElementById('dAtr');
var dSup = root.getElementById('dSup');
var dRes = root.getElementById('dRes');
var dGap = root.getElementById('dGap');
var dConf = root.getElementById('dConf');
var dHit = root.getElementById('dHit');
var dN = root.getElementById('dN');
var nTag = root.getElementById('nTag');
var nSub = root.getElementById('nSub');
var nList = root.getElementById('nList');
var nRef = root.getElementById('nRef');
var flDir = root.getElementById('flDir');
var flTag = root.getElementById('flTag');
var flSub = root.getElementById('flSub');
var flRef = root.getElementById('flRef');
var flMain = root.getElementById('flMain');
var flPct = root.getElementById('flPct');
var flSuper = root.getElementById('flSuper');
var flBig = root.getElementById('flBig');
var flMid = root.getElementById('flMid');
var flSmall = root.getElementById('flSmall');
var fl5d = root.getElementById('fl5d');
var flStreak = root.getElementById('flStreak');
var flDate = root.getElementById('flDate');
var flLhb = root.getElementById('flLhb');
var qDir = root.getElementById('qDir');
var qTag = root.getElementById('qTag');
var qSub = root.getElementById('qSub');
var qRef = root.getElementById('qRef');
var qScore = root.getElementById('qScore');
var qLevel = root.getElementById('qLevel');
var qBars = root.getElementById('qBars');
var qSignals = root.getElementById('qSignals');
var qRow = root.getElementById('qRow');
var hintEl = root.getElementById('hint');
var aiPanel = root.getElementById('aiPanel');
var aiTag = root.getElementById('aiTag');
var aiDir = root.getElementById('aiDir');
var aiProb = root.getElementById('aiProb');
var aiBar = root.getElementById('aiBar');
var aiRngLb = root.getElementById('aiRngLb');
var aiRng = root.getElementById('aiRng');
var aiScore = root.getElementById('aiScore');
var aiSum = root.getElementById('aiSum');
var aiRef = root.getElementById('aiRef');
var prdDay = null, prdIntra = null, prdNews = null, prdFlow = null, prdQuant = null;
var predictDayAt = 0, predictIntradayAt = 0, newsAt = 0, flowAt = 0, quantAt = 0;

/* ================= 配置 ================= */
function marketLabel(m) { return MARKET_LABEL[m] || String(m || '').toUpperCase(); }
function displayCode(c) {
  if (c.market === 'us') return 'us' + String(c.code).split('.')[0].toUpperCase();
  return c.market + c.code;
}
function applyActive(i) {
  activeIdx = i;
  cfg = stocks.length ? stocks[i] : null;
  renderIdent();
  renderSwitcher();
  renderQuantLoading();
  refresh();
  requestChart('intra');
}
function renderIdent() {
  if (!cfg) {
    ball.className = 'ball flat empty';
    ballTag.textContent = '未配置';
    ballPx.textContent = '--';
    ballPct.textContent = '';
    cardName.textContent = '尚未配置股票';
    cardCode.textContent = '请点击下方「设置」搜索添加';
    pxEl.textContent = '--'; amtEl.textContent = '--'; pctBEl.textContent = '--';
    stText.textContent = '未配置';
    statusEl.className = 'status';
    hist = [];
    chartRows = []; chartStart = 0; chartEnd = 0; chartAt = 0; chartHover = -1;
    prdDay = null; prdIntra = null; prdNews = null; prdFlow = null; prdQuant = null;
    predictDayAt = 0; predictIntradayAt = 0; newsAt = 0; flowAt = 0; quantAt = 0;
    prdSum.textContent = '--';
    boardAt = 0;
    bkAsk.innerHTML = ''; bkBid.innerHTML = '';
    bkMid.textContent = '--';
    bkRel.innerHTML = '';
    bkSum.textContent = '--';
    resetGrid();
    renderAi();
    return;
  }
  ball.className = 'ball flat';
  ballTag.textContent = cfg.name.length > 4 ? cfg.name.slice(0, 4) : cfg.name;
  ballPx.textContent = '--';
  ballPct.textContent = '';
  cardName.textContent = cfg.name;
  cardCode.textContent = displayCode(cfg) + ' · ' + marketLabel(cfg.market);
  hist = [];
  prdDay = null; prdIntra = null; prdNews = null; prdFlow = null; prdQuant = null;
  predictDayAt = 0; predictIntradayAt = 0; newsAt = 0; flowAt = 0; quantAt = 0;
  prdSum.textContent = '--';
  boardAt = 0;
  bkAsk.innerHTML = ''; bkBid.innerHTML = '';
  bkMid.textContent = '--';
  bkRel.innerHTML = '';
  bkSum.textContent = '--';
  renderAi();
}
function resetGrid() {
  var cells = gridEl.querySelectorAll('.cell');
  for (var i = 0; i < cells.length; i++) {
    var v = cells[i].querySelector('.val');
    if (v) v.textContent = '--';
  }
  luEl.textContent = '--'; ldEl.textContent = '--'; utEl.textContent = '--';
}
function renderSwitcher() {
  sw.innerHTML = '';
  if (!stocks.length) { sw.style.display = 'none'; return; }
  sw.style.display = 'flex';
  stocks.forEach(function (s, i) {
    var d = document.createElement('div');
    d.className = 's' + (i === activeIdx ? ' on' : '');
    d.textContent = s.name;
    d.title = marketLabel(s.market) + ' ' + displayCode(s);
    d.addEventListener('click', function () {
      if (i === activeIdx) return;
      try { chrome.storage.local.set({ chhActive: i }); } catch (e) {}
    });
    sw.appendChild(d);
  });
}
function loadAll() {
  try {
    chrome.storage.local.get(['chhStocks', 'chhActive', 'chhVisible'], function (o) {
      stocks = (o && Array.isArray(o.chhStocks)) ? o.chhStocks.slice() : [];
      var i = (o && o.chhActive != null) ? +o.chhActive : 0;
      if (!isFinite(i) || i < 0) i = 0;
      if (stocks.length && i >= stocks.length) i = stocks.length - 1;
      activeIdx = i;
      cfg = stocks.length ? stocks[i] : null;
      visible = !(o && o.chhVisible === false);
      applyVisible();
      renderIdent();
      renderSwitcher();
      refresh();
      refreshPredict(true);
      if (cfg) requestChart('intra');
      showHint();
      if (!holdTimer) holdTimer = setInterval(requestHoldings, 30000);
      requestHoldings();
    });
  } catch (e) {
    stocks = []; cfg = null;
    renderIdent(); renderSwitcher(); refresh();
  }
}
try {
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.chhStocks) {
      stocks = (Array.isArray(changes.chhStocks.newValue) ? changes.chhStocks.newValue : []).slice();
      if (activeIdx >= stocks.length) activeIdx = Math.max(0, stocks.length - 1);
      applyActive(activeIdx);
    } else if (changes.chhActive) {
      var i = +changes.chhActive.newValue;
      if (isFinite(i) && i >= 0 && i < stocks.length && i !== activeIdx) applyActive(i);
    } else if (changes.chhVisible) {
      var was = visible;
      visible = !!changes.chhVisible.newValue;
      applyVisible();
      if (visible && !was) refresh();
    } else if (changes.chhHoldings) {
      requestHoldings();
    }
  });
} catch (e) { }

/* ================= 格式化 ================= */
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
var fmt2 = function (v) { return (v == null || isNaN(v)) ? '--' : v.toFixed(2); };
var fmtVol = function (v) {
  if (v == null || isNaN(v)) return '--';
  var unit = (cfg && (cfg.market === 'hk' || cfg.market === 'us')) ? '股' : '手';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿' + unit;
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万' + unit;
  return Math.round(v) + unit;
};
var fmtAmt = function (yuan) {
  if (yuan == null || isNaN(yuan)) return '--';
  var u = (cfg && cfg.market === 'hk') ? '港元' : ((cfg && cfg.market === 'us') ? '美元' : '');
  if (yuan >= 1e8) return (yuan / 1e8).toFixed(2) + '亿' + u;
  if (yuan >= 1e4) return (yuan / 1e4).toFixed(2) + '万' + u;
  return yuan.toFixed(0);
};
var fmtYi = function (yuan) {
  if (yuan == null || isNaN(yuan)) return '--';
  var u = (cfg && cfg.market === 'hk') ? '港元' : ((cfg && cfg.market === 'us') ? '美元' : '');
  return (yuan / 1e8).toFixed(2) + '亿' + u;
};
var fmtTime = function (raw) {
  if (!raw) return '--';
  var m = String(raw).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (m) return m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
  var hm = String(raw).match(/(\d{2}:\d{2}:\d{2})$/);
  return hm ? hm[1] : String(raw);
};
var fmtUpd = function (raw) {
  if (!raw) return '--';
  var hm = String(raw).match(/(\d{2}:\d{2}:\d{2})$/);
  if (hm) return hm[1];
  var m = String(raw).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? (m[4] + ':' + m[5] + ':' + m[6]) : String(raw);
};
var amplitude = function () {
  return (state.prevClose && state.high != null && state.low != null) ? ((state.high - state.low) / state.prevClose * 100) : null;
};

/* ================= 数据 ================= */
function parseTxLocal(p, market) {
  var d = {
    price: +p[3], prevClose: +p[4], open: +p[5], volHand: +p[6],
    high: +p[33], low: +p[34], change: +p[31], pct: +p[32], t: p[30],
    amtYuan: null, turnover: null, pe: null, pb: null, floatCap: null, totalCap: null, lu: null, ld: null
  };
  if (market === 'sh' || market === 'sz' || market === 'bj') {
    d.amtYuan = (+p[37]) * 1e4; d.turnover = +p[38]; d.pe = +p[39]; d.pb = +p[46];
    d.floatCap = (+p[44]) * 1e8; d.totalCap = (+p[45]) * 1e8; d.lu = +p[47]; d.ld = +p[48];
  } else if (market === 'hk' || market === 'us') {
    d.amtYuan = (+p[37]); d.pe = +p[39];
  }
  return d;
}
function directFetch() {
  var reqCfg = cfg;
  var q = reqCfg.market === 'us' ? 'us' + String(reqCfg.code).split('.')[0].toUpperCase() : reqCfg.market + reqCfg.code;
  return fetch(TX_URL + q + '&_=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.text(); })
    .then(function (txt) {
      var m = txt.match(/="([^"]*)"/);
      if (!m || !m[1] || m[1].indexOf('~') < 0) throw new Error('no direct data');
      var d = parseTxLocal(m[1].split('~'), reqCfg.market);
      if (!isFinite(d.price) || d.price <= 0) throw new Error('bad direct data');
      if (reqCfg !== cfg) return null; /* 切换股票后丢弃过期响应 */
      srcKind = 'tx';
      return d;
    });
}
function requestQuote() {
  var reqCfg = cfg;
  var viaBg = new Promise(function (resolve, reject) {
    try {
      if (!chrome.runtime || !chrome.runtime.sendMessage) { reject(new Error('no bg')); return; }
      var settled = false;
      var done = function (fn, v) { if (!settled) { settled = true; fn(v); } };
      chrome.runtime.sendMessage({ type: 'quote', cfg: reqCfg }, function (resp) {
        if (chrome.runtime.lastError) { done(reject, chrome.runtime.lastError); return; }
        if (reqCfg !== cfg) { done(resolve, null); return; } /* stale 守卫：切换股票后丢弃旧响应 */
        if (resp && resp.ok && resp.data) {
          srcKind = resp.source || 'tx';
          done(resolve, resp.data);
        } else { done(reject, new Error((resp && resp.error) || 'bg bad')); }
      });
      setTimeout(function () { done(reject, new Error('bg timeout')); }, 6000);
    } catch (e) { reject(e); }
  });
  return viaBg.catch(function () { return directFetch(); });
}

/* ================= 应用数据 ================= */
function setDir(cls) {
  ball.className = ball.className.replace(/\b(up|down|flat|empty)\b/g, '').trim() + ' ' + cls;
  card.className = card.className.replace(/\b(up|down|flat)\b/g, '').trim() + ' ' + cls;
}
function apply(d) {
  var prev = state.price;
  state.price = d.price; state.prevClose = d.prevClose; state.open = d.open;
  state.high = d.high; state.low = d.low; state.volHand = d.volHand; state.amtYuan = d.amtYuan;
  state.turnover = d.turnover; state.pe = d.pe; state.pb = d.pb;
  state.totalCap = d.totalCap; state.floatCap = d.floatCap;
  state.lu = d.lu; state.ld = d.ld; state.change = d.change; state.pct = d.pct; state.t = d.t;
  state.bid5 = d.bid5 || []; state.ask5 = d.ask5 || [];

  setDir(d.pct > 0 ? 'up' : (d.pct < 0 ? 'down' : 'flat'));

  ballPx.textContent = fmt2(state.price);
  ballPct.textContent = (state.pct == null) ? '' : ((state.pct > 0 ? '+' : '') + fmt2(state.pct) + '%');
  pxEl.textContent = fmt2(state.price);
  amtEl.textContent = (state.change == null) ? '--' : ((state.change > 0 ? '+' : '') + fmt2(state.change));
  pctBEl.textContent = (state.pct == null) ? '--' : ((state.pct > 0 ? '+' : '') + fmt2(state.pct) + '%');
  utEl.textContent = fmtUpd(state.t);

  var isA = cfg && (cfg.market === 'sh' || cfg.market === 'sz' || cfg.market === 'bj');
  var vals = {
    open: fmt2(state.open), prevClose: fmt2(state.prevClose),
    high: fmt2(state.high), low: fmt2(state.low),
    volume: fmtVol(state.volHand), amount: fmtAmt(state.amtYuan),
    turnover: (isA && state.turnover > 0) ? fmt2(state.turnover) + '%' : '--',
    amplitude: (isA && amplitude() > 0) ? fmt2(amplitude()) + '%' : '--',
    pe: (state.pe != null && state.pe > 0) ? fmt2(state.pe) : '--',
    pb: (isA && state.pb > 0) ? fmt2(state.pb) : '--',
    totalCap: (isA && state.totalCap > 0) ? fmtYi(state.totalCap) : '--',
    floatCap: (isA && state.floatCap > 0) ? fmtYi(state.floatCap) : '--'
  };
  for (var k in vals) { if (gridVal[k]) gridVal[k].textContent = vals[k] || '--'; }
  luEl.textContent = (isA && state.lu > 0) ? fmt2(state.lu) : '--';
  ldEl.textContent = (isA && state.ld > 0) ? fmt2(state.ld) : '--';

  if (prev != null && state.price != null && Math.abs(state.price - prev) > 0.0001) {
    ball.classList.remove('flash'); void ball.offsetWidth; ball.classList.add('flash');
    pxEl.classList.remove('pop'); void pxEl.offsetWidth; pxEl.classList.add('pop');
  }
  if (state.price != null && !(hist.length && hist[hist.length - 1].p === state.price)) {
    hist.push({ t: Date.now(), p: state.price });
    if (hist.length > 60) hist.shift();
  }
  drawSpark();
  setSource('ok');
  refreshPredict(false);
}
function setSource(kind) {
  if (!srcRow.dataset.built) {
    srcRow.innerHTML = '<i></i><span></span>';
    srcRow.dataset.built = '1';
  }
  var txt = srcRow.querySelector('span');
  if (kind === 'ok') {
    srcRow.style.display = 'flex';
    srcRow.className = 'srcRow' + (srcKind === 'em' ? ' alt' : '');
    txt.textContent = (srcKind === 'em' ? '数据源：东方财富（备用）' : '数据源：腾讯行情');
  } else {
    srcRow.style.display = 'flex';
    srcRow.className = 'srcRow off';
    txt.textContent = '连接中断，正在重试…';
  }
}

/* ================= 交互K线 ================= */
function chartTime(raw) {
  var s = String(raw || '');
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.replace('T', ' ').slice(0, 19);
  return s;
}
function chartVisibleRows() { return chartRows.slice(chartStart, chartEnd || chartRows.length); }
var rafDraw = null;
/* rAF 合并：mousemove / wheel / 拖拽等高频事件的多次重绘合并为一帧一次 */
function requestDraw() {
  if (rafDraw) return;
  rafDraw = requestAnimationFrame(function () { rafDraw = null; drawSpark(); });
}
function drawSpark() {
  var W = spark.clientWidth, H = spark.clientHeight;
  if (!W || !H) return;
  var dpr = window.devicePixelRatio || 1;
  var cw = Math.round(W * dpr), ch = Math.round(H * dpr);
  if (spark.width !== cw || spark.height !== ch) { spark.width = cw; spark.height = ch; }
  var ctx = spark.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  var rows = chartVisibleRows(); if (rows.length < 2) return;
  var top = 8, bottom = H - 22, min = Math.min.apply(null, rows.map(function (r) { return r.l; })), max = Math.max.apply(null, rows.map(function (r) { return r.h; }));
  var pad = (max - min) * .08 || .01; min -= pad; max += pad;
  var x = function (i) { return 7 + i / (rows.length - 1) * (W - 14); }, y = function (v) { return top + (max - v) / (max - min) * (bottom - top); };
  ctx.strokeStyle = '#e8eef5'; ctx.lineWidth = 1;
  for (var g = 0; g < 4; g++) { var gy = top + g * (bottom - top) / 3; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
  var step = Math.max(3, Math.min(14, (W - 14) / rows.length * .62));
  rows.forEach(function (r, i) { var up = r.c >= r.o, col = up ? THEME.up : THEME.down, xx = x(i); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xx, y(r.h)); ctx.lineTo(xx, y(r.l)); ctx.stroke(); var yo = y(r.o), yc = y(r.c), bh = Math.max(1.5, Math.abs(yc - yo)); ctx.fillRect(xx - step / 2, Math.min(yo, yc), step, bh); });
  if (chartHover >= 0 && chartHover < rows.length) { var hr = rows[chartHover], hx = x(chartHover); ctx.strokeStyle = '#64748b'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(hx, top); ctx.lineTo(hx, bottom); ctx.stroke(); ctx.setLineDash([]); chartTip.textContent = chartTime(hr.t) + '  当前股价 ' + hr.c.toFixed(2) + '  开 ' + hr.o.toFixed(2) + ' 高 ' + hr.h.toFixed(2) + ' 低 ' + hr.l.toFixed(2); chartTip.classList.add('show'); chartTip.style.left = Math.max(4, Math.min(W - chartTip.offsetWidth - 4, hx + 8)) + 'px'; chartTip.style.top = '5px'; } else chartTip.classList.remove('show');
  ctx.fillStyle = '#94a3b8'; ctx.font = '10px Noto Sans CJK SC, sans-serif'; ctx.fillText(rows[0].t, 7, H - 6); var last = rows[rows.length - 1].t; ctx.fillText(last, Math.max(7, W - ctx.measureText(last).width - 7), H - 6);
}
function requestChart(period) {
  if (!cfg) return;
  chartPeriod = period;
  chartAt = Date.now();
  var requestedAt = chartAt;
  var requestedCfg = cfg;
  chartRows = []; chartStart = 0; chartEnd = 0; chartHover = -1; drawSpark();
  try {
    chrome.runtime.sendMessage({ type: 'chart', cfg: requestedCfg, period: period }, function (resp) {
      if (chrome.runtime.lastError || !resp || !resp.ok || requestedAt !== chartAt || requestedCfg !== cfg || period !== chartPeriod) return;
      chartRows = Array.isArray(resp.data) ? resp.data : [];
      chartStart = 0; chartEnd = chartRows.length; drawSpark();
    });
  } catch (e) { }
}
chartBtns.forEach(function (b) { b.addEventListener('click', function () { chartBtns.forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); requestChart(b.dataset.period); }); });
/* K线走势：点击标题收缩 / 展开 */
chartToggle.addEventListener('click', function () {
  spwrapEl.classList.toggle('collapsed');
  if (!spwrapEl.classList.contains('collapsed')) drawSpark();
});
chartWrap.addEventListener('mousemove', function (e) { var r = chartWrap.getBoundingClientRect(), rows = chartVisibleRows(); if (!rows.length) return; chartHover = Math.max(0, Math.min(rows.length - 1, Math.round((e.clientX - r.left) / r.width * (rows.length - 1)))); requestDraw(); });
chartWrap.addEventListener('mouseleave', function () { chartHover = -1; chartTip.classList.remove('show'); requestDraw(); });
/* 滚轮冲突修复：默认滚轮滚动卡片；卡片无溢出或按住 Shift/Ctrl/Meta 时缩放图表 */
chartWrap.title = '滚轮滚动卡片 · Shift+滚轮缩放K线（卡片无溢出时滚轮直接缩放）';
chartWrap.addEventListener('wheel', function (e) {
  var cardScrollable = card.scrollHeight > card.clientHeight + 1;
  var zoom = e.shiftKey || e.ctrlKey || e.metaKey || !cardScrollable;
  if (!zoom) return;
  e.preventDefault();
  if (!chartRows.length) return;
  var span = chartEnd - chartStart, next = Math.max(20, Math.min(chartRows.length, Math.round(span * (e.deltaY > 0 ? 1.2 : .8)))); var r = chartWrap.getBoundingClientRect(), ratio = (e.clientX - r.left) / r.width, anchor = chartStart + Math.round(span * ratio); chartStart = Math.max(0, Math.min(chartRows.length - next, anchor - Math.round(next * ratio))); chartEnd = chartStart + next; requestDraw();
}, { passive: false });
chartWrap.addEventListener('pointerdown', function (e) { chartDrag = { x: e.clientX, start: chartStart, end: chartEnd }; chartWrap.setPointerCapture(e.pointerId); });
chartWrap.addEventListener('pointermove', function (e) { if (!chartDrag || !chartRows.length) return; var delta = Math.round((chartDrag.x - e.clientX) / Math.max(1, chartWrap.clientWidth) * (chartDrag.end - chartDrag.start)); var span = chartDrag.end - chartDrag.start; chartStart = Math.max(0, Math.min(chartRows.length - span, chartDrag.start + delta)); chartEnd = chartStart + span; requestDraw(); });
chartWrap.addEventListener('pointerup', function () { chartDrag = null; });
chartWrap.addEventListener('pointercancel', function () { chartDrag = null; });

/* ================= 市场状态（按市场分时段） ================= */
/* 美股（纽约）本地时钟：自动适配夏令时，用于交易时段判断 */
function nyNow() {
  try {
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    var wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
    if (wd == null) return null;
    return { day: wd, mins: ((+parts.hour) % 24) * 60 + (+parts.minute) };
  } catch (e) { return null; }
}
function marketStatus() {
  var now = new Date();
  var day = now.getDay();
  var m = now.getHours() * 60 + now.getMinutes();
  var mk = cfg ? cfg.market : 'sz';
  if (mk === 'sg') {
    /* 上金所现货：日盘 9:00-11:30、13:30-15:30，夜盘 20:00-次日 2:30 */
    if ((m >= 9 * 60 && m <= 11 * 60 + 30) || (m >= 13 * 60 + 30 && m <= 15 * 60 + 30) || m >= 20 * 60 || m < 2 * 60 + 30) {
      return { txt: '交易中', live: true };
    }
    return { txt: '已收盘', live: false };
  }
  if (mk === 'us') {
    /* 美股按纽约时区（自动适配夏令时），9:30~16:00 交易 */
    var ny = nyNow();
    if (ny) {
      if (ny.day < 1 || ny.day > 5) return { txt: '休市', live: false };
      if (ny.mins < 570) return { txt: '未开盘', live: false };
      if (ny.mins < 960) return { txt: '交易中', live: true };
      return { txt: '已收盘', live: false };
    }
    /* 降级：本地时间近似（不区分夏令时） */
    if (m < 21 * 60 + 30) return { txt: '未开盘', live: false };
    if (m >= 4 * 60) return { txt: '已收盘', live: false };
    return { txt: '交易中', live: true };
  }
  if (day === 0 || day === 6) return { txt: '休市', live: false };
  if (mk === 'hk') {
    if (m < 9 * 60 + 30) return { txt: '未开盘', live: false };
    if (m <= 12 * 60) return { txt: '交易中', live: true };
    if (m < 13 * 60) return { txt: '午间休市', live: false };
    if (m <= 16 * 60) return { txt: '交易中', live: true };
    return { txt: '已收盘', live: false };
  }
  if (m < 9 * 60 + 30) return { txt: '未开盘', live: false };
  if (m <= 11 * 60 + 30) return { txt: '交易中', live: true };
  if (m < 13 * 60) return { txt: '午间休市', live: false };
  if (m <= 15 * 60) return { txt: '交易中', live: true };
  return { txt: '已收盘', live: false };
}
function paintStatus() {
  var s = marketStatus();
  if (s.txt !== lastStatus) {
    stText.textContent = s.txt;
    statusEl.className = 'status' + (s.live ? ' live' : '');
    lastStatus = s.txt;
  }
}

/* ================= 刷新循环 ================= */
function refresh() {
  paintStatus();
  if (paused || !visible) return;
  if (!cfg) { scheduleNext(); return; }
  requestQuote()
    .then(function (d) { if (d) apply(d); })
    .catch(function () { setSource('off'); })
    .then(function () { requestBoard(false); scheduleNext(); });
}
function scheduleNext() {
  if (timer) { clearInterval(timer); timer = null; }
  if (paused || !visible || !cfg) return; /* 暂停/隐藏/未配置时停表，避免空转 */
  timer = setInterval(refresh, marketStatus().live ? 3000 : 15000);
}

/* ================= 智能预测（实时 / 次日 / 资讯） ================= */
function fmtP(v) { return (v == null || isNaN(v)) ? '--' : (+v).toFixed(2); }
function fmtS(v) { return (v == null || isNaN(v)) ? '--' : Math.round(v); }
function fmtWan(y) {
  if (y == null || isNaN(y)) return '--';
  var sign = y >= 0 ? '+' : '-';
  var a = Math.abs(y);
  if (a >= 1e8) return sign + (a / 1e8).toFixed(2) + '亿';
  if (a >= 1e4) return sign + (a / 1e4).toFixed(0) + '万';
  return sign + a.toFixed(0);
}
function setDirCls(el, cls) {
  el.className = 'dir' + (cls === 'up' ? ' up' : (cls === 'down' ? ' down' : ' flat'));
}
function refreshPredict(force) {
  if (paused || !visible || !cfg) return;
  var now = Date.now();
  if (force || !predictDayAt || now - predictDayAt > 5 * 60 * 1000) requestPredictDay();
  if (force || !predictIntradayAt || now - predictIntradayAt > 60 * 1000) requestPredictIntraday();
  if (force || !newsAt || now - newsAt > 10 * 60 * 1000) requestNews();
  if (force || !flowAt || now - flowAt > 60 * 1000) requestFlow();
  if (force || !quantAt || now - quantAt > 60 * 1000) requestQuant();
}
function requestPredictDay() {
  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    var settled = false;
    chrome.runtime.sendMessage({ type: 'predict', cfg: cfg, mode: 'day' }, function (resp) {
      if (settled) return; settled = true;
      predictDayAt = Date.now();
      if (chrome.runtime.lastError || !resp || !resp.ok || !resp.data) return;
      prdDay = resp.data;
      renderDay(prdDay); renderSum();
    });
    setTimeout(function () { settled = true; predictDayAt = Date.now(); }, 9000);
  } catch (e) { }
}
function requestPredictIntraday() {
  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    var settled = false;
    chrome.runtime.sendMessage({
      type: 'predict', cfg: cfg, mode: 'intraday',
      quote: {
        price: state.price, open: state.open, high: state.high, low: state.low,
        prevClose: state.prevClose, volHand: state.volHand, amtYuan: state.amtYuan
      },
      recent: hist.slice(-10).map(function (h) { return h.p; })
    }, function (resp) {
      if (settled) return; settled = true;
      predictIntradayAt = Date.now();
      if (chrome.runtime.lastError || !resp || !resp.ok || !resp.data) return;
      prdIntra = resp.data;
      renderIntraday(prdIntra); renderSum();
    });
    setTimeout(function () { settled = true; predictIntradayAt = Date.now(); }, 9000);
  } catch (e) { }
}
function requestNews(force) {
  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    var settled = false;
    var restore = function () { nRef.disabled = false; nRef.textContent = '↻ 刷新'; };
    if (force) { nRef.disabled = true; nRef.textContent = '刷新中…'; }
    chrome.runtime.sendMessage({ type: 'news', cfg: cfg, force: !!force }, function (resp) {
      if (settled) return; settled = true;
      newsAt = Date.now();
      restore();
      if (chrome.runtime.lastError || !resp || !resp.ok || !resp.data) return;
      prdNews = resp.data;
      renderNews(prdNews); renderSum();
    });
    setTimeout(function () { settled = true; newsAt = Date.now(); restore(); }, 12000);
  } catch (e) { }
}
var prdFlowErr = '';
function requestFlow(force) {
  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    var settled = false;
    var restore = function () { flRef.disabled = false; flRef.textContent = '↻ 刷新'; };
    if (force) { flRef.disabled = true; flRef.textContent = '刷新中…'; }
    chrome.runtime.sendMessage({ type: 'flow', cfg: cfg, force: !!force }, function (resp) {
      if (settled) return; settled = true;
      flowAt = Date.now();
      restore();
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        prdFlow = null;
        prdFlowErr = (resp && resp.error) ? resp.error : '数据获取失败';
        renderFlow(null);
        return;
      }
      prdFlow = resp.data;
      prdFlowErr = '';
      renderFlow(prdFlow);
    });
    setTimeout(function () { settled = true; flowAt = Date.now(); restore(); }, 12000);
  } catch (e) { }
}
function requestQuant(force) {
  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    var settled = false;
    var restore = function () { qRef.disabled = false; qRef.textContent = '↻ 刷新'; };
    if (force) { qRef.disabled = true; qRef.textContent = '刷新中…'; }
    chrome.runtime.sendMessage({
      type: 'quant', cfg: cfg, force: !!force,
      quote: {
        price: state.price, open: state.open, high: state.high, low: state.low,
        prevClose: state.prevClose, pe: state.pe, pb: state.pb,
        volHand: state.volHand, amtYuan: state.amtYuan, turnover: state.turnover
      },
      recent: hist.slice(-10).map(function (h) { return h.p; })
    }, function (resp) {
      if (settled) return; settled = true;
      quantAt = Date.now();
      restore();
      if (chrome.runtime.lastError || !resp || !resp.ok || !resp.data) {
        prdQuant = null;
        renderQuant(null);
        return;
      }
      prdQuant = resp.data;
      renderQuant(prdQuant); renderSum();
    });
    setTimeout(function () { settled = true; quantAt = Date.now(); restore(); }, 15000);
  } catch (e) { }
}
var Q_LABELS = { trend: '趋势', fund: '资金', vol: '量价', news: '情绪', value: '估值' };
function renderQuantLoading() {
  qDir.className = 'dir flat';
  qDir.textContent = '加载中';
  qTag.className = 'tg neu';
  qTag.textContent = '…';
  qSub.textContent = '正在计算量化评分…';
  qScore.textContent = '--';
  qLevel.textContent = '--';
  qBars.innerHTML = '';
  qSignals.innerHTML = '';
  qRow.textContent = '五因子加权合成，权重可在设置页调整；仅供技术参考，不构成投资建议';
}
function renderQuant(q) {
  if (!q) {
    qDir.className = 'dir flat';
    qDir.textContent = '无数据';
    qTag.className = 'tg neu';
    qTag.textContent = '无数据';
    qSub.textContent = '数据获取失败';
    qScore.textContent = '--';
    qLevel.textContent = '--';
    qBars.innerHTML = '';
    qSignals.innerHTML = '';
    qRow.textContent = '五因子加权合成，权重可在设置页调整；仅供技术参考，不构成投资建议';
    return;
  }
  qDir.className = 'dir ' + q.dir;
  qDir.textContent = q.dirTxt;
  qTag.className = 'tg ' + (q.score >= 60 ? 'pos' : (q.score <= 40 ? 'neg' : 'neu'));
  qTag.textContent = q.score >= 60 ? '偏多' : (q.score <= 40 ? '偏空' : '中性');
  qSub.textContent = '五因子加权 · ' + fmtClock(q.ts);
  qScore.textContent = q.score;
  qScore.style.color = q.score >= 60 ? THEME.up : (q.score <= 40 ? THEME.down : THEME.ink);
  qLevel.textContent = q.level;
  qBars.innerHTML = '';
  Object.keys(Q_LABELS).forEach(function (k) {
    var v = (q.factors && q.factors[k] != null) ? q.factors[k] : 0;
    var w = (q.weights && q.weights[k] != null) ? q.weights[k] : 0;
    var col = v >= 60 ? THEME.up : (v <= 40 ? THEME.down : THEME.blue);
    var bar = document.createElement('div');
    bar.className = 'qbar';
    bar.innerHTML = '<span class="lb">' + Q_LABELS[k] + '</span>' +
      '<span class="track"><span class="fill" style="width:' + v + '%;background:' + col + '"></span></span>' +
      '<span class="vl">' + v + '</span>' +
      '<span class="wl">' + w + '%</span>';
    qBars.appendChild(bar);
  });
  /* 信号 + 风险提示 */
  var html = '';
  if (q.signals && q.signals.length) {
    html += '<div class="qhead">信号</div>';
    q.signals.forEach(function (t) { html += '<div class="qsg neu">' + esc(t) + '</div>'; });
  }
  if (q.warnings && q.warnings.length) {
    html += '<div class="qhead">风险提示</div>';
    q.warnings.forEach(function (t) { html += '<div class="qsg neg">' + esc(t) + '</div>'; });
  }
  qSignals.innerHTML = html || '';
  qRow.textContent = '综合分 = Σ(因子×权重)/Σ权重×100 · 权重见条末（%）· 仅供技术参考';
}
function renderFlow(f) {
  if (!f || !f.flow) {
    flDir.className = 'dir flat';
    flDir.textContent = prdFlowErr || '无数据';
    flTag.className = 'tg neu';
    flTag.textContent = prdFlowErr || '无数据';
    flSub.textContent = prdFlowErr ? '该市场暂不支持资金流信号' : '东方财富数据源';
    flMain.textContent = '--';
    flPct.textContent = '--';
    flSuper.textContent = '--';
    flBig.textContent = '--';
    flMid.textContent = '--';
    flSmall.textContent = '--';
    fl5d.textContent = '--';
    flStreak.textContent = '--';
    flDate.textContent = '--';
    flLhb.textContent = '--';
    flLhb.style.color = '';
    return;
  }
  var s = f.flow, t = s.today;
  var cls = (s.level.indexOf('流入') >= 0) ? 'up' : ((s.level.indexOf('流出') >= 0) ? 'down' : 'flat');
  flDir.className = 'dir ' + cls;
  flDir.textContent = s.level;
  flTag.className = 'tg ' + (cls === 'up' ? 'pos' : (cls === 'down' ? 'neg' : 'neu'));
  flTag.textContent = s.level;
  flSub.textContent = '东方财富 · ' + (t.date ? t.date.slice(5) : '');
  flMain.textContent = fmtWan(t.mainNet);
  flPct.textContent = (t.mainPct > 0 ? '+' : '') + (isFinite(t.mainPct) ? t.mainPct.toFixed(2) : '--') + '%';
  flSuper.textContent = fmtWan(t.superNet);
  flBig.textContent = fmtWan(t.bigNet);
  flMid.textContent = fmtWan(t.midNet);
  flSmall.textContent = fmtWan(t.smallNet);
  fl5d.textContent = fmtWan(s.sum5);
  flStreak.textContent = s.streak;
  flDate.textContent = t.date || '--';
  if (f.lhb && f.lhb.length) {
    var r = f.lhb[0];
    var reason = r.reason || '';
    if (reason.length > 30) reason = reason.slice(0, 30) + '…';
    flLhb.textContent = r.date.slice(5) + ' 上榜 · 净' + fmtWan(r.netAmt) + ' · ' + reason;
    flLhb.style.color = r.netAmt > 0 ? THEME.up : (r.netAmt < 0 ? THEME.down : THEME.ink2);
    flLhb.title = r.reason || '';
  } else {
    flLhb.textContent = '暂无上榜记录';
    flLhb.style.color = THEME.ink3;
  }
}
function renderIntraday(p) {
  if (!p) return;
  setDirCls(idDir, p.dir);
  idDir.textContent = p.dirTxt;
  idHi.textContent = fmtP(p.intraHigh);
  idLo.textContent = fmtP(p.intraLow);
  idProb.textContent = (p.probUp * 100).toFixed(0) + '%';
  idProb.style.color = p.probUp >= 0.5 ? THEME.up : THEME.down;
  idVwap.textContent = fmtP(p.vwap) + (p.vsVwap >= 0 ? ' +' : ' ') + fmtP(p.vsVwap) + '%';
  idMom.textContent = (p.mom >= 0 ? '+' : '') + fmtP(p.mom) + '%';
  idVol.textContent = p.volState + ' ' + fmtP(p.volRatio) + 'x';
  idStr.textContent = p.strength;
  idLow.textContent = fmtP(p.dayLow);
  idVwapLv.textContent = fmtP(p.vwap);
  idPrev.textContent = fmtP(p.prevClose);
  idMa5.textContent = fmtP(p.ma5);
  idIdx.textContent = (p.idxPct == null) ? '--' : ((p.idxPct > 0 ? '+' : '') + p.idxPct.toFixed(2) + '%');
}
function renderDay(p) {
  if (!p) return;
  setDirCls(dDir, p.dir);
  dDir.textContent = p.dirTxt;
  dLo.textContent = fmtP(p.nextLow);
  dHi.textContent = fmtP(p.nextHigh);
  dProb.textContent = (p.probUp * 100).toFixed(0) + '%';
  dProb.style.color = p.probUp >= 0.5 ? THEME.up : THEME.down;
  dMa5.textContent = fmtP(p.ma5);
  dMa10.textContent = fmtP(p.ma10);
  dMa20.textContent = fmtP(p.ma20);
  dRsi.textContent = fmtS(p.rsi);
  dMacd.textContent = fmtP(p.macdHist);
  dKdj.textContent = fmtS(p.j);
  dBoll.textContent = fmtP(p.bollMid);
  dAtr.textContent = fmtP(p.atr);
  dSup.textContent = fmtP(p.support);
  dRes.textContent = fmtP(p.resistance);
  dGap.textContent = p.gapTxt + ' ' + (p.gapPct >= 0 ? '+' : '') + fmtP(p.gapPct) + '%';
  dConf.textContent = p.confidence;
  dHit.textContent = (p.hitRate == null) ? '--' : (p.hitRate + '%/' + (p.trackN || 0));
  dN.textContent = p.days;
}
var TAG_TXT = { pos: '利好', neg: '利空', neu: '中性' };
function fmtClock(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var h = d.getHours(), m = d.getMinutes();
  return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
}
function renderNews(n) {
  if (!n) return;
  nTag.className = 'tg ' + n.sentiment;
  nTag.textContent = TAG_TXT[n.sentiment];
  var up = fmtClock(n.at);
  nSub.textContent = n.total
    ? ('共 ' + n.total + ' 条 · 利好 ' + n.pos + ' / 利空 ' + n.neg + ' · 更新 ' + up)
    : ('暂无相关资讯 · 更新 ' + up);
  nList.innerHTML = '';
  if (!n.total) {
    var emp = document.createElement('div');
    emp.className = 'nemp';
    emp.textContent = '暂无该股相关资讯，可稍后刷新重试';
    nList.appendChild(emp);
    return;
  }
  n.items.forEach(function (it) {
    var d = document.createElement('div');
    d.className = 'nitem';
    /* 协议白名单：仅 https/http 链接可点击，防数据源污染出 javascript:/data: 链接 */
    var safeUrl = /^https?:\/\//i.test(String(it.url || ''));
    var a = document.createElement(safeUrl ? 'a' : 'span');
    a.className = 'nt';
    if (safeUrl) { a.href = it.url; a.target = '_blank'; a.rel = 'noopener'; }
    a.textContent = it.title;
    var p = document.createElement('span');
    p.className = 'np';
    p.textContent = it.platform;
    var t = document.createElement('span');
    t.className = 'ntag ' + it.tag;
    t.textContent = TAG_TXT[it.tag];
    d.appendChild(a);
    d.appendChild(p);
    d.appendChild(t);
    nList.appendChild(d);
  });
}
/* 顶部「AI 智能研判」：方向 / 上行概率 / 预测区间 / 量化评分 汇总 */
function renderAi() {
  if (!cfg) {
    aiDir.textContent = '--'; aiDir.className = 'aiV flat';
    aiProb.textContent = '--'; aiProb.style.color = '';
    aiBar.style.width = '0%';
    aiRngLb.textContent = '预测区间'; aiRng.textContent = '--';
    aiScore.textContent = '--'; aiScore.style.color = '';
    aiTag.textContent = '--'; aiTag.className = 'aiTag neu';
    aiSum.textContent = '未配置';
    aiPanel.className = 'ai';
    return;
  }
  var i = prdIntra, d = prdDay, q = prdQuant;
  var dir = i ? i.dir : (d ? d.dir : 'flat');
  var dirTxt = i ? i.dirTxt : (d ? d.dirTxt : '--');
  aiDir.textContent = dirTxt;
  aiDir.className = 'aiV ' + dir;
  aiPanel.className = 'ai' + (dir === 'up' ? ' up' : (dir === 'down' ? ' down' : ''));
  var prob = i ? i.probUp : (d ? d.probUp : null);
  if (prob != null) {
    var pp = Math.round(prob * 100);
    aiProb.textContent = pp + '%';
    aiProb.style.color = prob >= 0.56 ? THEME.up : (prob <= 0.44 ? THEME.down : THEME.ink);
    aiBar.style.width = pp + '%';
    aiBar.style.background = prob >= 0.56 ? THEME.up : (prob <= 0.44 ? THEME.down : THEME.blue);
  } else {
    aiProb.textContent = '--'; aiProb.style.color = '';
    aiBar.style.width = '0%';
  }
  if (i && i.intraLow != null && i.intraHigh != null) {
    aiRngLb.textContent = '实时区间';
    aiRng.textContent = fmtP(i.intraLow) + '~' + fmtP(i.intraHigh);
  } else if (d && d.nextLow != null && d.nextHigh != null) {
    aiRngLb.textContent = '次日区间';
    aiRng.textContent = fmtP(d.nextLow) + '~' + fmtP(d.nextHigh);
  } else {
    aiRngLb.textContent = '预测区间';
    aiRng.textContent = '--';
  }
  var lv = null;
  if (q && q.score != null) lv = q.score >= 60 ? '偏多' : (q.score <= 40 ? '偏空' : '中性');
  else if (i || d) lv = dirTxt;
  if (q && q.score != null) {
    aiScore.textContent = q.score + ' · ' + (q.level || lv);
    aiScore.style.color = q.score >= 60 ? THEME.up : (q.score <= 40 ? THEME.down : THEME.ink);
  } else {
    aiScore.textContent = '--'; aiScore.style.color = '';
  }
  aiTag.textContent = lv || '--';
  aiTag.className = 'aiTag ' + (lv === '偏多' ? 'pos' : (lv === '偏空' ? 'neg' : 'neu'));
  var parts = [];
  if (i) parts.push(i.dirTxt);
  if (prob != null) parts.push('上行概率 ' + Math.round(prob * 100) + '%');
  if (d && d.nextLow != null) {
    parts.push('次日 ' + fmtP(d.nextLow) + '~' + fmtP(d.nextHigh));
    if (d.confidence != null) parts.push('置信 ' + d.confidence + '%');
  }
  aiSum.textContent = parts.length ? parts.join(' · ') : '研判加载中…';
}
function renderSum() {
  var parts = [];
  if (prdIntra) parts.push(prdIntra.dirTxt);
  if (prdDay) parts.push('次日 ' + fmtP(prdDay.nextLow) + '~' + fmtP(prdDay.nextHigh));
  if (prdNews && prdNews.total) parts.push('资讯' + prdNews.total + '条');
  if (prdQuant && prdQuant.score != null) parts.push('量化 ' + prdQuant.score + '分');
  prdSum.textContent = parts.length ? parts.join(' · ') : '--';
  renderAi();
}

/* ================= 盘口：五档 + 大盘指数 + 相关板块 ================= */
function requestBoard(force) {
  if (paused || !visible || !cfg) return;
  var now = Date.now();
  if (!force && boardAt && now - boardAt < 60 * 1000) return;
  boardAt = now;
  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage({ type: 'board', cfg: cfg }, function (resp) {
      if (chrome.runtime.lastError || !resp || !resp.ok) return;
      renderBoard(resp);
    });
  } catch (e) { }
}
function renderBoard(resp) {
  var q = state;
  /* 五档盘口 */
  var asks = q.ask5 || [], bids = q.bid5 || [];
  if (asks.length && bids.length) {
    var ah = '', bh = '';
    for (var i = 4; i >= 0; i--) {
      ah += '<div class="brow lv' + (5 - i) + '"><span class="lab">卖' + (i + 1) + '</span>' +
        '<span class="bp">' + fmt2(asks[i].p) + '</span><span class="bv">' + fmtVol(asks[i].v) + '</span></div>';
    }
    for (var j = 0; j < 5; j++) {
      bh += '<div class="brow lv' + (j + 1) + '"><span class="lab">买' + (j + 1) + '</span>' +
        '<span class="bp">' + fmt2(bids[j].p) + '</span><span class="bv">' + fmtVol(bids[j].v) + '</span></div>';
    }
    bkAsk.innerHTML = ah;
    bkBid.innerHTML = bh;
    bkMid.textContent = fmt2(q.price);
    bkMid.className = 'mid ' + (q.pct > 0 ? 'up' : (q.pct < 0 ? 'down' : ''));
    bk5.style.display = '';
  } else {
    bk5.style.display = 'none';
  }
  /* 关联行情：大盘指数 + 相关板块 */
  var indices = resp.indices || [], boards = resp.boards || [];
  var html = '';
  indices.forEach(function (it) {
    html += chip(it.name, it.pct);
  });
  boards.forEach(function (it) {
    html += chip(it.name, it.pct);
  });
  bkRel.innerHTML = html || '<div class="nemp" style="padding:8px 0;text-align:center;font-size:11px;color:' + THEME.ink3 + '">暂无关联行情</div>';
  bkSum.textContent = (indices.length + boards.length)
    ? ('指数 ' + indices.length + ' · 板块 ' + boards.length)
    : '暂无';
}
function chip(name, pct) {
  var cls = pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat');
  var txt = (pct == null || isNaN(pct)) ? '--' : ((pct > 0 ? '+' : '') + fmt2(pct) + '%');
  return '<div class="bkchip"><span class="n">' + esc(name) + '</span><span class="v ' + cls + '">' + txt + '</span></div>';
}
prdBar.addEventListener('click', function () {
  prd.classList.toggle('open');
  if (prd.classList.contains('open')) refreshPredict(true);
});
aiRef.addEventListener('click', function () { refreshPredict(true); });
bkBar.addEventListener('click', function () {
  bk.classList.toggle('open');
  if (bk.classList.contains('open')) requestBoard(true);
});
ptabs.addEventListener('click', function (e) {
  var tab = e.target && e.target.getAttribute ? e.target.getAttribute('data-tab') : null;
  if (!tab) return;
  var tabs = ptabs.querySelectorAll('.ptab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('on');
  e.target.classList.add('on');
  var panes = {
    intraday: root.getElementById('paneIntraday'),
    day: root.getElementById('paneDay'),
    flow: root.getElementById('paneFlow'),
    news: root.getElementById('paneNews'),
    quant: root.getElementById('paneQuant'),
    hold: root.getElementById('paneHold')
  };
  for (var k in panes) panes[k].classList.remove('on');
  panes[tab].classList.add('on');
  if (tab === 'intraday') requestPredictIntraday();
  else if (tab === 'day') requestPredictDay();
  else if (tab === 'flow') requestFlow(true);
  else if (tab === 'news') requestNews();
  else if (tab === 'quant') requestQuant(true);
  else if (tab === 'hold') requestHoldings();
});
nRef.addEventListener('click', function () {
  requestNews(true);
});
flRef.addEventListener('click', function () {
  requestFlow(true);
});
qRef.addEventListener('click', function () {
  requestQuant(true);
});

/* ================= 持仓（本地记账） ================= */
function fmtHoldMoney(v) {
  if (v == null || isNaN(v)) return '--';
  var neg = v < 0, a = Math.abs(v), s;
  if (a >= 1e8) s = (a / 1e8).toFixed(2) + '亿';
  else if (a >= 1e4) s = (a / 1e4).toFixed(2) + '万';
  else s = a.toFixed(0);
  return (neg ? '-' : (v > 0 ? '+' : '')) + s;
}
function holdCls(v) {
  return (v == null || isNaN(v)) ? 'flat' : (v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'));
}
function renderHoldingsUI() {
  if (!holdData || !holdData.items || !holdData.items.length) {
    hMv.textContent = hPlEl.textContent = hDayEl.textContent = '--';
    hMv.className = hPlEl.className = hDayEl.className = 'flat';
    hList.innerHTML = '<div class="hemp">暂无持仓记录<br>点击下方按钮到设置页添加</div>';
    hSub.textContent = '--';
    renderBallHold();
    return;
  }
  var s = holdData.sum || {};
  hMv.textContent = fmtHoldMoney(s.mv);
  hMv.className = 'flat';
  hPlEl.textContent = fmtHoldMoney(s.pl);
  hPlEl.className = holdCls(s.pl);
  hDayEl.textContent = fmtHoldMoney(s.dayPl);
  hDayEl.className = holdCls(s.dayPl);
  hSub.textContent = '共 ' + holdData.items.length + ' 只 · 成本 ' + fmtHoldMoney(s.costAmt);
  hList.innerHTML = '';
  holdData.items.forEach(function (it) {
    var pl = fmtHoldMoney(it.pl);
    var dp = it.dayPl == null || isNaN(it.dayPl) ? '--' : fmtHoldMoney(it.dayPl);
    var d = document.createElement('div');
    d.className = 'hitem';
    d.innerHTML =
      '<span class="nm">' + esc(it.name || it.code) + '</span>' +
      '<span class="sub">' + (it.qty || 0) + '股 @' + fmt2(it.cost) + '</span>' +
      '<span class="dp ' + holdCls(it.dayPl) + '">' + dp + '</span>' +
      '<span class="pl ' + holdCls(it.pl) + '">' + pl + '</span>';
    hList.appendChild(d);
  });
  renderBallHold();
}
/* 悬浮球本体：持仓累计盈亏一行（红盈绿亏），悬停显示总市值与当日盈亏 */
function renderBallHold() {
  var has = holdData && holdData.sum && holdData.items && holdData.items.length;
  if (!has) {
    ballHold.textContent = '';
    ballHold.className = 'hold';
    ball.title = '';
    return;
  }
  var s = holdData.sum;
  ballHold.textContent = fmtHoldMoney(s.pl);
  ballHold.className = 'hold on ' + holdCls(s.pl);
  ball.title = '总市值 ' + fmtHoldMoney(s.mv) + ' · 当日盈亏 ' + fmtHoldMoney(s.dayPl);
}
function requestHoldings() {
  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage({ type: 'holdings' }, function (resp) {
      if (chrome.runtime.lastError || !resp || !resp.ok) return;
      holdData = resp;
      renderHoldingsUI();
    });
  } catch (e) { }
}
hRef.addEventListener('click', function () { requestHoldings(); });
hGo.addEventListener('click', function () {
  try { chrome.runtime.sendMessage({ type: 'openOptions' }); } catch (e) { }
});

/* ================= 首次提示气泡 ================= */
function showHint() {
  if (!visible) return;
  try {
    chrome.storage.local.get('chhHint', function (o) {
      if (o && o.chhHint) return;
      var r = ball.getBoundingClientRect();
      hintEl.style.left = (r.left + 39 - hintEl.offsetWidth / 2) + 'px';
      hintEl.style.top = Math.max(8, r.top - 46) + 'px';
      hintEl.classList.add('show');
      try { chrome.storage.local.set({ chhHint: true }); } catch (e) { }
      setTimeout(function () { hintEl.classList.remove('show'); }, 5200);
    });
  } catch (e) { }
}
function hideHint() { hintEl.classList.remove('show'); }

/* ================= 拖动 ================= */
var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
function moveBall(x, y) {
  x = Math.max(4, Math.min(x, window.innerWidth - 78 - 4));
  y = Math.max(4, Math.min(y, window.innerHeight - 78 - 4));
  ball.style.left = x + 'px';
  ball.style.top = y + 'px';
}
function savePos() {
  var r = ball.getBoundingClientRect();
  var p = { x: r.left, y: r.top };
  try { chrome.storage.local.set({ chhPos: p }); } catch (e) {
    try { localStorage.setItem('chhPos', JSON.stringify(p)); } catch (e2) { }
  }
}
ball.addEventListener('pointerdown', function (e) {
  if (e.target === btnHideBall) return;
  dragging = true; moved = false;
  sx = e.clientX; sy = e.clientY;
  var r = ball.getBoundingClientRect();
  ox = r.left; oy = r.top;
  try { ball.setPointerCapture(e.pointerId); } catch (e2) { }
  try { e.preventDefault(); } catch (e2) { }
  ball.classList.add('dragging');
  hideHint();
});
ball.addEventListener('pointermove', function (e) {
  if (!dragging) return;
  var dx = e.clientX - sx, dy = e.clientY - sy;
  if (!moved && Math.hypot(dx, dy) > 6) { moved = true; card.classList.remove('open'); }
  if (moved) moveBall(ox + dx, oy + dy);
});
function endDrag() {
  if (!dragging) return;
  dragging = false;
  ball.classList.remove('dragging');
  if (!moved) { toggleCard(); }
  else { snapBall(); savePos(); } /* 仅拖动后保存位置，点击开卡不写存储 */
}
function snapBall() {
  var r = ball.getBoundingClientRect();
  var w = 78, h = 78, m = 56;
  var vw = window.innerWidth, vh = window.innerHeight;
  var x = r.left, y = r.top;
  var cx = r.left + w / 2, cy = r.top + h / 2;
  if (cx < m) x = 4; else if (vw - cx < m) x = vw - w - 4;
  if (cy < m) y = 4; else if (vh - cy < m) y = vh - h - 4;
  moveBall(x, y);
}
ball.addEventListener('pointerup', endDrag);
ball.addEventListener('pointercancel', endDrag);

/* ================= 卡片 ================= */
function toggleCard() {
  var open = card.classList.toggle('open');
  if (open) {
    placeCard();
    /* 默认展开「智能预测」并加载数据 */
    if (!prd.classList.contains('open')) prd.classList.add('open');
    refreshPredict(true);
  }
}
function placeCard() {
  var r = ball.getBoundingClientRect();
  var cw = card.offsetWidth, ch = card.offsetHeight;
  var left = (r.right + 14 + cw <= window.innerWidth - 8) ? r.right + 14 : r.left - 14 - cw;
  left = Math.max(8, Math.min(left, window.innerWidth - cw - 8));
  var top = r.top + r.height / 2 - ch / 2;
  top = Math.max(8, Math.min(top, window.innerHeight - ch - 8));
  card.style.left = left + 'px';
  card.style.top = top + 'px';
}
btnClose.addEventListener('click', function () { card.classList.remove('open'); });
/* ================= 悬浮球显隐 ================= */
function applyVisible() {
  if (visible) {
    ball.style.display = '';
    if (!holdTimer) holdTimer = setInterval(requestHoldings, 30000);
  } else {
    card.classList.remove('open');
    hintEl.classList.remove('show');
    ball.style.display = 'none';
    if (holdTimer) { clearInterval(holdTimer); holdTimer = null; } /* 隐藏时停止持仓轮询 */
  }
  scheduleNext();
}
function setVisible(v) {
  visible = !!v;
  try { chrome.storage.local.set({ chhVisible: visible }); } catch (e) { }
  applyVisible();
}
btnHideBall.addEventListener('click', function (e) {
  e.stopPropagation();
  setVisible(false);
});
/* 键盘可访问：悬浮球与关闭钮支持 Enter/Space 操作 */
ball.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(); }
});
btnHideBall.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setVisible(false); }
});
btnHide.addEventListener('click', function () {
  setVisible(false);
});
btnNow.addEventListener('click', function () { refresh(); });
btnOpts.addEventListener('click', function () {
  /* openOptionsPage 仅扩展页面可用，content script 需转发给后台执行 */
  try {
    chrome.runtime.sendMessage({ type: 'openOptions' });
  } catch (e) { }
});
btnPause.addEventListener('click', function () {
  paused = !paused;
  btnPause.textContent = paused ? '恢复' : '暂停';
  if (paused) scheduleNext(); /* 暂停即停表 */
  else refresh();
});
window.addEventListener('resize', function () {
  if (!visible) return;
  var r = ball.getBoundingClientRect();
  moveBall(r.left, r.top);
  if (card.classList.contains('open')) placeCard();
  drawSpark();
});

/* ================= 统计网格 ================= */
var STATS = [
  ['今开', 'open'], ['昨收', 'prevClose'], ['最高', 'high'], ['最低', 'low'],
  ['成交量', 'volume'], ['成交额', 'amount'], ['换手率', 'turnover'], ['振幅', 'amplitude'],
  ['市盈率(动)', 'pe'], ['市净率', 'pb'], ['总市值', 'totalCap'], ['流通市值', 'floatCap']
];
var gridVal = {};
  STATS.forEach(function (s) {
    var c = document.createElement('div');
    c.className = 'cell';
    c.innerHTML = '<span class="lbl">' + s[0] + '</span><span class="val" data-k="' + s[1] + '">--</span>';
    gridVal[s[1]] = c.querySelector('.val');
    gridEl.appendChild(c);
  });

/* ================= 初始化 ================= */
(function init() {
  var x = window.innerWidth - 78 - 40, y = window.innerHeight * 0.62;
  var restore = function (p) {
    if (p && isFinite(p.x) && isFinite(p.y) && p.x < window.innerWidth && p.y < window.innerHeight) {
      x = p.x; y = p.y;
    }
  };
  try { chrome.storage.local.get('chhPos', function (o) { restore(o && o.chhPos); moveBall(x, y); }); } catch (e) { }
  moveBall(x, y);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') card.classList.remove('open'); });
  loadAll();
})();
})();
