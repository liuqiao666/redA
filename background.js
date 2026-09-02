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
    floatCap: null, totalCap: null, lu: null, ld: null,
    bid5: [], ask5: []
  };
  /* 五档盘口：买一~买五 f[9]~f[18]，卖一~卖五 f[19]~f[28]（价、量成对出现） */
  if (isFinite(+p[9]) && +p[9] > 0) {
    for (var i = 0; i < 5; i++) {
      d.bid5.push({ p: +p[9 + i * 2], v: +p[10 + i * 2] });
      d.ask5.push({ p: +p[19 + i * 2], v: +p[20 + i * 2] });
    }
  }
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

/* ================= 盘口：大盘指数 + 相关板块 ================= */
var IDX_MAP = {
  sh: ['sh000001', 'sz399001', 'sz399006'],
  sz: ['sh000001', 'sz399001', 'sz399006'],
  bj: ['sh000001', 'sz399001', 'sz399006'],
  hk: ['hkHSI', 'hkHSTECH'],
  us: ['usDJI', 'usIXIC', 'usINX'],
  sg: []
};
function fetchIndices(market) {
  var codes = IDX_MAP[market];
  if (!codes || !codes.length) return Promise.resolve([]);
  var url = 'https://qt.gtimg.cn/q=' + codes.join(',') + '&_=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.arrayBuffer(); })
    .then(function (buf) {
      /* 腾讯接口返回 GBK，需显式解码，否则指数名称乱码 */
      var txt = new TextDecoder('gbk').decode(buf);
      var out = [];
      txt.replace(/v_(\w+)="([^"]*)"/g, function (all, code, data) {
        var f = data.split('~');
        if (f.length > 32 && isFinite(+f[3])) {
          out.push({ name: f[1], price: +f[3], pct: +f[32] });
        }
        return all;
      });
      return out;
    });
}
var BOARD_CACHE = {};
var BOARD_TTL = 60 * 1000;
function fetchBoards(cfg) {
  if (cfg.market !== 'sh' && cfg.market !== 'sz') return Promise.resolve([]);
  var key = cfg.market + ':' + cfg.code;
  var c = BOARD_CACHE[key];
  if (c && Date.now() - c.t < BOARD_TTL) return Promise.resolve(c.list);
  var secu = cfg.code + (cfg.market === 'sh' ? '.SH' : '.SZ');
  var url = 'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    '?reportName=RPT_F10_CORETHEME_BOARDTYPE&columns=NEW_BOARD_CODE,BOARD_NAME,BOARD_TYPE' +
    '&filter=' + encodeURIComponent('(SECUCODE="' + secu + '")') + '&pageSize=40&_=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var rows = (j && j.result && Array.isArray(j.result.data)) ? j.result.data : [];
      var boards = [];
      rows.forEach(function (it) {
        var t = String(it.BOARD_TYPE || '');
        if ((t === '行业' || t === '概念') && boards.length < 4 && it.NEW_BOARD_CODE) {
          boards.push({ code: String(it.NEW_BOARD_CODE), name: String(it.BOARD_NAME || '') });
        }
      });
      if (!boards.length) return [];
      var secids = boards.map(function (b) { return '90.' + b.code; }).join(',');
      return fetch('https://push2.eastmoney.com/api/qt/ulist.np/get?secids=' + secids +
        '&fltt=2&invt=2&fields=f2,f3,f12,f14&_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (q) {
          var diff = (q && q.data && Array.isArray(q.data.diff)) ? q.data.diff : [];
          var map = {};
          diff.forEach(function (d) { map[d.f12] = { name: d.f14, price: d.f2, pct: d.f3 }; });
          return boards.map(function (b) {
            var v = map[b.code];
            return v ? { name: v.name, price: v.price, pct: v.pct } : null;
          }).filter(function (x) { return x; });
        });
    })
    .then(function (list) {
      BOARD_CACHE[key] = { t: Date.now(), list: list };
      return list;
    })
    .catch(function () { return []; });
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
  if (msg.type === 'chart') {
    var ccfg = msg.cfg;
    var period = msg.period || 'day';
    if (!ccfg || !ccfg.market || !ccfg.code) {
      sendResponse({ ok: false, error: 'missing cfg' });
      return true;
    }
    fetchChart(ccfg, period)
      .then(function (rows) { sendResponse({ ok: true, data: rows, period: period }); })
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
  if (msg.type === 'quant') {
    var qcfg = msg.cfg;
    if (!qcfg || !qcfg.market || !qcfg.code) {
      sendResponse({ ok: false, error: 'missing cfg' });
      return true;
    }
    quantPayload(qcfg, msg.quote || {}, msg.recent || [])
      .then(function (d) { sendResponse({ ok: true, data: d }); })
      .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
    return true;
  }
  if (msg.type === 'board') {
    var bcfg = msg.cfg;
    if (!bcfg || !bcfg.market || !bcfg.code) {
      sendResponse({ ok: false, error: 'missing cfg' });
      return true;
    }
    Promise.all([
      fetchIndices(bcfg.market).catch(function () { return []; }),
      fetchBoards(bcfg).catch(function () { return []; })
    ]).then(function (res) {
      sendResponse({ ok: true, indices: res[0], boards: res[1] });
    });
    return true;
  }
  if (msg.type === 'holdings') {
    fetchHoldings()
      .then(function (d) { sendResponse({ ok: true, items: d.items, sum: d.sum, t: Date.now() }); })
      .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
    return true;
  }
  if (msg.type === 'openOptions') {
    try { chrome.runtime.openOptionsPage(); } catch (e) { }
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'larkTest') {
    loadAlertCfg(function (cfg) {
      if (!cfg.larkUrl) {
        sendResponse({ ok: false, error: '未配置飞书 Webhook 地址' });
        return;
      }
      var card = buildLarkCard(
        { market: 'sh', code: '000001', name: '测试股票' },
        { price: 10.25, pct: 3.5 },
        1.9, 'upVol',
        { nextLow: 10.10, nextHigh: 10.60, probUp: 0.68 },
        '实时股价悬浮球 · 异动提醒测试消息\n（信号命中时将自动推送，冷却 ' + cfg.cd + ' 分钟）'
      );
      pushLark(cfg.larkUrl, card)
        .then(function () { sendResponse({ ok: true }); })
        .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
    });
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

/* 历史K线：支持分时、日、月、年，统一返回 [时间,开,收,高,低,量] */
var CHART_CACHE = {};
var CHART_TTL = 60 * 1000;
function chartKlt(period) {
  return { day: 101, month: 103, year: 105 }[period] || 101;
}
function normalizeChartRows(rows, period) {
  return rows.map(function (row) {
    var f = Array.isArray(row) ? row : String(row).split(',');
    return { t: String(f[0] || ''), o: +f[1], c: +f[2], h: +f[3], l: +f[4], v: +f[5] };
  }).filter(function (x) {
    return x.t && isFinite(x.o) && isFinite(x.c) && isFinite(x.h) && isFinite(x.l);
  });
}
function fetchChart(cfg, period) {
  var q = txQueryCode(cfg), key = q + ':' + period;
  var cached = CHART_CACHE[key];
  if (cached && Date.now() - cached.t < CHART_TTL) return Promise.resolve(cached.rows);
  var url;
  if (period === 'intra') {
    url = EM_TREND_API + '?secid=' + emSecid(cfg) +
      '&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f53,f56,f58&ndays=1&iscr=0&_=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var trends = j && j.data && Array.isArray(j.data.trends) ? j.data.trends : [];
      var rows = trends.map(function (s, i) {
        var f = String(s).split(','), p = +f[1], prev = i ? +String(trends[i - 1]).split(',')[1] : p;
        return { t: f[0], o: prev, c: p, h: Math.max(prev, p), l: Math.min(prev, p), v: +f[2] || 0 };
      }).filter(function (x) { return isFinite(x.c) && x.c > 0; });
      if (rows.length < 2) throw new Error('chart intraday unavailable');
      CHART_CACHE[key] = { t: Date.now(), rows: rows };
      return rows;
    });
  }
  var secid = emSecid(cfg);
  if (!secid) return Promise.reject(new Error('chart unsupported market'));
  url = EM_KLINE_API + '?secid=' + secid + '&fields1=f1,f2,f3,f4,f5,f6' +
    '&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=' + chartKlt(period) +
    '&fqt=1&end=20500101&lmt=260&_=' + Date.now();
  return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
    var kl = j && j.data && Array.isArray(j.data.klines) ? j.data.klines : [];
    var rows = normalizeChartRows(kl, period);
    if (rows.length < 2) throw new Error('chart kline unavailable');
    CHART_CACHE[key] = { t: Date.now(), rows: rows };
    return rows;
  });
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
    rsi: r2(rsi), dif: r2(macd.dif), dea: r2(macd.dea), macdHist: r2(macd.hist), macdHistPrev: r2(macd.histPrev),
    k: r2(kdj.k), d: r2(kdj.d), j: r2(kdj.j),
    bollMid: r2(boll.mid), bollUp: r2(boll.upper), bollLo: r2(boll.lower),
    atr: r2(atr), atrPct: r2(atrPct), volTrend: r2(volTrend),
    obv: r2(obv5), adx: Math.round(adx), cci: r2(cci),
    mom5: r2(n >= 6 ? (closes[n - 1] / closes[n - 6] - 1) * 100 : null),
    mom20: r2(n >= 21 ? (closes[n - 1] / closes[n - 21] - 1) * 100 : null),
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
function fmtToday() {
  var d = new Date();
  return d.getFullYear() + '-' +
    (d.getMonth() + 1 < 10 ? '0' + (d.getMonth() + 1) : (d.getMonth() + 1)) + '-' +
    (d.getDate() < 10 ? '0' + d.getDate() : d.getDate());
}
var EM_FLOW_ULIST = 'https://push2his.eastmoney.com/api/qt/ulist.np/get';
/* 盘中实时资金：ulist 接口（f62 主力净流入 / f66 超大单 / f72 大单 / f78 中单 / f84 小单 / f184 主力占比），
 * 日K资金接口盘中无当日数据，必须用实时字段 */
