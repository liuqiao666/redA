/* A股行情悬浮球 · 后台服务（MV3 Service Worker）
 * 1) quote：按配置动态拉取行情（腾讯主源，A股失败降级东方财富）
 * 2) search：腾讯智能搜索，按名称/代码查股票候选 */
'use strict';

var TX_SEARCH = 'https://smartbox.gtimg.cn/s3/?v=2&q=';
var EM_API = 'https://push2.eastmoney.com/api/qt/stock/get';
var KLINE_API = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=';
var EM_TREND_API = 'https://push2his.eastmoney.com/api/qt/stock/trends2/get';
var EM_KLINE_API = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
var EM_SUGGEST = 'https://searchapi.eastmoney.com/api/suggest/get';
var EM_SUGGEST_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';

/* 腾讯行情查询代码：us 需去点转大写，其余市场直接前缀+代码 */
function txQueryCode(cfg) {
  if (cfg.market === 'us') return 'us' + String(cfg.code).split('.')[0].toUpperCase();
  return cfg.market + cfg.code;
}
/* 东财 secid：A 股 sh=1. sz/bj=0.；上金所现货（黄金9999 等）sg=118. */
function emSecid(cfg) {
  var m = { sh: '1.', sz: '0.', bj: '0.', sg: '118.' }[cfg.market];
  return m ? m + cfg.code : null;
}

function parseTx(p, market) {
  var d = {
    price: +p[3], prevClose: +p[4], open: +p[5], volHand: +p[6],
    high: +p[33], low: +p[34], change: +p[31], pct: +p[32], t: p[30],
    amtYuan: null, turnover: null, pe: null, pb: null,
    floatCap: null, totalCap: null, lu: null, ld: null
  };
  if (market === 'sh' || market === 'sz' || market === 'bj') {
    d.amtYuan = (+p[37]) * 1e4; d.turnover = +p[38]; d.pe = +p[39]; d.pb = +p[46];
    d.floatCap = (+p[44]) * 1e8; d.totalCap = (+p[45]) * 1e8; d.lu = +p[47]; d.ld = +p[48];
  } else if (market === 'hk') {
    d.amtYuan = (+p[37]); d.pe = +p[39];
  } else if (market === 'us') {
    d.amtYuan = (+p[37]); d.pe = +p[39];
  }
  return d;
}

function parseEM(d) {
  return {
    price: d.f43, prevClose: d.f60, open: d.f46, high: d.f44, low: d.f45,
    volHand: d.f47, amtYuan: d.f48, turnover: d.f168, pe: d.f162, pb: d.f167,
    totalCap: d.f116, floatCap: d.f117,
    change: d.f169, pct: d.f170, lu: null, ld: null, t: ''
  };
}

function fetchTencent(cfg) {
  var url = 'https://qt.gtimg.cn/q=' + txQueryCode(cfg) + '&_=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.text(); })
    .then(function (txt) {
      var m = txt.match(/="([^"]*)"/);
      if (!m || !m[1] || m[1].indexOf('~') < 0) throw new Error('no data');
      var d = parseTx(m[1].split('~'), cfg.market);
      if (!isFinite(d.price) || d.price <= 0) throw new Error('bad tx data');
      return d;
    });
}

function fetchEM(cfg) {
  if (cfg.market === 'sg') return fetchSGE(cfg);
  var secid = emSecid(cfg);
  if (!secid) return Promise.reject(new Error('em unsupported market'));
  var url = EM_API + '?secid=' + secid + '&fltt=2&invt=2&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f117,f162,f167,f168,f169,f170&_=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (json) {
      if (!json || !json.data || !isFinite(json.data.f43)) throw new Error('bad em data');
      return parseEM(json.data);
    });
}

/* 上金所现货（黄金9999 等）：push2 无快照，先走分时 trends2；失败再退日K最新一根（今日实时收盘） */
function fetchSGE(cfg) {
  var secid = emSecid(cfg);
  if (!secid) return Promise.reject(new Error('sge unsupported'));
  return fetchSGETrend(cfg, secid).catch(function () { return fetchSGEKline(cfg, secid); });
}
function sgeBuild(price, prevClose, open, high, low, t) {
  if (!isFinite(price) || price <= 0) throw new Error('bad sge price');
  if (!isFinite(prevClose) || prevClose <= 0) prevClose = null;
  return {
    price: price, prevClose: prevClose, open: open, high: high, low: low,
    volHand: null, amtYuan: null, turnover: null, pe: null, pb: null,
    totalCap: null, floatCap: null, lu: null, ld: null,
    change: (prevClose != null) ? price - prevClose : null,
    pct: (prevClose != null && prevClose > 0) ? (price - prevClose) / prevClose * 100 : null,
    t: t || ''
  };
}
function fetchSGETrend(cfg, secid) {
  var url = EM_TREND_API + '?secid=' + secid +
    '&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f53,f56,f58&ndays=1&iscr=0&_=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (json) {
      var data = json && json.data;
      var trends = (data && Array.isArray(data.trends)) ? data.trends : [];
      if (!trends.length) throw new Error('no sge trend');
      var pts = trends.map(function (s) { return s.split(','); });
      var last = pts[pts.length - 1];
      var open = +pts[0][1], high = -Infinity, low = Infinity;
      pts.forEach(function (p) { var v = +p[1]; if (v > high) high = v; if (v < low) low = v; });
      var pc = (data.preClose != null && isFinite(+data.preClose)) ? +data.preClose : +data.preSettlement;
      return sgeBuild(+last[1], pc, open, high, low, last[0]);
    });
}
function fetchSGEKline(cfg, secid) {
  var url = EM_KLINE_API + '?secid=' + secid +
    '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=0&end=20500101&lmt=2&_=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (json) {
      var kl = (json && json.data && Array.isArray(json.data.klines)) ? json.data.klines : [];
      if (kl.length < 2) throw new Error('no sge kline');
      var last = kl[kl.length - 1].split(',');
      var prev = kl[kl.length - 2].split(',');
      return sgeBuild(+last[2], +prev[2], +last[1], +last[3], +last[4], last[0]);
    });
}

function decodeUni(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
}

