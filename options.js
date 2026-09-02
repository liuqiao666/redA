/* 实时股价 · 完整设置页逻辑（多股票版） */
'use strict';

var kw = document.getElementById('kw');
var btn = document.getElementById('btn');
var list = document.getElementById('list');
var mylist = document.getElementById('mylist');
var myEmp = document.getElementById('myEmp');
var msg = document.getElementById('msg');
var curName = document.getElementById('curName');
var curMk = document.getElementById('curMk');
var curCode = document.getElementById('curCode');
var curPx = document.getElementById('curPx');
var visToggle = document.getElementById('visToggle');
var visSub = document.getElementById('visSub');
var alertToggle = document.getElementById('alertToggle');
var alertSub = document.getElementById('alertSub');
var alertRatioUp = document.getElementById('alertRatioUp');
var alertRatioDown = document.getElementById('alertRatioDown');
var alertPct = document.getElementById('alertPct');
var alertCd = document.getElementById('alertCd');
var larkToggle = document.getElementById('larkToggle');
var larkSub = document.getElementById('larkSub');
var larkUrl = document.getElementById('larkUrl');
var larkTest = document.getElementById('larkTest');
var alertFundAmt = document.getElementById('alertFundAmt');
var alertFundPct = document.getElementById('alertFundPct');
var quantToggle = document.getElementById('quantToggle');
var quantSub = document.getElementById('quantSub');
var qwTrend = document.getElementById('qwTrend');
var qwFund = document.getElementById('qwFund');
var qwVol = document.getElementById('qwVol');
var qwNews = document.getElementById('qwNews');
var qwValue = document.getElementById('qwValue');

var stocks = [];
var activeIdx = 0;

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function showMsg(kind, text) {
  msg.className = 'msg ' + kind;
  msg.textContent = text;
  setTimeout(function () { msg.className = 'msg'; }, 2600);
}
function currentCfg() {
  return stocks.length ? stocks[Math.min(activeIdx, stocks.length - 1)] : null;
}

/* ---- 已配置列表 ---- */
function renderMyList() {
  mylist.innerHTML = '';
  myEmp.style.display = stocks.length ? 'none' : 'block';
  stocks.forEach(function (s, i) {
    var d = document.createElement('div');
    d.className = 'mrow' + (i === activeIdx ? ' on' : '');
    var act = i === activeIdx ? '<span class="act">展示中</span>' : '';
    d.innerHTML =
      '<span class="mk">' + esc(marketLabel(s.market)) + '</span>' +
      '<span class="nm">' + esc(s.name) + '</span>' +
      '<span class="cd">' + esc(displayCode(s)) + '</span>' +
      act +
      '<span class="ops">' +
      (i === activeIdx ? '' : '<button class="sw">设为展示</button>') +
      '<button class="del">移除</button>' +
      '</span>';
    var swBtn = d.querySelector('.sw');
    if (swBtn) {
      swBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        saveActive(i, function (err) {
          if (err) { showMsg('err', '保存失败，请重试'); return; }
          showMsg('ok', '已切换展示为 ' + s.name + '，悬浮球已更新');
          reload();
        });
      });
    }
    d.querySelector('.del').addEventListener('click', function (e) {
      e.stopPropagation();
      removeStock(i);
    });
    mylist.appendChild(d);
  });
}
function removeStock(i) {
  var s = stocks[i];
  stocks.splice(i, 1);
  if (i < activeIdx) activeIdx--;
  else if (i === activeIdx) activeIdx = Math.min(activeIdx, stocks.length - 1);
  saveStocks(stocks, function (err) {
    if (err) { showMsg('err', '保存失败，请重试'); return; }
    saveActive(Math.max(0, activeIdx), function (err2) {
      if (err2) { showMsg('err', '保存失败，请重试'); return; }
      showMsg('ok', '已移除 ' + s.name);
      reload();
    });
  });
}