function fetchFlowIntraday(cfg) {
  var secid = emSecid(cfg);
  if (!secid) return Promise.reject(new Error('unsupported'));
  var url = EM_FLOW_ULIST + '?secids=' + secid +
    '&fltt=2&invt=2&fields=f2,f3,f12,f14,f62,f66,f72,f78,f84,f184&_=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (json) {
      var diff = (json && json.data && Array.isArray(json.data.diff)) ? json.data.diff : [];
      var d = diff[0];
      if (!d || d.f62 == null || !isFinite(+d.f62)) throw new Error('no intraday flow');
      function n(v) { return isFinite(+v) ? +v : null; }
      return {
        date: fmtToday(),
        mainNet: n(d.f62), smallNet: n(d.f84), midNet: n(d.f78),
        bigNet: n(d.f72), superNet: n(d.f66), mainPct: n(d.f184), chgPct: n(d.f3)
      };
    });
}
function computeFlowSignal(list, intra) {
  if (!list || !list.length) return null;
  /* 今日优先用盘中实时资金；历史日K可能不含今日 */
  var today = intra || list[list.length - 1];
  var todayStr = fmtToday();
  var hist = list.filter(function (x) { return x.date < todayStr; }).slice(-4);
  var sum5 = today.mainNet + hist.reduce(function (s, x) { return s + x.mainNet; }, 0);
  var seq = [today.mainNet];
  for (var i = list.length - 1; i >= 0; i--) seq.push(list[i].mainNet);
  var sign = seq[0] >= 0 ? 1 : -1, streak = 0;
  for (var k = 0; k < seq.length; k++) {
    if ((seq[k] >= 0 ? 1 : -1) === sign) streak++; else break;
  }
  var streakTxt;
  if (streak >= 3) streakTxt = (sign > 0 ? '连续流入' : '连续流出') + streak + '日';
  else if (streak >= 1) streakTxt = (sign > 0 ? '流入' : '流出') + streak + '日';
  else streakTxt = '中性';
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
  var p0 = fetchFlowIntraday(cfg).catch(function () { return null; }); /* 盘中实时资金，失败降级日K */
  var p2 = fetchLhb(cfg, force);
  return Promise.all([p1.catch(function () { return []; }), p0, p2.catch(function () { return []; })])
    .then(function (res) {
      var list = res[0], intra = res[1], lhb = res[2];
      return { flow: list.length ? computeFlowSignal(list, intra) : null, lhb: lhb };
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
/* 东方财富新闻搜索：按个股关键词返回真实资讯（标题/来源/时间/摘要/链接） */
var EM_NEWS_SEARCH = 'https://search-api-web.eastmoney.com/search/jsonp';
function fetchEMNews(keyword, size) {
  var param = {
    uid: '', keyword: keyword, type: ['cmsArticleWebOld'],
    client: 'web', clientType: 'web', clientVersion: 'curr',
    param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: size || 8, preTag: '', postTag: '' } }
  };
  var url = EM_NEWS_SEARCH + '?cb=cb&param=' + encodeURIComponent(JSON.stringify(param));
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.text(); })
    .then(function (txt) {
      var i = txt.indexOf('('), j = txt.lastIndexOf(')');
      if (i < 0 || j <= i) return [];
      var json = JSON.parse(txt.slice(i + 1, j));
      var list = (json && json.result && Array.isArray(json.result.cmsArticleWebOld)) ? json.result.cmsArticleWebOld : [];
      return list.map(function (it) {
        return {
          title: String(it.title || '').replace(/<\/?em>/g, ''),
          url: it.url || '',
          platform: it.mediaName || '东方财富',
          date: it.date || '',
          summary: String(it.content || '').replace(/<\/?em>/g, '')
        };
      }).filter(function (x) { return x.title; });
    });
}
/* 新浪财经 7x24 快讯：全市场滚动快讯，按个股关键词过滤 */
var SINA_LIVE = 'https://zhibo.sina.com.cn/api/zhibo/feed';
function fetchSinaLive(keyword, size) {
  var url = SINA_LIVE + '?page=1&page_size=' + (size || 40) +
    '&zhibo_id=152&tag_id=0&dire=f&dpc=1&_=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var items = (j && j.result && j.result.data && j.result.data.feed && Array.isArray(j.result.data.feed.list))
        ? j.result.data.feed.list : [];
      return items.map(function (it) {
        var txt = String(it.rich_text || '').trim();
        var title = txt;
        if (txt.charAt(0) === '【') {
          var e = txt.indexOf('】');
          if (e > 0) title = txt.slice(0, e + 1);
        }
        return { title: title, url: it.docurl || '', platform: '新浪7x24', date: it.create_time || '', summary: txt };
      }).filter(function (x) { return x.title; });
    });
}
function fetchHotNews(cfg, force) {
  var key = cfg.market + ':' + cfg.code;
  var cached = NEWS_CACHE[key];
  if (!force && cached && Date.now() - cached.t < NEWS_TTL) return Promise.resolve(cached.data);
  var name = cfg.name || '';
  var code = String(cfg.code || '');
  var hotSources = [
    fetchMoyu('xueqiu'), fetchMoyu('weibo'), fetchMoyu('baidu'),
    fetchNow('weibo'), fetchNow('baidu')
  ];
  var emNews = name ? fetchEMNews(name, 8) : Promise.resolve([]);
  var sina = name ? fetchSinaLive(name, 40).then(function (list) {
    return list.filter(function (it) { return newsMatch(it.title + it.summary, name, code); });
  }) : Promise.resolve([]);
  return Promise.all([
    Promise.all(hotSources.map(function (p) { return p.catch(function () { return []; }); })),
    emNews.catch(function () { return []; }),
    sina.catch(function () { return []; })
  ])
    .then(function (res) {
      var hotLists = res[0], emList = res[1], sinaList = res[2];
      var seen = {}, items = [];
      function push(title, url, platform, date, tagScore) {
        if (!title || seen[title]) return;
        seen[title] = 1;
        var s = tagScore || scoreSentiment(title);
        items.push({ title: title, url: url || '', platform: platform || '资讯', date: date || '', tag: s.tag, score: s.score });
      }
      hotLists.forEach(function (list) {
        list.forEach(function (it) {
          if (!newsMatch(it.title, name, code)) return;
          push(it.title, it.url, it.platform, '');
        });
      });
      /* 东财文章已按关键词检索，直接采用；标题+摘要做情绪分 */
      emList.forEach(function (it) {
        push(it.title, it.url, it.platform, it.date, scoreSentiment(it.title + ' ' + (it.summary || '')));
      });
      sinaList.forEach(function (it) {
        push(it.title, it.url, it.platform, it.date);
      });
      items.sort(function (a, b) {
        var sa = Math.abs(a.score), sb = Math.abs(b.score);
        if (sa !== sb) return sb - sa;
        var da = a.date ? new Date(a.date.replace(/-/g, '/')).getTime() : 0;
        var db = b.date ? new Date(b.date.replace(/-/g, '/')).getTime() : 0;
        return db - da;
      });
      items = items.slice(0, 8);
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

/* ================= 量化综合评分引擎 v2 =================
 * 结构：子信号 → 五因子 → 加权 → 0-100 综合分，另输出可读信号与风险提示。
 * 因子输出 0~1，乘以 100 后展示为 0~100 分项；权重可在设置页 chhQuant 调整。
 * 改进点：趋势分解为均线/MACD/RSI/KDJ/ADX 子信号；资金纳入 5 日累计/连续流向/龙虎榜；
 * 量价纳入 VWAP/动量/量比/日内位置；估值用对数平滑代替硬分档；
 * 新增 signals（可读信号）与 warnings（风险提示）供前端展示。仅供技术参考，不构成投资建议。 */
var QUANT_DEFAULTS = { on: true, wTrend: 30, wFund: 30, wVol: 20, wNews: 10, wValue: 10 };
function loadQuantCfg(cb) {
  chrome.storage.local.get('chhQuant', function (o) {
    cb(Object.assign({}, QUANT_DEFAULTS, (o && o.chhQuant) || {}));
  });
}
function saveQuantCfg(cfg, cb) {
  chrome.storage.local.set({ chhQuant: cfg }, cb || function () {});
}
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
/* ---- 趋势因子：分解子信号 ----
 * 均线排列(0.25) + MACD(0.20) + RSI(0.15) + KDJ(0.10) + 价格vs均线(0.20) + ADX趋势确认(0.10) */
function trendFactor(stats, signals) {
  if (!stats) return 0.5;
  var sc = [], s = 0;
  /* 均线排列 */
  if (stats.ma5 != null && stats.ma10 != null && stats.ma20 != null) {
    if (stats.ma5 > stats.ma10 && stats.ma10 > stats.ma20) { sc.push(1); if (signals) signals.push('均线多头排列（MA5>MA10>MA20）'); }
    else if (stats.ma5 < stats.ma10 && stats.ma10 < stats.ma20) { sc.push(0); if (signals) signals.push('均线空头排列（MA5<MA10<MA20）'); }
    else if (stats.ma5 > stats.ma20) sc.push(0.66);
    else sc.push(0.33);
  } else sc.push(0.5);
  /* MACD */
  if (stats.macdHist != null && stats.dif != null && stats.dea != null) {
    if (stats.macdHist > 0 && stats.macdHist > (stats.macdHistPrev || 0)) { sc.push(1); if (signals) signals.push('MACD 红柱放大'); }
    else if (stats.macdHist > 0) { sc.push(0.75); if (signals) signals.push('MACD 红柱（零轴上方）'); }
    else if (stats.macdHist < 0 && stats.macdHist < (stats.macdHistPrev || 0)) { sc.push(0); if (signals) signals.push('MACD 绿柱扩大'); }
    else if (stats.macdHist < 0) { sc.push(0.25); if (signals) signals.push('MACD 绿柱（零轴下方）'); }
    else sc.push(0.5);
  } else sc.push(0.5);
  /* RSI：40~65 健康多头区，>75 超买降分，<35 超卖不视为趋势强 */
  if (stats.rsi != null) {
    if (stats.rsi >= 50 && stats.rsi <= 65) { sc.push(0.85); if (signals) signals.push('RSI ' + Math.round(stats.rsi) + '（健康多头区）'); }
    else if (stats.rsi >= 40 && stats.rsi < 50) sc.push(0.45);
    else if (stats.rsi > 65 && stats.rsi <= 75) sc.push(0.55);
    else if (stats.rsi > 75) { sc.push(0.25); if (signals) signals.push('RSI ' + Math.round(stats.rsi) + ' 超买，注意回调风险'); }
    else if (stats.rsi >= 35 && stats.rsi < 40) sc.push(0.35);
    else sc.push(0.3);
  } else sc.push(0.5);
  /* KDJ */
  if (stats.k != null && stats.d != null) {
    if (stats.k > stats.d && stats.j != null && stats.j < 100) { sc.push(0.75); if (signals) signals.push('KDJ 金叉（K 上穿 D）'); }
    else if (stats.k > stats.d) sc.push(0.65);
    else if (stats.k < stats.d) sc.push(0.35);
    else sc.push(0.5);
  } else sc.push(0.5);
  /* 价格 vs MA20 / MA60 */
  if (stats.last != null && stats.ma20 != null) {
    if (stats.last > stats.ma20) { sc.push(0.8); }
    else sc.push(0.2);
  } else sc.push(0.5);
  if (stats.ma60 != null && stats.last != null) {
    if (stats.last > stats.ma60) sc.push(0.8); else sc.push(0.2);
  } else sc.push(0.5);
  /* ADX：>25 有趋势，>30 强趋势 */
  if (stats.adx != null) {
    if (stats.adx >= 30) { sc.push(0.9); if (signals) signals.push('ADX ' + stats.adx + ' 趋势强劲'); }
    else if (stats.adx >= 25) sc.push(0.7);
    else if (stats.adx >= 20) sc.push(0.5);
    else sc.push(0.3);
  } else sc.push(0.5);
  for (var i = 0; i < sc.length; i++) s += sc[i];
  return clamp01(s / sc.length);
}
/* ---- 资金因子：今日占比(0.4) + 5日累计(0.25) + 连续流向(0.2) + 龙虎榜(0.15) ---- */
function fundFactor(flow, lhb, signals) {
  if (!flow) return 0.5;
  var sc = [];
  var pct = (flow.mainPct != null && isFinite(flow.mainPct)) ? flow.mainPct : 0;
  sc.push(clamp01(0.5 + pct / 10));
  if (pct >= 3 && signals) signals.push('今日主力净流入占比 +' + pct.toFixed(1) + '%');
  else if (pct <= -3 && signals) signals.push('今日主力净流出占比 ' + pct.toFixed(1) + '%');
  /* 5 日累计：方向分 + 规模分（5 亿封顶），各占一半 */
  if (flow.sum5 != null && isFinite(flow.sum5)) {
    var dir5 = flow.sum5 > 0 ? 1 : (flow.sum5 < 0 ? 0 : 0.5);
    var mag5 = clamp01(Math.abs(flow.sum5) / 5e8);
    sc.push(0.5 + (dir5 - 0.5) * (0.4 + 0.6 * mag5));
  } else sc.push(0.5);
  /* 连续流向 */
  var streak = flow.streak || '';
  var m = String(streak).match(/(\d+)/);
  var days = m ? parseInt(m[1], 10) : 0;
  var inflow = String(streak).indexOf('流入') >= 0;
  if (days >= 3) {
    sc.push(inflow ? 0.9 : 0.1);
    if (signals) signals.push('主力连续 ' + days + ' 日' + (inflow ? '净流入' : '净流出'));
  } else if (days >= 1) sc.push(inflow ? 0.65 : 0.35);
  else sc.push(0.5);
  /* 龙虎榜（机构/北向净买入） */
  if (lhb && lhb.length && lhb[0] && lhb[0].netAmt != null) {
    var r = lhb[0];
    if (r.netAmt > 0) { sc.push(0.75); if (signals) signals.push('龙虎榜净买入 ' + fmtWanAmt(r.netAmt)); }
    else if (r.netAmt < 0) { sc.push(0.25); if (signals) signals.push('龙虎榜净卖出 ' + fmtWanAmt(r.netAmt)); }
    else sc.push(0.5);
  } else sc.push(0.5);
  var s = 0;
  s += sc[0] * 0.4; s += sc[1] * 0.25; s += sc[2] * 0.2; s += sc[3] * 0.15;
  return clamp01(s);
}
/* ---- 量价因子：VWAP(0.3) + 动量(0.25) + 量比(0.25) + 日内位置(0.2) ---- */
function volFactor(intra, signals) {
  if (!intra) return 0.5;
  var sc = [];
  /* 现价 vs VWAP */
  if (intra.vsVwap != null && isFinite(intra.vsVwap)) {
    sc.push(clamp01(0.5 + intra.vsVwap / 2));
    if (intra.vsVwap > 0.5 && signals) signals.push('现价高于均价 ' + intra.vsVwap.toFixed(2) + '%');
    else if (intra.vsVwap < -0.5 && signals) signals.push('现价低于均价 ' + intra.vsVwap.toFixed(2) + '%');
  } else sc.push(0.5);
  /* 30 分钟动量 */
  if (intra.mom != null && isFinite(intra.mom)) {
    sc.push(clamp01(0.5 + intra.mom / 2));
    if (intra.mom > 1 && signals) signals.push('30分钟动量 +' + intra.mom.toFixed(2) + '%（资金抢筹）');
    else if (intra.mom < -1 && signals) signals.push('30分钟动量 ' + intra.mom.toFixed(2) + '%（资金撤离）');
  } else sc.push(0.5);
  /* 量比：温和放量 1.2~2 最佳，缩量与过热放量都降分 */
  if (intra.volRatio != null && isFinite(intra.volRatio)) {
    var vr = intra.volRatio;
    if (vr >= 1.2 && vr <= 2.0) { sc.push(0.85); if (signals) signals.push('量比 ' + vr.toFixed(2) + ' 温和放量'); }
    else if (vr > 2.0 && vr <= 3.5) { sc.push(0.65); if (signals) signals.push('量比 ' + vr.toFixed(2) + ' 明显放量'); }
    else if (vr > 3.5) { sc.push(0.35); if (signals) signals.push('量比 ' + vr.toFixed(2) + ' 过热，警惕分歧'); }
    else if (vr >= 0.7 && vr <= 1.2) sc.push(0.5);
    else { sc.push(0.3); if (signals) signals.push('量比 ' + vr.toFixed(2) + ' 缩量'); }
  } else sc.push(0.5);
  /* 日内位置 */
  if (intra.closePos != null && isFinite(intra.closePos)) {
    sc.push(clamp01(intra.closePos));
  } else sc.push(0.5);
  var s = 0;
  s += sc[0] * 0.3; s += sc[1] * 0.25; s += sc[2] * 0.25; s += sc[3] * 0.2;
  return clamp01(s);
}
/* ---- 情绪因子：正负差(0.7) + 热度(0.3) ---- */
function newsFactor(news, signals) {
  if (!news || !news.total) return 0.5;
  var sc = [];
  var diff = news.pos - news.neg;
  if (news.total < 3) sc.push(0.5);
  else sc.push(clamp01(0.5 + 0.5 * diff / news.total));
  if (news.total >= 5 && diff >= 2 && signals) signals.push('资讯偏暖（利好 ' + news.pos + ' / 利空 ' + news.neg + '）');
  else if (news.total >= 5 && diff <= -2 && signals) signals.push('资讯偏冷（利好 ' + news.pos + ' / 利空 ' + news.neg + '）');
  if (news.heat === 'high') { sc.push(0.65); if (signals) signals.push('个股热度高（' + news.total + ' 条相关资讯）'); }
  else if (news.heat === 'mid') sc.push(0.5);
  else sc.push(0.45);
  return clamp01(sc[0] * 0.7 + sc[1] * 0.3);
}
/* ---- 估值因子：PE/PB 对数平滑（相对便宜度），亏损股仅用 PB ---- */
function valueFactor(quote, signals) {
  var pe = quote && quote.pe, pb = quote && quote.pb;
  if (pe == null && pb == null) return 0.5;
  var peScore = 0.5, pbScore = 0.5, hasPe = false, hasPb = false;
  if (pe != null && isFinite(pe) && pe > 0) {
    hasPe = true;
    peScore = clamp01(1 - Math.log(pe) / Math.log(120));
    if (pe <= 15 && signals) signals.push('PE ' + pe.toFixed(1) + ' 处于低位区间');
    else if (pe > 80 && signals) signals.push('PE ' + pe.toFixed(1) + ' 偏高');
  } else if (pe != null && isFinite(pe) && pe <= 0) {
    if (signals) signals.push('公司亏损（PE 无效），估值参考 PB');
  }
  if (pb != null && isFinite(pb) && pb > 0) {
    hasPb = true;
    pbScore = clamp01(1 - Math.log(pb) / Math.log(60));
  }
  if (hasPe && hasPb) return clamp01(peScore * 0.55 + pbScore * 0.45);
  if (hasPe) return peScore;
  if (hasPb) return pbScore;
  return 0.5;
}
function quantLevel(score) {
  if (score >= 75) return '高（强偏多）';
  if (score >= 60) return '中高（偏多）';
  if (score >= 45) return '中（中性）';
  if (score >= 30) return '中低（偏空）';
  return '低（强偏空）';
}
/* ---- 风险提示（不直接扣分，仅展示） ---- */
function buildWarnings(stats, intra, quote) {
  var w = [];
  if (stats && stats.atrPct != null && stats.atrPct > 6) w.push('高波动：ATR 达 ' + stats.atrPct.toFixed(1) + '%');
  if (stats && stats.rsi != null && stats.rsi > 78) w.push('RSI ' + Math.round(stats.rsi) + ' 深度超买');
  if (intra && intra.volRatio != null && intra.volRatio > 4) w.push('量比 ' + intra.volRatio.toFixed(1) + ' 异常放大');
  if (quote && quote.turnover != null && isFinite(quote.turnover) && quote.turnover > 18) w.push('换手率 ' + quote.turnover.toFixed(1) + '% 偏高（投机加剧）');
  if (stats && stats.mom5 != null && stats.mom5 > 12) w.push('近 5 日涨幅 ' + stats.mom5.toFixed(1) + '% 较大，注意回撤');
  if (stats && stats.mom5 != null && stats.mom5 < -12) w.push('近 5 日跌幅 ' + stats.mom5.toFixed(1) + '% 较大，弱势明显');
  return w;
}
function quantPayload(cfg, quote, recent) {
  return new Promise(function (resolve, reject) {
    loadQuantCfg(function (qc) {
      var wT = isFinite(+qc.wTrend) ? +qc.wTrend : 30;
      var wF = isFinite(+qc.wFund) ? +qc.wFund : 30;
      var wV = isFinite(+qc.wVol) ? +qc.wVol : 20;
      var wN = isFinite(+qc.wNews) ? +qc.wNews : 10;
      var wVal = isFinite(+qc.wValue) ? +qc.wValue : 10;
      Promise.all([
        fetchKline(cfg, 120).catch(function () { return null; }),
        flowPayload(cfg, false).catch(function () { return { flow: null, lhb: [] }; }),
        fetchHotNews(cfg, false).catch(function () { return null; })
      ]).then(function (res) {
        var rows = res[0], flowData = res[1], news = res[2];
        if (!rows) { reject(new Error('K线数据获取失败')); return; }
        var stats = null;
        try { stats = computeDayStats(cfg, rows, null); } catch (e) { }
        predictIntraday(cfg, quote || {}, rows, recent || []).then(function (intra) {
          var signals = [];
          var fTrend = trendFactor(stats, signals);
          var fFund = fundFactor(flowData ? flowData.flow : null, flowData ? flowData.lhb : [], signals);
          var fVol = volFactor(intra, signals);
          var fNews = newsFactor(news, signals);
          var fValue = valueFactor(quote, signals);
          var warnings = buildWarnings(stats, intra, quote);
          var wSum = wT + wF + wV + wN + wVal;
          var score = wSum > 0 ? Math.round((fTrend * wT + fFund * wF + fVol * wV + fNews * wN + fValue * wVal) / wSum * 100) : 50;
          var dir = score >= 60 ? 'up' : (score <= 40 ? 'down' : 'flat');
          var dirTxt = score >= 75 ? '强偏多' : (score >= 60 ? '偏多' : (score >= 45 ? '中性' : (score >= 30 ? '偏空' : '强偏空')));
          resolve({
            mode: 'quant', score: score, dir: dir, dirTxt: dirTxt,
            level: quantLevel(score),
            factors: {
              trend: Math.round(fTrend * 100), fund: Math.round(fFund * 100),
              vol: Math.round(fVol * 100), news: Math.round(fNews * 100), value: Math.round(fValue * 100)
            },
            weights: { trend: wT, fund: wF, vol: wV, news: wN, value: wVal },
            signals: signals.slice(0, 6), warnings: warnings,
            ts: Date.now()
          });
        }).catch(function (e) { reject(e); });
      }).catch(function (e) { reject(e); });
    });
  });
}

/* ================= 异动提醒：量价信号检测 + 浏览器通知 ================= */
var ALERT_DEFAULTS = { on: true, ratioUp: 1.8, ratioDown: 0.5, pct: 3, cd: 120, larkOn: false, larkUrl: '', fundOn: true, fundAmt: 5000, fundPct: 5 };
var SIG_INFO = {
  upVol: '放量上涨', downVol: '放量下跌',
  upShrink: '缩量上涨', downShrink: '缩量下跌'
};
function loadAlertCfg(cb) {
  chrome.storage.local.get('chhAlert', function (o) {
    cb(Object.assign({}, ALERT_DEFAULTS, (o && o.chhAlert) || {}));
  });
}
function saveAlertCfg(cfg, cb) {
  chrome.storage.local.set({ chhAlert: cfg }, cb || function () {});
}

/* 盘中进度（把当前成交量折算为全天预估量）：返回 0~1，未开盘 0，已收盘 1 */
function sessionProgress(market) {
  var now = new Date();
  var d = now.getDay();
  if (d === 0 || d === 6) return 1;
  var m = now.getHours() * 60 + now.getMinutes();
  function span(am0, am1, pm0, pm1) {
    var total = (am1 - am0) + (pm1 - pm0);
    if (m < am0) return 0;
    if (m <= am1) return (m - am0) / total;
    if (m < pm0) return (am1 - am0) / total;
    if (m <= pm1) return ((am1 - am0) + (m - pm0)) / total;
    return 1;
  }
  if (market === 'hk') return span(9 * 60 + 30, 12 * 60, 13 * 60, 16 * 60);
  if (market === 'sg') return span(9 * 60, 11 * 60 + 30, 13 * 60 + 30, 15 * 60 + 30);
  if (market === 'us') {
    if (m >= 21 * 60 + 30) return (m - (21 * 60 + 30)) / 390;   /* 北京时间 21:30~24:00 */
    if (m < 4 * 60) return ((24 * 60 - (21 * 60 + 30)) + m) / 390; /* 0:00~4:00 */
    return 1;
  }
  return span(9 * 60 + 30, 11 * 60 + 30, 13 * 60, 15 * 60);   /* A股沪深北 */
}
function isTradingTime(market) {
  var p = sessionProgress(market);
  return p > 0 && p < 1;
}

function checkAlerts() {
  loadAlertCfg(function (cfg) {
    if (!cfg || !cfg.on) return;
    chrome.storage.local.get('chhStocks', function (o) {
      var list = (o && Array.isArray(o.chhStocks)) ? o.chhStocks : [];
      if (!list.length) return;
      list.forEach(function (s) {
        if (!s || !s.market || !s.code || !isTradingTime(s.market)) return;
        checkOneAlert(s, cfg);
        /* 主力资金异动（仅A股，盘中实时资金） */
        if (cfg.fundOn && isAShare(s)) checkOneFund(s, cfg);
      });
    });
  });
}
function checkOneAlert(s, cfg) {
  var qp = (s.market === 'sg') ? fetchEM(s) : fetchTencent(s).catch(function () { return fetchEM(s); });
  qp.then(function (q) {
    if (!q || !isFinite(q.price) || !isFinite(q.pct)) return;
    if (q.volHand == null || !(q.volHand > 0)) return;   /* 上金所现货无成交量，跳过 */
    return fetchKline(s, 60).then(function (rows) {
      if (rows.length < 6) return;
      var avg5 = 0;
      for (var i = rows.length - 6; i < rows.length - 1; i++) avg5 += (+rows[i][5] || 0);
      avg5 /= 5;
      if (!(avg5 > 0)) return;
      var prog = sessionProgress(s.market);
      var estVol = q.volHand / (prog > 0 ? prog : 1);
      var ratio = estVol / avg5;
      var sig = null;
      if (q.pct >= cfg.pct && ratio >= cfg.ratioUp) sig = 'upVol';
      else if (q.pct <= -cfg.pct && ratio >= cfg.ratioUp) sig = 'downVol';
      else if (q.pct >= cfg.pct && ratio <= cfg.ratioDown) sig = 'upShrink';
      else if (q.pct <= -cfg.pct && ratio <= cfg.ratioDown) sig = 'downShrink';
      if (!sig) return;
      var now = Date.now();
      chrome.storage.local.get('chhAlertLog', function (o2) {
        var log = (o2 && o2.chhAlertLog) || {};
        var key = s.market + ':' + s.code;
        var prev = log[key];
        if (prev && prev.type === sig && now - prev.t < cfg.cd * 60000) return; /* 冷却去重 */
        log[key] = { type: sig, t: now };
        chrome.storage.local.set({ chhAlertLog: log });
        predictDay(s, rows).then(function (p) {
          sendAlert(s, q, ratio, sig, p, cfg);
        }).catch(function () { sendAlert(s, q, ratio, sig, null, cfg); });
      });
    });
  }).catch(function () {});
}
function sendAlert(s, q, ratio, sig, pred, cfg) {
  var name = s.name || s.code;
  var price = isFinite(q.price) ? q.price.toFixed(2) : '--';
  var pctTxt = (q.pct >= 0 ? '+' : '') + q.pct.toFixed(2) + '%';
  var lines = [
    '【' + SIG_INFO[sig] + '】' + name,
    '现价 ' + price + '（' + pctTxt + '）',
    '量比 ' + ratio.toFixed(2) + '（相对前5日均量）'
  ];
  if (pred && isFinite(pred.nextLow) && isFinite(pred.probUp)) {
    lines.push('次日预测 ' + pred.nextLow.toFixed(2) + '~' + pred.nextHigh.toFixed(2) +
      ' · 上涨概率 ' + Math.round(pred.probUp * 100) + '%');
  }
  var text = lines.join('\n');
  if (chrome.notifications) {
    chrome.notifications.create('alert_' + s.market + '_' + s.code + '_' + sig + '_' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '【' + SIG_INFO[sig] + '】' + name,
      message: text,
      priority: 1
    });
  }
  /* 飞书群机器人推送：interactive 卡片 */
   if (cfg && cfg.larkOn && cfg.larkUrl) {
     pushLark(cfg.larkUrl, buildLarkCard(s, q, ratio, sig, pred)).catch(function () { /* 静默 */ });
   }
 }
var SIG_META = {
  upVol: { name: '放量上涨', icon: '📈', tmpl: 'red' },
  downVol: { name: '放量下跌', icon: '📉', tmpl: 'green' },
  upShrink: { name: '缩量上涨', icon: '↗️', tmpl: 'red' },
  downShrink: { name: '缩量下跌', icon: '↘️', tmpl: 'green' }
};
function marketShort(m) {
  return { sh: '上交所', sz: '深交所', bj: '北交所', hk: '港股', us: '美股', sg: '上金所' }[m] || String(m || '').toUpperCase();
}
/* 飞书消息卡片（schema 2.0）：红涨绿跌主题 + 四栏数据 + 次日预测 */
function buildLarkCard(s, q, ratio, sig, pred, note) {
  var meta = SIG_META[sig] || { name: sig || '异动', icon: '⚡', tmpl: 'blue' };
  var name = s.name || s.code;
  var priceTxt = isFinite(q.price) ? q.price.toFixed(2) : '--';
  var pctTxt = (isFinite(q.pct) ? (q.pct >= 0 ? '+' : '') + q.pct.toFixed(2) + '%' : '--');
  var now = new Date();
  var hm = (now.getHours() < 10 ? '0' + now.getHours() : now.getHours()) + ':' +
    (now.getMinutes() < 10 ? '0' + now.getMinutes() : now.getMinutes());
  var probTxt = (pred && isFinite(pred.probUp)) ? Math.round(pred.probUp * 100) + '%' : '--';
  var rangeTxt = (pred && isFinite(pred.nextLow)) ? pred.nextLow.toFixed(2) + ' ~ ' + pred.nextHigh.toFixed(2) : '--';
  var cols = [
    { label: '现价', value: priceTxt },
    { label: '涨跌幅', value: pctTxt },
    { label: '量比', value: ratio.toFixed(2) },
    { label: '上涨概率', value: probTxt }
  ].map(function (f) {
    return { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'markdown', content: '**' + f.label + '**\n' + f.value }] };
  });
  var elements = [
    { tag: 'markdown', content: '**' + priceTxt + '**　' + pctTxt },
    { tag: 'column_set', flex_mode: 'none', background_style: 'grey', horizontal_spacing: '8px', columns: cols },
    { tag: 'markdown', content: '**次日预测**　' + rangeTxt + '　·　上涨概率 **' + probTxt + '**' }
  ];
  if (note) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: note }] });
  }
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: meta.icon + ' ' + meta.name + ' · ' + name },
      subtitle: { tag: 'plain_text', content: txQueryCode(s) + ' · ' + marketShort(s.market) + ' · ' + hm },
      template: meta.tmpl,
      padding: '10px 12px 10px 12px'
    },
    body: { direction: 'vertical', padding: '12px 12px 12px 12px', elements: elements }
  };
}
function pushLark(url, card) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'interactive', card: card })
  })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.code !== 0) throw new Error((j && j.msg) || 'lark error');
    });
}
/* ================= 主力资金异动监控（仅A股） ================= */
var SIG_FUND_INFO = {
  fundIn: { name: '主力大幅流入', icon: '📥', tmpl: 'red' },
  fundOut: { name: '主力大幅流出', icon: '📤', tmpl: 'green' }
};
function fmtWanAmt(y) {
  if (y == null || isNaN(y)) return '--';
  var a = Math.abs(y), sign = y >= 0 ? '+' : '-';
  if (a >= 1e8) return sign + (a / 1e8).toFixed(2) + '亿';
  if (a >= 1e4) return sign + (a / 1e4).toFixed(0) + '万';
  return sign + a.toFixed(0);
}
function checkOneFund(s, cfg) {
  fetchFlowIntraday(s).then(function (flow) {
    if (!flow || flow.mainNet == null || flow.mainPct == null) return;
    var amt = cfg.fundAmt * 1e4, pct = cfg.fundPct;
    var sig = null;
    if (flow.mainNet >= amt && flow.mainPct >= pct) sig = 'fundIn';
    else if (flow.mainNet <= -amt && flow.mainPct <= -pct) sig = 'fundOut';
    if (!sig) return;
    var now = Date.now();
    chrome.storage.local.get('chhAlertLog', function (o) {
      var log = (o && o.chhAlertLog) || {};
      var key = s.market + ':' + s.code;
      var prev = log[key];
      if (prev && prev.type === sig && now - prev.t < cfg.cd * 60000) return; /* 冷却去重 */
      log[key] = { type: sig, t: now };
      chrome.storage.local.set({ chhAlertLog: log });
      sendFundAlert(s, flow, sig, cfg);
    });
  }).catch(function () {});
}
function sendFundAlert(s, flow, sig, cfg) {
  var meta = SIG_FUND_INFO[sig];
  var name = s.name || s.code;
  var lines = [
    '【' + meta.name + '】' + name,
    '主力净' + fmtWanAmt(flow.mainNet) + '（占比 ' + (flow.mainPct >= 0 ? '+' : '') + flow.mainPct.toFixed(2) + '%）',
    '超大单 ' + fmtWanAmt(flow.superNet) + ' · 大单 ' + fmtWanAmt(flow.bigNet),
    '中单 ' + fmtWanAmt(flow.midNet) + ' · 小单 ' + fmtWanAmt(flow.smallNet)
  ];
  var text = lines.join('\n');
  if (chrome.notifications) {
    chrome.notifications.create('fund_' + s.market + '_' + s.code + '_' + sig + '_' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '【' + meta.name + '】' + name,
      message: text,
      priority: 1
    });
  }
  if (cfg.larkOn && cfg.larkUrl) {
    pushLark(cfg.larkUrl, buildFundCard(s, flow, sig)).catch(function () { /* 静默 */ });
  }
}
function buildFundCard(s, flow, sig) {
  var meta = SIG_FUND_INFO[sig] || { name: sig, icon: '⚡', tmpl: 'blue' };
  var now = new Date();
  var hm = (now.getHours() < 10 ? '0' + now.getHours() : now.getHours()) + ':' +
    (now.getMinutes() < 10 ? '0' + now.getMinutes() : now.getMinutes());
  var cols = [
    { label: '主力净流入', value: fmtWanAmt(flow.mainNet) },
    { label: '主力占比', value: (flow.mainPct >= 0 ? '+' : '') + flow.mainPct.toFixed(2) + '%' },
    { label: '超大单', value: fmtWanAmt(flow.superNet) },
    { label: '大单', value: fmtWanAmt(flow.bigNet) }
  ].map(function (f) {
    return { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'markdown', content: '**' + f.label + '**\n' + f.value }] };
  });
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: meta.icon + ' ' + meta.name + ' · ' + (s.name || s.code) },
      subtitle: { tag: 'plain_text', content: txQueryCode(s) + ' · A股 · ' + hm },
      template: meta.tmpl,
      padding: '10px 12px 10px 12px'
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 12px 12px',
      elements: [
        { tag: 'markdown', content: '**主力净' + fmtWanAmt(flow.mainNet) + '**　·　占比 **' + (flow.mainPct >= 0 ? '+' : '') + flow.mainPct.toFixed(2) + '%**' },
        { tag: 'column_set', flex_mode: 'none', background_style: 'grey', horizontal_spacing: '8px', columns: cols },
        { tag: 'markdown', content: '中单 ' + fmtWanAmt(flow.midNet) + '　·　小单 ' + fmtWanAmt(flow.smallNet) },
        { tag: 'hr' },
        { tag: 'note', elements: [{ tag: 'plain_text', content: '东财盘中实时资金，仅供参考，不构成投资建议' }] }
      ]
    }
  };
}
chrome.notifications.onClicked.addListener(function (id) { chrome.notifications.clear(id); });