/* 东财搜索补充源：能命中上金所现货（黄金9999/AU9999）等腾讯缺失的品种 */
var EM_MKT = {
  SH: 'sh', SZ: 'sz', BJ: 'bj', HK: 'hk', SGE: 'sg',
  '1': 'sh', '2': 'sh', '5': 'sz', '6': 'sz', '81': 'bj'
};
function emType(it, mkt) {
  var t = String(it.SecurityTypeName || '');
  if (mkt === 'us') return 'GP-U';
  if (mkt === 'hk') return 'GP-H';
  if (mkt === 'sg') return '现货';
  if (t.indexOf('ETF') >= 0) return 'ETF';
  if (t.indexOf('LOF') >= 0) return 'LOF';
  return 'GP-A';
}
function emSuggest(q) {
  var url = EM_SUGGEST + '?input=' + encodeURIComponent(q) +
    '&type=14&token=' + EM_SUGGEST_TOKEN + '&count=10';
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var rows = (j && j.QuotationCodeTable && Array.isArray(j.QuotationCodeTable.Data)) ? j.QuotationCodeTable.Data : [];
      var out = [];
      rows.forEach(function (it) {
        var jys = String(it.JYS || '').toUpperCase();
        var mkt = EM_MKT[jys];
        if (!mkt && (jys === 'NASDAQ' || jys === 'NYSE' || jys === 'AMEX')) mkt = 'us';
        if (!mkt || !it.Code || !it.Name) return;
        if (/^BK/i.test(String(it.Code))) return; /* 板块（如 BK1617 黄金板块）不可报价，剔除 */
        out.push({ market: mkt, code: String(it.Code), name: String(it.Name), pinyin: String(it.PinYin || ''), type: emType(it, mkt) });
      });
      return out;
    })
    .catch(function () { return []; });
}

function searchStock(q) {
  var url = TX_SEARCH + encodeURIComponent(q) + '&t=all';
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.text(); })
    .then(function (txt) {
      var m = txt.match(/"([^"]*)"/);
      if (!m || !m[1] || m[1] === 'N') return [];
      return m[1].split('^').map(function (s) {
        var f = s.split('~');
        return { market: f[0], code: f[1], name: decodeUni(f[2] || ''), pinyin: f[3] || '', type: f[4] || '' };
      }).filter(function (x) { return x.code && x.name; });
    })
    .then(function (list) {
      /* 兜底：腾讯接口对「黄金999」「usAAPL」「hk00700」等含数字/市场前缀的关键词常返回空，
       * 尝试去数字/去前缀后再搜（黄金999 → 黄金；usAAPL → AAPL），命中可交易品种 */
      if (list.length) return list;
      var seen = {}, retry = [];
      function add(v) {
        v = v.trim();
        if (!v || v === q || seen[v]) return;
        seen[v] = 1;
        retry.push(v);
      }
      var d1 = q.replace(/[0-9a-zA-Z]+$/g, '');   /* 黄金999 → 黄金 */
      if (/[\u4e00-\u9fa5]/.test(d1)) add(d1);
      var d2 = q.replace(/[0-9a-zA-Z]/g, '');     /* 黄金9999 → 黄金 */
      if (/[\u4e00-\u9fa5]/.test(d2)) add(d2);
      var d3 = q.replace(/^(sh|sz|bj|hk|us)/i, ''); /* usAAPL → AAPL、hk00700 → 00700 */
      if (/^[0-9a-zA-Z.]+$/.test(d3)) add(d3);
      if (!retry.length) return list;
      return retry.reduce(function (p, v) {
        return p.then(function (acc) {
          return searchStock(v).then(function (r) { return acc.concat(r); });
        });
      }, Promise.resolve([]));
    })
    .then(function (txList) {
      /* 合并东财搜索结果（含上金所现货），按 市场+代码 去重 */
      var probes = [q];
      /* 纯中文短词（如「黄金」）东财只给股票/ETF，补搜「黄金999」以带出上金所现货 */
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(q)) probes.push(q + '999');
      var seen = {};
      txList.forEach(function (x) { seen[x.market + ':' + x.code] = 1; });
      return probes.reduce(function (p, v) {
        return p.then(function () {
          return emSuggest(v).then(function (emList) {
            emList.forEach(function (x) {
              var k = x.market + ':' + x.code;
              if (!seen[k]) { seen[k] = 1; txList.push(x); }
            });
          });
        });
      }, Promise.resolve()).then(function () { return txList; });
    });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return;
  if (msg.type === 'quote') {
    var cfg = msg.cfg;
    if (!cfg || !cfg.market || !cfg.code) {
      sendResponse({ ok: false, error: 'missing cfg' });
      return true;
    }
    /* 上金所现货无腾讯源，直接走东财 */
    var p;
    if (cfg.market === 'sg') {
      p = fetchEM(cfg).then(function (d) { return { data: d, source: 'em' }; });
    } else {
      p = fetchTencent(cfg).then(function (d) { return { data: d, source: 'tx' }; })
        .catch(function () {
          return fetchEM(cfg).then(function (d) { return { data: d, source: 'em' }; });
        });
    }
    p.then(function (r) { sendResponse({ ok: true, data: r.data, source: r.source }); })
      .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
    return true;
  }
  if (msg.type === 'search') {
    searchStock(msg.q)
      .then(function (list) { sendResponse({ ok: true, list: list }); })
      .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
    return true;
  }
  if (msg.type === 'predict') {
    var pcfg = msg.cfg;
    if (!pcfg || !pcfg.market || !pcfg.code) {
      sendResponse({ ok: false, error: 'missing cfg' });
      return true;
    }
    fetchKline(pcfg, 120)
      .then(function (rows) {
        if (msg.mode === 'intraday') {
          return predictIntraday(pcfg, msg.quote || {}, rows, msg.recent || []);
        }
        return predictDay(pcfg, rows);
      })
      .then(function (d) { sendResponse({ ok: true, data: d }); })
      .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
    return true;
  }
  if (msg.type === 'news') {
    var ncfg = msg.cfg;
    if (!ncfg || !ncfg.market || !ncfg.code) {
      sendResponse({ ok: false, error: 'missing cfg' });
      return true;
    }
    fetchHotNews(ncfg, !!msg.force)
      .then(function (d) { sendResponse({ ok: true, data: d }); })
      .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
    return true;
  }
  if (msg.type === 'flow') {
    var fcfg = msg.cfg;
    if (!fcfg || !fcfg.market || !fcfg.code) {
      sendResponse({ ok: false, error: 'missing cfg' });
      return true;
    }
    flowPayload(fcfg, !!msg.force)
      .then(function (d) { sendResponse({ ok: true, data: d }); })
      .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
    return true;
  }
});