/* ---- 搜索添加 ---- */
function renderList(items) {
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="emp">未找到匹配项，换个关键字试试</div>';
    return;
  }
  items.forEach(function (it) {
    var d = document.createElement('div');
    d.className = 'item';
    var exists = stocks.some(function (s) {
      return s.market === it.market && String(s.code) === String(it.code);
    });
    d.innerHTML = '<span class="mk">' + esc(marketLabel(it.market)) + '</span>' +
      '<span class="nm">' + esc(it.name) + '</span>' +
      '<span class="cd">' + esc(displayCode(it)) + '</span>' +
      '<span class="tp">' + esc(typeLabel(it.type)) + '</span>' +
      (exists ? '' : '<span class="add">+ 添加</span>');
    d.addEventListener('click', function () {
      if (exists) return;
      addStock(it);
    });
    list.appendChild(d);
  });
}
function addStock(it) {
  stocks.push({ market: it.market, code: it.code, name: it.name });
  var idx = stocks.length - 1;
  saveStocks(stocks, function (err) {
    if (err) { showMsg('err', '保存失败，请重试'); return; }
    saveActive(idx, function (err2) {
      if (err2) { showMsg('err', '保存失败，请重试'); return; }
      showMsg('ok', '已添加 ' + it.name + '（' + displayCode(it) + '）并设为当前展示');
      kw.value = '';
      list.innerHTML = '';
      reload();
    });
  });
}
var searchSeq = 0;
var searchTimer = null;
function doSearch(force) {
  var q = kw.value.trim();
  if (!q) { searchSeq++; list.innerHTML = ''; return; }
  if (!force) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { doSearch(true); }, 300);
    return;
  }
  var seq = ++searchSeq;
  list.innerHTML = '<div class="emp">搜索中…</div>';
  btn.disabled = true;
  btn.textContent = '搜索中…';
  searchStocks(q)
    .then(function (items) {
      if (seq !== searchSeq) return;
      items.sort(function (a, b) {
        var x = isStockType(a.type) ? 0 : 1, y = isStockType(b.type) ? 0 : 1;
        return x - y;
      });
      renderList(items);
    })
    .catch(function () {
      if (seq !== searchSeq) return;
      list.innerHTML = '<div class="emp">搜索失败，请检查网络后重试</div>';
    })
    .then(function () { btn.disabled = false; btn.textContent = '搜索'; });
}

/* ---- 当前展示 ---- */
function renderCurrent() {
  var cfg = currentCfg();
  if (!cfg) {
    curName.textContent = '未配置';
    curMk.textContent = '--';
    curCode.textContent = '--';
    curPx.textContent = '--';
    curPx.className = 'px';
    return;
  }
  curName.textContent = cfg.name;
  curMk.textContent = marketLabel(cfg.market);
  curCode.textContent = displayCode(cfg);
}
function fetchPrice() {
  var cfg = currentCfg();
  if (!cfg) { curPx.textContent = '--'; curPx.className = 'px'; return; }
  curPx.textContent = '--';
  fetchQuoteOnce(cfg).then(function (r) {
    var d = r.data;
    if (d && isFinite(d.price)) {
      curPx.textContent = d.price.toFixed(2);
      curPx.className = 'px ' + (d.pct > 0 ? 'up' : (d.pct < 0 ? 'down' : ''));
    }
  }).catch(function () { curPx.textContent = '--'; });
}

kw.maxLength = 30;
btn.addEventListener('click', function () { clearTimeout(searchTimer); doSearch(true); });
kw.addEventListener('keydown', function (e) { if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(true); } });
kw.addEventListener('input', function () {
  if (kw.value.trim().length >= 2) doSearch();
  else { clearTimeout(searchTimer); searchSeq++; list.innerHTML = ''; }
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes.chhStocks || changes.chhActive) reload();
  if (changes.chhVisible) renderVis();
});

