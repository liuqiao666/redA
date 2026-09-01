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

var ALERT_DEFAULTS = { on: true, ratioUp: 1.8, ratioDown: 0.5, pct: 3, cd: 120, larkOn: false, larkUrl: '' };

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
      '<span class="mk">' + marketLabel(s.market) + '</span>' +
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
        saveActive(i, function () {
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
  saveStocks(stocks, function () {
    saveActive(Math.max(0, activeIdx));
    showMsg('ok', '已移除 ' + s.name);
    reload();
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
    d.innerHTML = '<span class="mk">' + marketLabel(it.market) + '</span>' +
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
  saveStocks(stocks, function () {
    saveActive(idx, function () {
      showMsg('ok', '已添加 ' + it.name + '（' + displayCode(it) + '）并设为当前展示');
      kw.value = '';
      list.innerHTML = '';
      reload();
    });
  });
}
function doSearch() {
  var q = kw.value.trim();
  if (!q) return;
  list.innerHTML = '<div class="emp">搜索中…</div>';
  searchStocks(q)
    .then(function (items) {
      items.sort(function (a, b) {
        var x = isStockType(a.type) ? 0 : 1, y = isStockType(b.type) ? 0 : 1;
        return x - y;
      });
      renderList(items);
    })
    .catch(function () {
      list.innerHTML = '<div class="emp">搜索失败，请检查网络后重试</div>';
    });
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

btn.addEventListener('click', doSearch);
kw.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
kw.addEventListener('input', function () { if (kw.value.trim().length >= 2) doSearch(); });

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
    chrome.storage.local.set({ chhAlert: cfg }, cb || function () {});
  });
}
alertToggle.addEventListener('change', function () {
  saveAlert({ on: alertToggle.checked }, function () {
    showMsg('ok', alertToggle.checked ? '异动提醒已开启' : '异动提醒已关闭');
  });
});
alertRatioUp.addEventListener('change', function () {
  var v = parseFloat(alertRatioUp.value);
  if (!isFinite(v) || v < 1) { showMsg('err', '放量倍率需 ≥ 1'); renderAlert(); return; }
  saveAlert({ ratioUp: v }, function () { showMsg('ok', '放量倍率已更新'); });
});
alertRatioDown.addEventListener('change', function () {
  var v = parseFloat(alertRatioDown.value);
  if (!isFinite(v) || v <= 0 || v >= 1) { showMsg('err', '缩量倍率需在 0~1 之间'); renderAlert(); return; }
  saveAlert({ ratioDown: v }, function () { showMsg('ok', '缩量倍率已更新'); });
});
alertPct.addEventListener('change', function () {
  var v = parseFloat(alertPct.value);
  if (!isFinite(v) || v <= 0) { showMsg('err', '涨跌幅阈值需大于 0'); renderAlert(); return; }
  saveAlert({ pct: v }, function () { showMsg('ok', '涨跌幅阈值已更新'); });
});
alertCd.addEventListener('change', function () {
  var v = parseFloat(alertCd.value);
  if (!isFinite(v) || v < 10) { showMsg('err', '冷却时间需 ≥ 10 分钟'); renderAlert(); return; }
  saveAlert({ cd: v }, function () { showMsg('ok', '冷却时间已更新'); });
});

/* ---- 飞书推送配置 ---- */
larkToggle.addEventListener('change', function () {
  saveAlert({ larkOn: larkToggle.checked }, function () {
    showMsg('ok', larkToggle.checked ? '飞书推送已开启' : '飞书推送已关闭');
  });
});
larkUrl.addEventListener('change', function () {
  var v = larkUrl.value.trim();
  if (v && v.indexOf('open.feishu.cn/open-apis/bot/v2/hook/') < 0) {
    showMsg('err', 'Webhook 地址格式不正确，请粘贴飞书群机器人的完整 Webhook 地址');
    return;
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
    chrome.runtime.sendMessage({ type: 'larkTest' }, function (resp) {
      larkTest.disabled = false;
      larkTest.textContent = '发送测试消息';
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        showMsg('err', '推送失败：' + ((resp && resp.error) || chrome.runtime.lastError || '未知错误'));
      } else {
        showMsg('ok', '测试消息已发送，请查看飞书群');
      }
    });
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