/* ================= 预测：技术指标库 ================= */
var KLINE_CACHE = {};
var KLINE_TTL = 5 * 60 * 1000;
function fetchKline(cfg, days) {
  var q = txQueryCode(cfg);
  var key = q + ':' + days;
  var c = KLINE_CACHE[key];
  if (c && Date.now() - c.t < KLINE_TTL) return Promise.resolve(c.rows);
  var p;
  if (cfg.market === 'sg') {
    /* 上金所现货：腾讯无K线，走东财日K（列位与腾讯一致：[日期,开,收,高,低,量,额]） */
    var url = EM_KLINE_API + '?secid=' + emSecid(cfg) +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=0&end=20500101&lmt=' + days + '&_=' + Date.now();
    p = fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        var kl = (json && json.data && Array.isArray(json.data.klines)) ? json.data.klines : [];
        var rows = kl.map(function (s) { return s.split(','); });
        if (rows.length < 30) throw new Error('kline insufficient');
        KLINE_CACHE[key] = { t: Date.now(), rows: rows };
        return rows;
      });
  } else {
    var url = KLINE_API + q + ',day,,,' + days + ',qfq';
    p = fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        var node = json && json.data && json.data[q];
        var rows = (node && (node.qfqday || node.day)) || [];
        if (rows.length < 30) throw new Error('kline insufficient');
        KLINE_CACHE[key] = { t: Date.now(), rows: rows };
        return rows;
      });
  }
  return p;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function r2(v) { return (v == null || isNaN(v)) ? null : Math.round(v * 100) / 100; }