/* ---- 悬浮球显示开关 ---- */
function renderVis() {
  chrome.storage.local.get('chhVisible', function (o) {
    var v = !(o && o.chhVisible === false);
    visToggle.checked = v;
    visSub.textContent = v ? '当前：显示中（所有网页展示）' : '当前：已隐藏（所有网页已关闭）';
  });
}
visToggle.addEventListener('change', function () {
  var v = visToggle.checked;
  chrome.storage.local.set({ chhVisible: v }, function () {
    if (chrome.runtime.lastError) { showMsg('err', '保存失败，请重试'); renderVis(); return; }
    showMsg('ok', v ? '已开启悬浮球，所有页面将重新显示' : '已关闭悬浮球，所有页面将隐藏');
  });
});

/* ---- 异动提醒配置 ---- */
function renderAlert() {
  chrome.storage.local.get('chhAlert', function (o) {
    var cfg = Object.assign({}, ALERT_DEFAULTS, (o && o.chhAlert) || {});
    alertToggle.checked = !!cfg.on;
    alertSub.textContent = cfg.on ? '当前：已开启（交易时段每分钟检测）' : '当前：已关闭';
    alertRatioUp.value = cfg.ratioUp;
    alertRatioDown.value = cfg.ratioDown;
    alertPct.value = cfg.pct;
    alertCd.value = cfg.cd;
    alertFundAmt.value = cfg.fundAmt;
    alertFundPct.value = cfg.fundPct;
    larkToggle.checked = !!cfg.larkOn;
    larkUrl.value = cfg.larkUrl || '';
    larkSub.textContent = (cfg.larkOn && cfg.larkUrl)
      ? '当前：已开启（信号命中时同步推送飞书）'
      : '当前：未开启';
    if (cfg.larkUrl) {
      var m = String(cfg.larkUrl).match(/hook\/(.{6})/);
      larkUrl.placeholder = m ? '已配置 Webhook（' + m[1] + '…）' : '已配置 Webhook';
    } else {
      larkUrl.placeholder = 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx';
    }
  });
}
function saveAlert(part, cb) {
  chrome.storage.local.get('chhAlert', function (o) {
    var cfg = Object.assign({}, ALERT_DEFAULTS, (o && o.chhAlert) || {}, part);
    chrome.storage.local.set({ chhAlert: cfg }, function () {
      if (chrome.runtime.lastError) {
        console.error('saveAlert failed:', chrome.runtime.lastError.message);
        showMsg('err', '保存失败，请重试');
        return;
      }
      if (cb) cb();
    });
  });
}
alertToggle.addEventListener('change', function () {
  saveAlert({ on: alertToggle.checked }, function () {
    showMsg('ok', alertToggle.checked ? '异动提醒已开启' : '异动提醒已关闭');
  });
});
alertRatioUp.addEventListener('change', function () {
  var v = parseFloat(alertRatioUp.value);
  if (!isFinite(v) || v < 1 || v > 100) { showMsg('err', '放量倍率需在 1~100 之间'); renderAlert(); return; }
  saveAlert({ ratioUp: v }, function () { showMsg('ok', '放量倍率已更新'); });
});
alertRatioDown.addEventListener('change', function () {
  var v = parseFloat(alertRatioDown.value);
  if (!isFinite(v) || v <= 0 || v >= 1) { showMsg('err', '缩量倍率需在 0~1 之间'); renderAlert(); return; }
  saveAlert({ ratioDown: v }, function () { showMsg('ok', '缩量倍率已更新'); });
});
alertPct.addEventListener('change', function () {
  var v = parseFloat(alertPct.value);
  if (!isFinite(v) || v <= 0 || v > 50) { showMsg('err', '涨跌幅阈值需在 0~50 之间'); renderAlert(); return; }
  saveAlert({ pct: v }, function () { showMsg('ok', '涨跌幅阈值已更新'); });
});
alertCd.addEventListener('change', function () {
  var v = parseFloat(alertCd.value);
  if (!isFinite(v) || v < 10 || v > 1440 || v !== Math.floor(v)) { showMsg('err', '冷却时间需为 10~1440 的整数分钟'); renderAlert(); return; }
  saveAlert({ cd: v }, function () { showMsg('ok', '冷却时间已更新'); });
});
alertFundAmt.addEventListener('change', function () {
  var v = parseFloat(alertFundAmt.value);
  if (!isFinite(v) || v < 100 || v > 1000000) { showMsg('err', '主力净流入阈值需在 100~1000000 万元之间'); renderAlert(); return; }
  saveAlert({ fundAmt: v }, function () { showMsg('ok', '主力净流入阈值已更新'); });
});
alertFundPct.addEventListener('change', function () {
  var v = parseFloat(alertFundPct.value);
  if (!isFinite(v) || v < 1 || v > 50) { showMsg('err', '主力占比阈值需在 1~50 之间'); renderAlert(); return; }
  saveAlert({ fundPct: v }, function () { showMsg('ok', '主力占比阈值已更新'); });
});

