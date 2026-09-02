/* 实时股价 · 配置公共逻辑（popup / options / content 共用存储结构） */
'use strict';

var MARKET_LABEL = { sz: '深交所', sh: '上交所', bj: '北交所', hk: '港股', us: '美股', sg: '上金所' };
var TYPE_LABEL = {
  'GP-A': 'A股', 'GP': '股票', 'GP-H': '港股', 'GP-U': '美股',
  'ETF': 'ETF', 'LOF': 'LOF', 'ZS': '指数', 'QZ': '权证',
  'KJ-HB': '货币基金', 'KJ-JJ': '基金', '现货': '现货'
};
var STOCK_TYPES = { 'GP-A': 1, 'GP': 1, 'GP-H': 1, 'GP-U': 1, 'ETF': 1, 'LOF': 1, 'QZ': 1, '现货': 1 };

/* 多股票列表存储：chhStocks = [{market, code, name}, ...]
 * 无内置默认股票，完全由用户自行添加配置。 */
function loadStocks(cb) {
  chrome.storage.local.get(['chhStocks', 'chhCfg'], function (o) {
    var list = (o && Array.isArray(o.chhStocks)) ? o.chhStocks.slice() : [];
    /* 兼容旧版单股票配置：将用户此前设置的 chhCfg 迁移为列表 */
    if (!list.length && o && o.chhCfg && o.chhCfg.code && o.chhCfg.market && o.chhCfg.name) {
      list = [{ market: o.chhCfg.market, code: o.chhCfg.code, name: o.chhCfg.name }];
      try { chrome.storage.local.set({ chhStocks: list }); } catch (e) {}
    }
    cb(list);
  });
}
function saveStocks(list, cb) {
  chrome.storage.local.set({ chhStocks: list }, cb || function () {});
}
/* 当前展示的股票索引：chhActive */
function loadActive(cb) {
  chrome.storage.local.get('chhActive', function (o) {
    var i = (o && o.chhActive != null) ? +o.chhActive : 0;
    cb(isFinite(i) && i >= 0 ? i : 0);
  });
}
function saveActive(i, cb) {
  chrome.storage.local.set({ chhActive: i }, cb || function () {});
}
/* 持仓列表存储：chhHoldings = [{market, code, name, qty, cost}, ...]
 * qty 为持股数量（股），cost 为每股成本（对应币种）。 */
function loadHoldings(cb) {
  chrome.storage.local.get('chhHoldings', function (o) {
    cb((o && Array.isArray(o.chhHoldings)) ? o.chhHoldings.slice() : []);
  });
}
function saveHoldings(list, cb) {
  chrome.storage.local.set({ chhHoldings: list }, cb || function () {});
}
function marketLabel(m) { return MARKET_LABEL[m] || String(m || '').toUpperCase(); }
function typeLabel(t) { return TYPE_LABEL[t] || t || '证券'; }
function isStockType(t) { return !!STOCK_TYPES[t]; }
/* 展示用全代码：sz002895 / hk00700 / usAAPL */
function displayCode(item) {
  var c = String(item.code);
  if (item.market === 'us') return 'us' + c.split('.')[0].toUpperCase();
  return item.market + c;
}
/* 搜索接口（走后台，避免 CORS 与编码问题） */
function searchStocks(q) {
  return new Promise(function (resolve, reject) {
    chrome.runtime.sendMessage({ type: 'search', q: q }, function (resp) {
      if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
      if (resp && resp.ok) resolve(resp.list || []);
      else reject(new Error((resp && resp.error) || 'search fail'));
    });
  });
}
/* 拉取一次行情（预览用） */
function fetchQuoteOnce(cfg) {
  return new Promise(function (resolve, reject) {
    chrome.runtime.sendMessage({ type: 'quote', cfg: cfg }, function (resp) {
      if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
      if (resp && resp.ok) resolve(resp);
      else reject(new Error((resp && resp.error) || 'quote fail'));
    });
  });
}