function emaArr(arr, n) {
  var k = 2 / (n + 1), out = [], prev = arr[0];
  out[0] = prev;
  for (var i = 1; i < arr.length; i++) { prev = arr[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function smaLast(arr, n) {
  if (arr.length < n) return null;
  var s = 0;
  for (var i = arr.length - n; i < arr.length; i++) s += arr[i];
  return s / n;
}
function calcRsi(closes, n) {
  var gains = 0, losses = 0;
  for (var i = closes.length - n; i < closes.length; i++) {
    var ch = closes[i] - closes[i - 1];
    if (ch > 0) gains += ch; else losses -= ch;
  }
  if (gains + losses === 0) return 50;
  return 100 - 100 / (1 + gains / losses);
}
function calcMacd(closes) {
  var e12 = emaArr(closes, 12), e26 = emaArr(closes, 26);
  var dif = e12.map(function (v, i) { return v - e26[i]; });
  var dea = emaArr(dif, 9);
  var hist = dif.map(function (v, i) { return (v - dea[i]) * 2; });
  return {
    dif: dif[dif.length - 1], dea: dea[dea.length - 1],
    hist: hist[hist.length - 1], histPrev: hist[hist.length - 2]
  };
}
function calcKdj(rows, n) {
  var k = 50, d = 50;
  for (var i = 0; i < rows.length; i++) {
    var c = +rows[i][2];
    var hh = c, ll = c;
    for (var j = Math.max(0, i - n + 1); j <= i; j++) {
      hh = Math.max(hh, +rows[j][3]); ll = Math.min(ll, +rows[j][4]);
    }
    var rsv = (hh === ll) ? 50 : (c - ll) / (hh - ll) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
  }
  return { k: k, d: d, j: 3 * k - 2 * d };
}
function calcBoll(closes, n) {
  var mid = smaLast(closes, n);
  if (mid == null) return { mid: null, upper: null, lower: null };
  var s = 0;
  for (var i = closes.length - n; i < closes.length; i++) s += Math.pow(closes[i] - mid, 2);
  var sd = Math.sqrt(s / n);
  return { mid: mid, upper: mid + 2 * sd, lower: mid - 2 * sd };
}
function calcAtr(rows, n) {
  var trs = [];
  for (var i = 1; i < rows.length; i++) {
    var h = +rows[i][3], l = +rows[i][4], pc = +rows[i - 1][2];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  var s = 0, atr = null;
  for (var i = 0; i < trs.length; i++) {
    s += trs[i];
    if (i >= n) s -= trs[i - n];
    if (i >= n - 1) atr = s / n;
  }
  return atr || trs[trs.length - 1];
}
function calcRetStats(closes, m) {
  var rets = [];
  for (var i = closes.length - m; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
  var mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
  var sd = Math.sqrt(rets.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (rets.length - 1));
  return { mean: mean, sd: sd };
}
/* 各市场交易时钟：返回当日已进行占比 */
function marketClock(market) {
  var now = new Date();
  var day = now.getDay();
  var m = now.getHours() * 60 + now.getMinutes();
  if (day === 0 || day === 6) return { frac: 1, live: false };
  if (market === 'hk') {
    var e1 = Math.max(0, Math.min(150, m - 570));
    var e2 = Math.max(0, Math.min(180, m - 780));
    var t = e1 + e2;
    return { frac: clamp(t / 330, 0, 1), live: t > 0 && t < 330 };
  }
  if (market === 'us') {
    var base = m >= 1290 ? m - 1290 : m + 1440 - 1290;
    var tu = clamp(base, 0, 390);
    return { frac: tu / 390, live: tu > 0 && tu < 390 };
  }
  var a1 = Math.max(0, Math.min(120, m - 570));
  var a2 = Math.max(0, Math.min(120, m - 780));
  var ta = a1 + a2;
  return { frac: clamp(ta / 240, 0, 1), live: ta > 0 && ta < 240 };
}

/* ================= 分时K线 / 大盘指数 ================= */
var MINUTE_API = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=';
var MIN_CACHE = {}, MIN_TTL = 30 * 1000;
var IDX_CACHE = {}, IDX_TTL = 60 * 1000;
function indexCode(market) {
  return market === 'hk' ? 'hkHSI' : (market === 'us' ? 'usDJI' : 'sh000001');
}
function fetchIndex(market) {
  var code = indexCode(market);
  var c = IDX_CACHE[code];
  if (c && Date.now() - c.t < IDX_TTL) return Promise.resolve(c.data);
  return fetch('https://qt.gtimg.cn/q=' + code + '&_=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.text(); })
    .then(function (txt) {
      var m = txt.match(/="([^"]*)"/);
      if (!m || !m[1]) throw new Error('no idx');
      var p = m[1].split('~');
      var d = { price: +p[3], pct: +p[32], name: p[1] || '' };
      IDX_CACHE[code] = { t: Date.now(), data: d };
      return d;
    });
}
function fetchMinute(cfg) {
  var q = txQueryCode(cfg);
  var c = MIN_CACHE[q];
  if (c && Date.now() - c.t < MIN_TTL) return Promise.resolve(c.data);
  return fetch(MINUTE_API + q + '&_=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var node = j && j.data && j.data[q] && j.data[q].data;
      var arr = node && node.data;
      if (!Array.isArray(arr) || arr.length < 5) throw new Error('no minute');
      var pts = arr.map(function (s) {
        var f = String(s).split(' ');
        return { t: f[0] || '', p: +f[1], v: +f[2], a: +f[3] };
      });
      var last = pts[pts.length - 1];
      var data = { pts: pts, price: last.p, cumVol: last.v, cumAmt: last.a, date: node.date || '' };
      MIN_CACHE[q] = { t: Date.now(), data: data };
      return data;
    });
}

/* ================= 扩展指标（OBV / ADX / CCI） ================= */
function parseRows(rows) {
  return {
    closes: rows.map(function (r) { return +r[2]; }),
    highs: rows.map(function (r) { return +r[3]; }),
    lows: rows.map(function (r) { return +r[4]; }),
    opens: rows.map(function (r) { return +r[1]; }),
    vols: rows.map(function (r) { return +r[5]; }),
    n: rows.length,
    last: +rows[rows.length - 1][2]
  };
}
function calcObv(closes, vols) {
  var obv = [0];
  for (var i = 1; i < closes.length; i++) {
    var v = vols[i] || 0;
    obv.push(closes[i] > closes[i - 1] ? obv[i - 1] + v : (closes[i] < closes[i - 1] ? obv[i - 1] - v : obv[i - 1]));
  }
  return obv;
}
function calcAdx(rows, n) {
  var trs = [], pdm = [], mdm = [];
  for (var i = 1; i < rows.length; i++) {
    var h = +rows[i][3], l = +rows[i][4], pc = +rows[i - 1][2], ph = +rows[i - 1][3], pl = +rows[i - 1][4];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    var up = h - ph, dn = pl - l;
    pdm.push((up > dn && up > 0) ? up : 0);
    mdm.push((dn > up && dn > 0) ? dn : 0);
  }
  var N = Math.min(n, trs.length);
  var sTr = 0, sPd = 0, sMd = 0;
  for (var i = 0; i < N; i++) { sTr += trs[i]; sPd += pdm[i]; sMd += mdm[i]; }
  var dxs = [];
  for (var i = N; i <= trs.length; i++) {
    var pdi = sTr ? 100 * sPd / sTr : 0, mdi = sTr ? 100 * sMd / sTr : 0;
    dxs.push((pdi + mdi) ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0);
    if (i < trs.length) {
      sTr = sTr - sTr / N + trs[i];
      sPd = sPd - sPd / N + pdm[i];
      sMd = sMd - sMd / N + mdm[i];
    }
  }
  var sum = 0;
  for (var i = Math.max(0, dxs.length - N); i < dxs.length; i++) sum += dxs[i];
  return { adx: dxs.length ? sum / Math.min(N, dxs.length) : 0 };
}
function calcCci(rows, n) {
  var tp = [];
  for (var i = 0; i < rows.length; i++) tp.push((+rows[i][2] + +rows[i][3] + +rows[i][4]) / 3);
  var out = null;
  for (var i = n - 1; i < tp.length; i++) {
    var sum = 0;
    for (var j = i - n + 1; j <= i; j++) sum += tp[j];
    var ma = sum / n, md = 0;
    for (var j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - ma);
    md /= n;
    out = md ? (tp[i] - ma) / (0.015 * md) : 0;
  }
  return out;
}

/* ================= 概率校准（滚动回测） ================= */
function smaSlice(arr, from, n) {
  var s = 0;
  for (var i = from; i < from + n; i++) s += arr[i];
  return s / n;
}
function calcRsiAt(closes, i, n) {
  var gains = 0, losses = 0;
  for (var j = i - n + 1; j <= i; j++) {
    var ch = closes[j] - closes[j - 1];
    if (ch > 0) gains += ch; else losses -= ch;
  }
  if (gains + losses === 0) return 50;
  return 100 - 100 / (1 + gains / losses);
}
function trendScoreAt(closes, highs, lows, vols, i) {
  if (i < 24) return 0;
  var s = 0;
  var ma5 = smaSlice(closes, i - 4, 5), ma10 = smaSlice(closes, i - 9, 10), ma20 = smaSlice(closes, i - 19, 20);
  if (ma5 > ma10 && ma10 > ma20) s += 2; else if (ma5 > ma20) s += 1;
  if (ma5 < ma10 && ma10 < ma20) s -= 2; else if (ma5 < ma20) s -= 1;
  var c = closes[i];
  if (c > ma20) s += 0.5; else s -= 0.5;
  var rsi = calcRsiAt(closes, i, 14);
  if (rsi < 30) s += 0.5; else if (rsi > 70) s -= 0.5;
  var cp = 0, cnt = 0;
  for (var j = i - 4; j <= i; j++) { var rng = highs[j] - lows[j]; if (rng > 0) { cp += (closes[j] - lows[j]) / rng; cnt++; } }
  cp = cnt ? cp / cnt : 0.5;
  if (cp > 0.6) s += 0.5; else if (cp < 0.4) s -= 0.5;
  var v5 = smaSlice(vols, i - 4, 5), vp = smaSlice(vols, i - 14, 5);
  if (v5 && vp) { if (v5 > vp * 1.15) s += 0.4; else if (v5 < vp * 0.85) s -= 0.4; }
  var ret10 = c / closes[i - 10] - 1;
  if (ret10 > 0.05) s += 0.5; else if (ret10 < -0.05) s -= 0.5;
  return s;
}
function calibrateProb(closes, highs, lows, vols, curScore) {
  var buckets = {};
  for (var i = 24; i < closes.length - 1; i++) {
    var s = trendScoreAt(closes, highs, lows, vols, i);
    var b = Math.max(-4, Math.min(4, Math.round(s / 1.5)));
    if (!buckets[b]) buckets[b] = { n: 0, up: 0 };
    buckets[b].n++;
    if (closes[i + 1] > closes[i]) buckets[b].up++;
  }
  var b = Math.max(-4, Math.min(4, Math.round(curScore / 1.5)));
  var B = buckets[b] || { n: 0, up: 0 };
  var freq = B.n ? (B.up + 1) / (B.n + 2) : 0.5;
  var w = Math.min(1, B.n / 20);
  return { prob: w * freq + (1 - w) * 0.5, sample: B.n, buckets: Object.keys(buckets).length };
}

/* ================= 预测命中率追踪（跨会话） ================= */
var TRACK_KEY = 'chhPredTrack';
function loadTrack(cb) {
  try { chrome.storage.local.get(TRACK_KEY, function (o) { cb((o && Array.isArray(o[TRACK_KEY])) ? o[TRACK_KEY] : []); }); }
  catch (e) { cb([]); }
}
function updateTracking(rows, stats, cb) {
  var lastDate = rows[rows.length - 1][0];
  var pi = rows.length - 2;
  if (pi < 1) { cb({ hitRate: null, trackN: 0 }); return; }
  var outcomeDate = rows[pi][0];
  var actual = +rows[pi][2], prevC = +rows[pi - 1][2];
  var up = actual > prevC, dn = actual < prevC;
  var outcome = up ? 'up' : (dn ? 'down' : 'flat');
  loadTrack(function (track) {
    for (var i = 0; i < track.length; i++) {
      if (track[i].date === outcomeDate && track[i].outcome == null) {
        track[i].outcome = outcome;
        track[i].close = actual;
      }
    }
    var has = track.some(function (t) { return t.date === lastDate; });
    if (!has && stats) track.push({ date: lastDate, dir: stats.dir, probUp: stats.probUp });
    while (track.length > 40) track.shift();
    var done = track.filter(function (t) { return t.outcome && t.dir && t.dir !== 'flat'; });
    var hits = done.filter(function (t) { return t.outcome === t.dir; }).length;
    var out = { hitRate: done.length ? Math.round(hits / done.length * 100) : null, trackN: done.length };
    try { chrome.storage.local.set({ chhPredTrack: track }, function () { cb(out); }); }
    catch (e) { cb(out); }
  });
}

/* ================= 预测：次日（基于日K统计 + 回测校准） ================= */
function computeDayStats(cfg, rows, idx) {
  var R = parseRows(rows);
  var closes = R.closes, highs = R.highs, lows = R.lows, opens = R.opens, vols = R.vols, n = R.n, last = R.last;

  var ma5 = smaLast(closes, 5), ma10 = smaLast(closes, 10),
      ma20 = smaLast(closes, 20), ma60 = smaLast(closes, Math.min(60, n));
  var rsi = calcRsi(closes, 14);
  var macd = calcMacd(closes);
  var kdj = calcKdj(rows, 9);
  var boll = calcBoll(closes, 20);
  var atr = calcAtr(rows, 14);
  var stats = calcRetStats(closes, 20);
  var atrPct = atr / last * 100;

  var obv = calcObv(closes, vols);
  var obv5 = smaLast(obv.slice(-5), 5), obvPrev = smaLast(obv.slice(-10, -5), 5);
  var adx = calcAdx(rows, 14).adx;
  var cci = calcCci(rows, 20);

  var upDays = 0, closePosSum = 0, gaps = [], gapUp = 0, gapDn = 0;
  for (var j = n - 20; j < n; j++) {
    if (closes[j] > closes[j - 1]) upDays++;
    var rng = highs[j] - lows[j];
    if (rng > 0) closePosSum += (closes[j] - lows[j]) / rng;
    var g = opens[j] - closes[j - 1];
    gaps.push(g);
    if (g > 0) gapUp++; else if (g < 0) gapDn++;
  }
  var upRatio = upDays / 20;
  var closePos = closePosSum / 20;
  var avgGap = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
  var avgGapPct = avgGap / (closes[n - 21] || last) * 100;

  var v5 = smaLast(vols.slice(-15), 5);
  var vPrev = smaLast(vols.slice(-15, -5), 5);
  var volTrend = (v5 && vPrev) ? v5 / vPrev : 1;

  /* ---- 综合趋势打分 ---- */
  var ts = 0;
  if (ma5 > ma10 && ma10 > ma20) ts += 2; else if (ma5 > ma20) ts += 1;
  if (ma5 < ma10 && ma10 < ma20) ts -= 2; else if (ma5 < ma20) ts -= 1;
  if (last > ma20) ts += 0.5; else ts -= 0.5;
  if (macd.hist > 0) ts += 1; else if (macd.hist < 0) ts -= 1;
  if (macd.hist > macd.histPrev) ts += 0.4; else ts -= 0.4;
  if (rsi < 30) ts += 1; else if (rsi > 70) ts -= 1; else if (rsi < 45) ts -= 0.3; else if (rsi > 55) ts += 0.3;
  if (kdj.k > kdj.d) ts += 0.5; else ts -= 0.5;
  if (kdj.j > 100) ts -= 0.5; else if (kdj.j < 0) ts += 0.5;
  if (boll.upper != null && last > boll.upper) ts -= 0.5; else if (boll.lower != null && last < boll.lower) ts += 0.5;
  if (closePos > 0.6) ts += 0.5; else if (closePos < 0.4) ts -= 0.5;
  if (volTrend > 1.15) ts += 0.4; else if (volTrend < 0.85) ts -= 0.4;
  var ret10 = closes[n - 1] / closes[n - 11] - 1;
  if (ret10 > 0.05) ts += 0.5; else if (ret10 < -0.05) ts -= 0.5;
  /* 扩展指标 */
  if (obv5 != null && obvPrev != null) { if (obv5 > obvPrev) ts += 0.4; else ts -= 0.4; }
  if (adx > 25) { if (last > ma20) ts += 0.3; else ts -= 0.3; }
  if (cci != null && cci > 100) ts -= 0.3; else if (cci != null && cci < -100) ts += 0.3;
  if (ma60 != null) { if (last > ma60) ts += 0.4; else ts -= 0.4; }
  /* 大盘上下文 */
  if (idx && isFinite(idx.pct)) { if (idx.pct > 0.3) ts += 0.5; else if (idx.pct < -0.3) ts -= 0.5; }

  /* ---- 概率：滚动回测校准 ---- */
  var cal = calibrateProb(closes, highs, lows, vols, ts);
  var probUp = clamp(cal.prob, 0.08, 0.92);
  if (cal.sample < 8) probUp = clamp(probUp * 0.5 + (0.5 + ts * 0.05) * 0.5, 0.08, 0.92);

  var volUnit = Math.max(atr, stats.sd * last);
  var upK = 0.75, dnK = 0.75;
  if (probUp > 0.58) { upK = 0.95; dnK = 0.6; }
  else if (probUp < 0.42) { upK = 0.6; dnK = 0.95; }
  var nextHigh = last + volUnit * upK;
  var nextLow = Math.max(0, last - volUnit * dnK);

  var min20 = Math.min.apply(null, lows.slice(-20));
  var max20 = Math.max.apply(null, highs.slice(-20));
  var pivot = (highs[n - 2] + lows[n - 2] + closes[n - 2]) / 3;
  var supCands = [ma20, boll.lower, ma60, min20, pivot].filter(function (v) { return v != null && v < last; });
  var resCands = [ma20, boll.upper, ma60, max20, pivot].filter(function (v) { return v != null && v > last; });
  var support = supCands.length ? Math.max.apply(null, supCands) : Math.min.apply(null, [ma20, boll.lower, ma60, min20, pivot].filter(function (v) { return v != null; }));
  var resistance = resCands.length ? Math.min.apply(null, resCands) : Math.max.apply(null, [ma20, boll.upper, ma60, max20, pivot].filter(function (v) { return v != null; }));

  var dir = probUp >= 0.56 ? 'up' : (probUp <= 0.44 ? 'down' : 'flat');
  var gapTxt = gapUp / 20 >= 0.6 ? '高开倾向' : (gapDn / 20 >= 0.6 ? '低开倾向' : '平开倾向');
  var confidence = clamp(45 + Math.abs(ts) * 4 + Math.min(cal.sample, 30) / 30 * 6 + (n >= 120 ? 8 : (n >= 80 ? 4 : 0)) - (atrPct > 6 ? 8 : 0), 30, 90);

  return {
    mode: 'day', dir: dir,
    dirTxt: dir === 'up' ? '偏多' : (dir === 'down' ? '偏空' : '震荡'),
    probUp: r2(probUp), nextLow: r2(nextLow), nextHigh: r2(nextHigh),
    gapTxt: gapTxt, gapPct: r2(avgGapPct),
    support: r2(support), resistance: r2(resistance),
    confidence: Math.round(confidence), trendScore: r2(ts), closePos: r2(closePos), upRatio: r2(upRatio),
    ma5: r2(ma5), ma10: r2(ma10), ma20: r2(ma20), ma60: r2(ma60),
    rsi: r2(rsi), dif: r2(macd.dif), dea: r2(macd.dea), macdHist: r2(macd.hist),
    k: r2(kdj.k), d: r2(kdj.d), j: r2(kdj.j),
    bollMid: r2(boll.mid), bollUp: r2(boll.upper), bollLo: r2(boll.lower),
    atr: r2(atr), atrPct: r2(atrPct), volTrend: r2(volTrend),
    obv: r2(obv5), adx: Math.round(adx), cci: r2(cci),
    calSample: cal.sample,
    idxPct: (idx && isFinite(idx.pct)) ? r2(idx.pct) : null, idxName: idx ? idx.name : '',
    days: n, date: rows[n - 1][0]
  };
}
function predictDay(cfg, rows) {
  return fetchIndex(cfg.market).catch(function () { return null; })
    .then(function (idx) {
      var stats = computeDayStats(cfg, rows, idx);
      return new Promise(function (resolve) {
        updateTracking(rows, stats, function (t) {
          stats.hitRate = t.hitRate;
          stats.trackN = t.trackN;
          resolve(stats);
        });
      });
    });
}

/* ================= 预测：实时（分时K线 + 盘中量价） ================= */
function predictIntraday(cfg, quote, rows, recent) {
  return Promise.all([
    fetchMinute(cfg).catch(function () { return null; }),
    fetchIndex(cfg.market).catch(function () { return null; })
  ]).then(function (res) {
    var minute = res[0], idx = res[1];
    var prior = computeDayStats(cfg, rows, idx);
    var R = parseRows(rows);
    var price = +quote.price || R.last;
    var open = +quote.open || price;
    var high = +quote.high || price;
    var low = +quote.low || price;
    var prevClose = +quote.prevClose || R.closes[R.n - 2];
    var volHand = +quote.volHand || 0;
    var amtYuan = +quote.amtYuan || 0;

    /* 分时K线：精确 VWAP / 30分钟动量 / 日内高低 */
    var minuteVwap = null, mom30 = 0, mn = null, mx = null;
    if (minute && minute.pts && minute.pts.length > 5) {
      var pts = minute.pts;
      var sf = (cfg.market === 'hk' || cfg.market === 'us') ? 1 : 100;
      if (minute.cumAmt > 0 && minute.cumVol > 0) minuteVwap = minute.cumAmt / (minute.cumVol * sf);
      var i30 = Math.max(0, pts.length - 31);
      mom30 = (pts[pts.length - 1].p / pts[i30].p - 1) * 100;
      mn = pts[0].p; mx = pts[0].p;
      for (var i = 1; i < pts.length; i++) {
        if (pts[i].p < mn) mn = pts[i].p;
        if (pts[i].p > mx) mx = pts[i].p;
      }
    }
    var shares = (cfg.market === 'hk' || cfg.market === 'us') ? volHand : volHand * 100;
    var vwap = minuteVwap != null ? minuteVwap : ((shares > 0 && amtYuan > 0) ? amtYuan / shares : price);
    var aboveVwap = price >= vwap;

    var dayLow = mn != null ? mn : low;
    var dayHigh = mx != null ? mx : high;
    var dayRange = Math.max(dayHigh - dayLow, 0.0001);
    var closePosNow = clamp((price - dayLow) / dayRange, 0, 1);

    var mom = 0;
    if (mom30 !== 0) mom = mom30;
    else if (recent && recent.length >= 2) mom = (recent[recent.length - 1] / recent[0] - 1) * 100;
    else if (open > 0) mom = (price / open - 1) * 100;

    var clk = marketClock(cfg.market);
    var avgV5 = smaLast(R.vols.slice(-6), 5) || 1;
    var expectedVol = avgV5 * Math.max(clk.frac, 0.03);
    var volRatio = expectedVol > 0 ? volHand / expectedVol : 1;
    volRatio = clamp(volRatio, 0.1, 3.5);
    var volState = volRatio > 1.3 ? '放量' : (volRatio < 0.7 ? '缩量' : '平量');

    var atr = calcAtr(rows, 14);

    var posScore = (aboveVwap ? 1 : 0) + (closePosNow > 0.62 ? 1 : 0) + (mom > 0.15 ? 1 : 0) + (volRatio > 1.05 ? 1 : 0);
    var strength = clamp(50 + posScore * 9 + (price - vwap) / vwap * 100 * 6 + mom * 4 + (volRatio - 1) * 12 + (idx && isFinite(idx.pct) ? idx.pct * 4 : 0), 6, 94);
    var probUp = clamp(0.5 + (posScore - 2) * 0.12, 0.15, 0.85);
    probUp = clamp(probUp * 0.65 + (prior ? prior.probUp : 0.5) * 0.35, 0.1, 0.9); /* 融合次日预测先验 */
    if (idx && isFinite(idx.pct)) probUp = clamp(probUp + idx.pct * 0.004, 0.1, 0.9);

    var timeLeft = clamp(1 - clk.frac, 0.02, 1);
    var minRange = mx != null ? mx - mn : dayRange;
    var swing = Math.max(atr * 0.55 * Math.sqrt(timeLeft), minRange * 0.35 * timeLeft, dayRange * 0.2 * timeLeft);
    var hiK = probUp >= 0.5 ? 1.1 : 0.85, loK = probUp >= 0.5 ? 0.85 : 1.1;
    var intraHigh = Math.max(dayHigh, price + swing * hiK);
    var intraLow = Math.min(dayLow, Math.max(0, price - swing * loK));

    var dir = probUp >= 0.56 ? 'up' : (probUp <= 0.44 ? 'down' : 'flat');
    return {
      mode: 'intraday',
      dir: dir,
      dirTxt: dir === 'up' ? '实时偏强' : (dir === 'down' ? '实时偏弱' : '实时震荡'),
      probUp: r2(probUp),
      intraHigh: r2(intraHigh), intraLow: r2(intraLow),
      vwap: r2(vwap), vsVwap: r2((price - vwap) / vwap * 100),
      mom: r2(mom), volRatio: r2(volRatio), volState: volState,
      strength: Math.round(strength), closePos: r2(closePosNow),
      dayLow: r2(dayLow), prevClose: r2(prevClose), ma5: prior ? prior.ma5 : null,
      timeLeft: r2(timeLeft), live: !!clk.live,
      idxPct: (idx && isFinite(idx.pct)) ? r2(idx.pct) : null, idxName: idx ? idx.name : '',
      priorProb: prior ? prior.probUp : null,
      days: R.n
    };
  });
}

/* ================= 主力资金流 / 龙虎榜（东方财富，仅A股） ================= */
var FLOW_API = 'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get';
var LHB_API = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
var FLOW_CACHE = {}, FLOW_TTL = 5 * 60 * 1000;
var LHB_CACHE = {}, LHB_TTL = 30 * 60 * 1000;
function isAShare(cfg) { return cfg.market === 'sh' || cfg.market === 'sz' || cfg.market === 'bj'; }

function fetchFlowRaw(cfg, lmt) {
  var secid = emSecid(cfg);
  if (!secid) return Promise.reject(new Error('unsupported'));
  var url = FLOW_API + '?lmt=' + lmt + '&klt=101&secid=' + secid +
    '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63&_=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var klines = j && j.data && Array.isArray(j.data.klines) ? j.data.klines : [];
      if (!klines.length) throw new Error('no flow');
      return klines.map(function (s) {
        var f = String(s).split(',');
        return {
          date: f[0] || '',
          mainNet: +f[1], smallNet: +f[2], midNet: +f[3], bigNet: +f[4], superNet: +f[5],
          mainPct: +f[6], close: +f[11], chgPct: +f[12]
        };
      });
    });
}
function computeFlowSignal(list) {
  if (!list || !list.length) return null;
  var today = list[list.length - 1];
  var sum5 = 0;
  for (var i = Math.max(0, list.length - 5); i < list.length; i++) sum5 += list[i].mainNet;
  var streak = 0;
  for (var i = list.length - 1; i >= 0; i--) { if (list[i].mainNet > 0) streak++; else break; }
  var streakTxt;
  if (streak >= 3) streakTxt = '连续流入' + streak + '日';
  else if (streak >= 1) streakTxt = '流入' + streak + '日';
  else {
    var dn = 0;
    for (var i = list.length - 1; i >= 0; i--) { if (list[i].mainNet < 0) dn++; else break; }
    streakTxt = dn >= 3 ? '连续流出' + dn + '日' : (dn >= 1 ? '流出' + dn + '日' : '中性');
  }
  var level = '中性';
  if (today.mainNet > 0 && today.mainPct > 3) level = '强流入';
  else if (today.mainNet > 0) level = '流入';
  else if (today.mainNet < 0 && today.mainPct < -3) level = '强流出';
  else if (today.mainNet < 0) level = '流出';
  return { today: today, sum5: sum5, streak: streakTxt, level: level };
}
function fetchLhb(cfg, force) {
  var key = cfg.market + cfg.code;
  var c = LHB_CACHE[key];
  if (!force && c && Date.now() - c.t < LHB_TTL) return Promise.resolve(c.data);
  var url = LHB_API + '?reportName=RPT_DAILYBILLBOARD_DETAILSNEW' +
    '&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,EXPLANATION,CHANGE_RATE,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT' +
    '&filter=' + encodeURIComponent('(SECURITY_CODE="' + cfg.code + '")') +
    '&pageSize=5&sortColumns=TRADE_DATE&sortTypes=-1&source=WEB&client=WEB&_=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var rows = (j && j.result && Array.isArray(j.result.data)) ? j.result.data : [];
      var data = rows.map(function (it) {
        return {
          date: String(it.TRADE_DATE || '').slice(0, 10),
          reason: it.EXPLANATION || '',
          netAmt: +it.BILLBOARD_NET_AMT || 0,
          buyAmt: +it.BILLBOARD_BUY_AMT || 0,
          sellAmt: +it.BILLBOARD_SELL_AMT || 0,
          chgPct: +it.CHANGE_RATE || null
        };
      });
      LHB_CACHE[key] = { t: Date.now(), data: data };
      return data;
    });
}
function flowPayload(cfg, force) {
  if (!isAShare(cfg)) return Promise.reject(new Error('仅支持A股'));
  var key = cfg.market + ':' + cfg.code;
  var c = FLOW_CACHE[key];
  var p1 = (!force && c && Date.now() - c.t < FLOW_TTL)
    ? Promise.resolve(c.list)
    : fetchFlowRaw(cfg, 10).then(function (list) { FLOW_CACHE[key] = { t: Date.now(), list: list }; return list; });
  var p2 = fetchLhb(cfg, force);
  return Promise.all([p1.catch(function () { return []; }), p2.catch(function () { return []; })])
    .then(function (res) {
      var list = res[0], lhb = res[1];
      return { flow: list.length ? computeFlowSignal(list) : null, lhb: lhb };
    });
}