/* ---- 飞书推送配置 ---- */
larkToggle.addEventListener('change', function () {
  saveAlert({ larkOn: larkToggle.checked }, function () {
    showMsg('ok', larkToggle.checked ? '飞书推送已开启' : '飞书推送已关闭');
  });
});
larkUrl.addEventListener('change', function () {
  var v = larkUrl.value.trim();
  if (v) {
    /* 严格校验：仅允许飞书官方 webhook（https + open.feishu.cn + 指定路径） */
    var u = null;
    try { u = new URL(v); } catch (e) { }
    if (!u || u.protocol !== 'https:' || u.hostname !== 'open.feishu.cn' ||
        !/^\/open-apis\/bot\/v2\/hook\/[0-9A-Za-z-]{6,}\/?$/.test(u.pathname)) {
      showMsg('err', 'Webhook 地址无效，仅支持 https://open.feishu.cn/open-apis/bot/v2/hook/... 格式');
      renderAlert();
      return;
    }
  }
  saveAlert({ larkUrl: v }, function () {
    showMsg('ok', v ? '飞书 Webhook 已保存' : '已清空飞书 Webhook');
    renderAlert();
  });
});
larkTest.addEventListener('click', function () {
  chrome.storage.local.get('chhAlert', function (o) {
    var cfg = Object.assign({}, ALERT_DEFAULTS, (o && o.chhAlert) || {});
    if (!cfg.larkUrl) { showMsg('err', '请先填写并保存飞书 Webhook 地址'); return; }
    larkTest.disabled = true;
    larkTest.textContent = '发送中…';
    var done = function (errTxt) {
      larkTest.disabled = false;
      larkTest.textContent = '发送测试消息';
      if (errTxt) { showMsg('err', '推送失败：' + errTxt); }
      else { showMsg('ok', '测试消息已发送，请查看飞书群'); }
    };
    var settled = false;
    var finish = function (errTxt) { if (!settled) { settled = true; done(errTxt); } };
    chrome.runtime.sendMessage({ type: 'larkTest' }, function (resp) {
      var err = (chrome.runtime.lastError || (resp && resp.error)) || null;
      finish(err ? String(err.message || err) : null);
    });
    /* 超时保护：SW 休眠/响应丢失时恢复按钮，避免永久卡在发送中 */
    setTimeout(function () { finish('请求超时，请重试'); }, 10000);
  });
});