/* ================= 持仓：批量行情 + 盈亏计算 ================= */
function loadHoldingsData(cb) {
  chrome.storage.local.get('chhHoldings', function (o) {
    cb((o && Array.isArray(o.chhHoldings)) ? o.chhHoldings.slice() : []);
  });
}
/* 腾讯批量行情：一次请求多个代码，返回 txQueryCode -> quote 的 map（GBK 解码） */
function fetchTencentBatch(codes) {
  var url = 'https://qt.gtimg.cn/q=' + codes.join(',') + '&_=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.arrayBuffer(); })
    .then(function (buf) {
      var txt = new TextDecoder('gbk').decode(buf);
      var out = {};
      txt.replace(/v_(\w+)="([^"]*)"/g, function (all, code, data) {
        var f = data.split('~');
        if (f.length > 35 && isFinite(+f[3]) && +f[3] > 0) {
          out[code] = parseTx(f, code.slice(0, 2));
        }
        return all;
      });
      return out;
    });
}
function buildHoldings(list, map) {
  var items = [];
  var sum = { mv: 0, costAmt: 0, pl: 0, plPct: 0, dayPl: 0, dayPlPct: null };
  var plOk = false;
  list.forEach(function (it) {
    var d = map[txQueryCode(it)];
    var qty = +it.qty || 0;
    var cost = +it.cost || 0;
    var item = { market: it.market, code: it.code, name: it.name || '', qty: qty, cost: cost };
    if (d && isFinite(d.price) && d.price > 0) {
      var mv = d.price * qty;
      var costAmt = cost * qty;
      var pl = costAmt > 0 ? mv - costAmt : null;
      var plPct = costAmt > 0 ? (pl / costAmt * 100) : null;
      var dayPl = (isFinite(d.prevClose) && d.prevClose > 0) ? (d.price - d.prevClose) * qty : null;
      var dayPlPct = (isFinite(d.prevClose) && d.prevClose > 0) ? (d.price - d.prevClose) / d.prevClose * 100 : null;
      item.price = d.price;
      item.prevClose = d.prevClose;
      item.pct = d.pct;
      item.mv = mv;
      item.costAmt = costAmt;
      item.pl = pl;
      item.plPct = plPct;
      item.dayPl = dayPl;
      item.dayPlPct = dayPlPct;
      sum.mv += mv;
      sum.costAmt += costAmt;
      if (pl != null) { sum.pl += pl; plOk = true; }
      if (dayPl != null) sum.dayPl += dayPl;
    }
    items.push(item);
  });
  sum.plPct = sum.costAmt > 0 ? (sum.pl / sum.costAmt * 100) : 0;
  if (!plOk) sum.pl = null;
  sum.dayPlPct = (sum.costAmt > 0 && sum.dayPl != null) ? (sum.dayPl / sum.costAmt * 100) : null;
  return { items: items, sum: sum };
}
function fetchHoldings() {
  return new Promise(function (resolve, reject) {
    loadHoldingsData(function (list) {
      if (!list.length) { resolve({ items: [], sum: null }); return; }
      var qs = list.map(function (it) { return txQueryCode(it); });
      fetchTencentBatch(qs)
        .then(function (map) {
          /* 批量接口中缺失的项逐只拉取，腾讯失败降级东财 */
          var todo = list.filter(function (it) { return !map[txQueryCode(it)]; });
          return Promise.all(todo.map(function (it) {
            return fetchTencent(it).catch(function () { return fetchEM(it); })
              .then(function (d) { map[txQueryCode(it)] = d; return d; });
          })).then(function () { return map; });
        })
        .then(function (map) { resolve(buildHoldings(list, map)); })
        .catch(reject);
    });
  });
}

/* 定时轮询：MV3 需用 chrome.alarms（setInterval 在 SW 休眠后不可靠） */
function ensureAlertAlarm() {
  if (!chrome.alarms) return;
  chrome.alarms.get('alertCheck', function (a) {
    if (!a) chrome.alarms.create('alertCheck', { periodInMinutes: 1 });
  });
}
chrome.runtime.onInstalled.addListener(ensureAlertAlarm);
chrome.runtime.onStartup.addListener(ensureAlertAlarm);
chrome.alarms.onAlarm.addListener(function (al) {
  if (al.name === 'alertCheck') checkAlerts();
});