/* ================= 资讯：热榜抓取 + 情绪分析 ================= */
var POS_WORDS = ['涨停', '大涨', '暴涨', '新高', '创新高', '利好', '增持', '回购', '中标', '超预期', '扭亏', '预增', '增长', '突破', '回暖', '复苏', '上调', '买入', '推荐', '加仓', '分红', '送转', '签约', '合作', '获批', '业绩大增', '翻倍', '龙头', '订单'];
var NEG_WORDS = ['跌停', '大跌', '暴跌', '新低', '创新低', '利空', '减持', '亏损', '预减', '违规', '立案', '退市', '处罚', '调查', '下调', '卖出', '看空', '暴雷', '爆雷', '减值', '违约', '冻结', '爆仓', '警示', '问询', '亏损扩大', '腰斩', '套现', '失败'];
var NEWS_CACHE = {};
var NEWS_TTL = 10 * 60 * 1000;

function newsMatch(title, name, code) {
  if (!title) return false;
  if (title.indexOf(name) >= 0) return true;
  if (name.length >= 2 && name !== title && title.indexOf(name) >= 0) return true;
  var skip = ['股票', '股市', '板块', '行情', '财经', '大盘', 'A股', '指数', '概念股'];
  if (name.indexOf(title) >= 0 && title.length >= 2 && skip.indexOf(title) < 0) return true;
  if (code && title.indexOf(code) >= 0) return true;
  return false;
}
function scoreSentiment(title) {
  var pos = 0, neg = 0;
  for (var i = 0; i < POS_WORDS.length; i++) if (title.indexOf(POS_WORDS[i]) >= 0) pos++;
  for (var j = 0; j < NEG_WORDS.length; j++) if (title.indexOf(NEG_WORDS[j]) >= 0) neg++;
  return { pos: pos, neg: neg, tag: pos > neg ? 'pos' : (neg > pos ? 'neg' : 'neu'), score: pos - neg };
}
function fetchMoyu(platform) {
  return fetch('https://moyuhot.com/api/trends?platform=' + encodeURIComponent(platform), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      return (j && Array.isArray(j.items) ? j.items : []).map(function (it) {
        return { title: it.title || '', url: it.url || '', platform: (it.platformName || it.platform || '热榜') };
      });
    });
}
function fetchNow(platform) {
  return fetch('https://api.nowhots.com/' + encodeURIComponent(platform), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      return (j && j.code === 200 && Array.isArray(j.data) ? j.data : []).map(function (it) {
        return { title: it.title || '', url: it.url || '', platform: platform };
      });
    });
}
function fetchHotNews(cfg, force) {
  var key = cfg.market + ':' + cfg.code;
  var cached = NEWS_CACHE[key];
  if (!force && cached && Date.now() - cached.t < NEWS_TTL) return Promise.resolve(cached.data);
  var name = cfg.name || '';
  var code = String(cfg.code || '');
  var sources = [
    fetchMoyu('xueqiu'), fetchMoyu('weibo'), fetchMoyu('baidu'),
    fetchNow('weibo'), fetchNow('baidu')
  ];
  return Promise.all(sources.map(function (p) { return p.catch(function () { return []; }); }))
    .then(function (lists) {
      var seen = {}, items = [];
      lists.forEach(function (list) {
        list.forEach(function (it) {
          if (!newsMatch(it.title, name, code)) return;
          var s = scoreSentiment(it.title);
          if (seen[it.title]) return;
          seen[it.title] = 1;
          items.push({
            title: it.title, url: it.url, platform: it.platform,
            tag: s.tag, score: s.score
          });
        });
      });
      items.sort(function (a, b) { return Math.abs(b.score) - Math.abs(a.score) || b.title.length - a.title.length; });
      items = items.slice(0, 6);
      var pos = items.filter(function (x) { return x.tag === 'pos'; }).length;
      var neg = items.filter(function (x) { return x.tag === 'neg'; }).length;
      var neu = items.length - pos - neg;
      var sentiment = pos > neg ? 'pos' : (neg > pos ? 'neg' : 'neu');
      var data = {
        total: items.length, items: items,
        pos: pos, neg: neg, neu: neu, sentiment: sentiment,
        heat: items.length >= 3 ? 'high' : (items.length > 0 ? 'mid' : 'none'),
        at: Date.now()
      };
      NEWS_CACHE[key] = { t: Date.now(), data: data };
      return data;
    });
}