/* ---- 量化综合评分配置 ---- */
function renderQuantCfg() {
  chrome.storage.local.get('chhQuant', function (o) {
    var cfg = Object.assign({}, QUANT_DEFAULTS, (o && o.chhQuant) || {});
    quantToggle.checked = !!cfg.on;
    quantSub.textContent = cfg.on ? '当前：已开启（行情卡展示量化评分）' : '当前：已关闭';
    qwTrend.value = cfg.wTrend;
    qwFund.value = cfg.wFund;
    qwVol.value = cfg.wVol;
    qwNews.value = cfg.wNews;
    qwValue.value = cfg.wValue;
  });
}
function saveQuant(part, cb) {
  chrome.storage.local.get('chhQuant', function (o) {
    var cfg = Object.assign({}, QUANT_DEFAULTS, (o && o.chhQuant) || {}, part);
    chrome.storage.local.set({ chhQuant: cfg }, function () {
      if (chrome.runtime.lastError) {
        console.error('saveQuant failed:', chrome.runtime.lastError.message);
        showMsg('err', '保存失败，请重试');
        return;
      }
      if (cb) cb();
    });
  });
}
quantToggle.addEventListener('change', function () {
  saveQuant({ on: quantToggle.checked }, function () {
    showMsg('ok', quantToggle.checked ? '量化评分已开启' : '量化评分已关闭');
  });
});
var QW_INPUTS = [
  ['qwTrend', 'wTrend'], ['qwFund', 'wFund'], ['qwVol', 'wVol'],
  ['qwNews', 'wNews'], ['qwValue', 'wValue']
];
var QW_LABELS = { wTrend: '趋势', wFund: '资金', wVol: '量价', wNews: '情绪', wValue: '估值' };
QW_INPUTS.forEach(function (pair) {
  var el = document.getElementById(pair[0]), key = pair[1];
  el.addEventListener('change', function () {
    var v = parseInt(el.value, 10);
    if (!isFinite(v) || v < 0 || v > 100) {
      showMsg('err', QW_LABELS[key] + '权重需在 0~100 之间');
      renderQuantCfg();
      return;
    }
    var part = {};
    part[key] = v;
    saveQuant(part, function () { showMsg('ok', QW_LABELS[key] + '权重已更新'); });
  });
});

function reload() {
  loadStocks(function (s) {
    stocks = s;
    loadActive(function (i) {
      if (stocks.length && i >= stocks.length) i = stocks.length - 1;
      activeIdx = i;
      renderMyList();
      renderCurrent();
      fetchPrice();
    });
  });
}

reload();
renderVis();
renderAlert();
renderQuantCfg();

/* ================= 我的持仓（本地记账） ================= */
var hkw = document.getElementById('hkw');
var hbtn = document.getElementById('hbtn');
var hlist = document.getElementById('hlist');
var hdlist = document.getElementById('hdlist');
var hdEmp = document.getElementById('hdEmp');
var hmsg = document.getElementById('hmsg');
var qtyrow = document.getElementById('qtyrow');
var hqty = document.getElementById('hqty');
var hcostEl = document.getElementById('hcost');
var hadd = document.getElementById('hadd');
var hcancel = document.getElementById('hcancel');
var hMv = document.getElementById('hMv');
var hCostEl = document.getElementById('hCost');
var hPlEl = document.getElementById('hPl');
var hDayEl = document.getElementById('hDay');

var holdings = [];
var holdQuotes = {};
var pendingHold = null;

function hkey(h) { return h.market + ':' + h.code; }
function fmtNum(v, digit) {
  if (v == null || isNaN(v)) return '--';
  return v.toFixed(digit == null ? 2 : digit);
}
function fmtMoney(v) {
  if (v == null || isNaN(v)) return '--';
  var neg = v < 0, a = Math.abs(v), s;
  if (a >= 1e8) s = (a / 1e8).toFixed(2) + '亿';
  else if (a >= 1e4) s = (a / 1e4).toFixed(2) + '万';
  else s = a.toFixed(0);
  return (neg ? '-' : (v > 0 ? '+' : '')) + s;
}
function fmtMoney2(v) {
  if (v == null || isNaN(v)) return '--';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return v.toFixed(0);
}
function plCls(v) {
  return (v == null || isNaN(v)) ? 'flat' : (v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'));
}
function showHMsg(kind, text) {
  hmsg.className = 'msg ' + kind;
  hmsg.textContent = text;
  setTimeout(function () { hmsg.className = 'msg'; }, 2600);
}
function hquote(h) { return holdQuotes[hkey(h)] || {}; }

function renderHoldings() {
  hdlist.innerHTML = '';
  hdEmp.style.display = holdings.length ? 'none' : 'block';
  holdings.forEach(function (h, i) {
    var q = hquote(h);
    var d = document.createElement('div');
    d.className = 'mrow';
    d.innerHTML =
      '<span class="mk">' + esc(marketLabel(h.market)) + '</span>' +
      '<span class="nm">' + esc(h.name) + '</span>' +
      '<span class="cd">' + esc(displayCode(h)) + ' · ' + fmtNum(h.qty, 0) + '股</span>' +
      '<span class="hpl ' + plCls(q.pl) + '">' + fmtMoney(q.pl) + '</span>' +
      '<span class="ops"><button class="ed">编辑</button><button class="del">删除</button></span>';
    d.querySelector('.ed').addEventListener('click', function (e) {
      e.stopPropagation();
      renderHoldEdit(d, i);
    });
    d.querySelector('.del').addEventListener('click', function (e) {
      e.stopPropagation();
      removeHold(i);
    });
    hdlist.appendChild(d);
  });
}

function renderHoldEdit(row, i) {
  var h = holdings[i];
  row.classList.add('edit');
  row.innerHTML =
    '<span class="nm">' + esc(h.name) + '</span>' +
    '<label>数量（股）<input class="eq" type="number" min="1" step="100" value="' + esc(h.qty) + '"></label>' +
    '<label>成本价<input class="ec" type="number" min="0" step="0.001" value="' + esc(h.cost) + '"></label>' +
    '<span class="ops"><button class="ok">保存</button><button class="cx">取消</button></span>';
  var eq = row.querySelector('.eq');
  var ec = row.querySelector('.ec');
  row.querySelector('.ok').addEventListener('click', function () {
    var q = parseFloat(eq.value), c = parseFloat(ec.value);
    if (!isFinite(q) || q <= 0 || Math.floor(q) !== q) { showHMsg('err', '数量需为大于 0 的整数股数'); return; }
    if (!isFinite(c) || c < 0) { showHMsg('err', '成本价需 ≥ 0'); return; }
    h.qty = q;
    h.cost = c;
    saveHoldings(holdings, function (err) {
      if (err) { showHMsg('err', '保存失败，请重试'); return; }
      showHMsg('ok', '已更新 ' + h.name + ' 持仓');
      fetchHoldQuotes();
    });
  });
  row.querySelector('.cx').addEventListener('click', function () { renderHoldings(); });
}

function removeHold(i) {
  var h = holdings[i];
  holdings.splice(i, 1);
  saveHoldings(holdings, function (err) {
    if (err) { showHMsg('err', '保存失败，请重试'); return; }
    showHMsg('ok', '已删除 ' + h.name + ' 持仓');
    delete holdQuotes[hkey(h)];
    fetchHoldQuotes();
  });
}

function fetchHoldQuotes() {
  if (!holdings.length) {
    holdQuotes = {};
    renderHoldings();
    renderHoldSum(null);
    return;
  }
  chrome.runtime.sendMessage({ type: 'holdings' }, function (resp) {
    if (chrome.runtime.lastError || !resp || !resp.ok) return;
    holdQuotes = {};
    (resp.items || []).forEach(function (it) { holdQuotes[it.market + ':' + it.code] = it; });
    renderHoldings();
    renderHoldSum(resp.sum);
  });
}

function renderHoldSum(sum) {
  hMv.className = hCostEl.className = hPlEl.className = hDayEl.className = '';
  if (!sum) {
    hMv.textContent = hCostEl.textContent = hPlEl.textContent = hDayEl.textContent = '--';
    return;
  }
  hMv.textContent = fmtMoney2(sum.mv);
  hCostEl.textContent = fmtMoney2(sum.costAmt);
  hPlEl.textContent = fmtMoney(sum.pl);
  hPlEl.className = plCls(sum.pl);
  hDayEl.textContent = fmtMoney(sum.dayPl);
  hDayEl.className = plCls(sum.dayPl);
}

var hSearchSeq = 0;
var hSearchTimer = null;
function doHSearch(force) {
  var q = hkw.value.trim();
  if (!q) { hSearchSeq++; hlist.innerHTML = ''; return; }
  if (!force) {
    clearTimeout(hSearchTimer);
    hSearchTimer = setTimeout(function () { doHSearch(true); }, 300);
    return;
  }
  var seq = ++hSearchSeq;
  hlist.innerHTML = '<div class="emp">搜索中…</div>';
  hbtn.disabled = true;
  hbtn.textContent = '搜索中…';
  searchStocks(q)
    .then(function (items) {
      if (seq !== hSearchSeq) return;
      items.sort(function (a, b) {
        var x = isStockType(a.type) ? 0 : 1, y = isStockType(b.type) ? 0 : 1;
        return x - y;
      });
      renderHList(items);
    })
    .catch(function () {
      if (seq !== hSearchSeq) return;
      hlist.innerHTML = '<div class="emp">搜索失败，请检查网络后重试</div>';
    })
    .then(function () { hbtn.disabled = false; hbtn.textContent = '搜索'; });
}
function renderHList(items) {
  hlist.innerHTML = '';
  if (!items.length) {
    hlist.innerHTML = '<div class="emp">未找到匹配项，换个关键字试试</div>';
    return;
  }
  items.forEach(function (it) {
    var d = document.createElement('div');
    d.className = 'item';
    var exists = holdings.some(function (s) {
      return s.market === it.market && String(s.code) === String(it.code);
    });
    d.innerHTML = '<span class="mk">' + esc(marketLabel(it.market)) + '</span>' +
      '<span class="nm">' + esc(it.name) + '</span>' +
      '<span class="cd">' + esc(displayCode(it)) + '</span>' +
      '<span class="tp">' + esc(typeLabel(it.type)) + '</span>' +
      (exists ? '<span class="act" style="color:#94a3b8">已添加</span>' : '<span class="add">+ 选择</span>');
    d.addEventListener('click', function () {
      if (exists) { showHMsg('err', '该股票已在持仓列表中'); return; }
      pickHold(it);
    });
    hlist.appendChild(d);
  });
}
function pickHold(it) {
  pendingHold = { market: it.market, code: it.code, name: it.name };
  hqty.value = '';
  hcostEl.value = '';
  qtyrow.style.display = 'flex';
  hqty.focus();
}
hkw.maxLength = 30;
hbtn.addEventListener('click', function () { clearTimeout(hSearchTimer); doHSearch(true); });
hkw.addEventListener('keydown', function (e) { if (e.key === 'Enter') { clearTimeout(hSearchTimer); doHSearch(true); } });
hkw.addEventListener('input', function () {
  if (hkw.value.trim().length >= 2) doHSearch();
  else { clearTimeout(hSearchTimer); hSearchSeq++; hlist.innerHTML = ''; }
});
hadd.addEventListener('click', function () {
  if (!pendingHold) { showHMsg('err', '请先搜索并选择一只股票'); return; }
  var q = parseFloat(hqty.value), c = parseFloat(hcostEl.value);
  if (!isFinite(q) || q <= 0 || Math.floor(q) !== q) { showHMsg('err', '请填写数量（股），需为大于 0 的整数'); return; }
  if (!isFinite(c) || c < 0) { showHMsg('err', '请填写成本价（每股），需 ≥ 0'); return; }
  holdings.push({
    market: pendingHold.market, code: pendingHold.code, name: pendingHold.name,
    qty: q, cost: c
  });
  saveHoldings(holdings, function (err) {
    if (err) { showHMsg('err', '保存失败，请重试'); return; }
    showHMsg('ok', '已添加 ' + pendingHold.name + ' 持仓');
    pendingHold = null;
    qtyrow.style.display = 'none';
    hkw.value = '';
    hlist.innerHTML = '';
    fetchHoldQuotes();
  });
});
hcancel.addEventListener('click', function () {
  pendingHold = null;
  qtyrow.style.display = 'none';
  hlist.innerHTML = '';
});

function reloadHoldings() {
  loadHoldings(function (list) {
    holdings = list;
    fetchHoldQuotes();
  });
}
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local' || !changes.chhHoldings) return;
  reloadHoldings();
});
reloadHoldings();
setInterval(fetchHoldQuotes, 30000);
