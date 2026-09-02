/* 实时股价 · 弹窗配置逻辑（多股票版） */
'use strict';

var kw = document.getElementById('kw');
var list = document.getElementById('list');
var mylist = document.getElementById('mylist');
var myEmp = document.getElementById('myEmp');
var cntEl = document.getElementById('cnt');
var curMk = document.getElementById('curMk');
var curName = document.getElementById('curName');
var curCode = document.getElementById('curCode');
var curPrice = document.getElementById('curPrice');
var okEl = document.getElementById('ok');
var openOpts = document.getElementById('openOpts');
var prdline = document.getElementById('prdline');
var visToggle = document.getElementById('visToggle');
var visSt = document.getElementById('visSt');

var stocks = [];
var activeIdx = 0;
var showOkTimer = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function showOk(txt, isErr) {
  okEl.textContent = txt || '已保存 ✓';
  okEl.style.color = isErr ? '#e5484d' : '';
  okEl.classList.add('show');
  clearTimeout(showOkTimer);
  showOkTimer = setTimeout(function () {
    okEl.classList.remove('show');
    okEl.style.color = '';
    okEl.textContent = '已保存 ✓';
  }, 1800);
}
function currentCfg() {
  return stocks.length ? stocks[Math.min(activeIdx, stocks.length - 1)] : null;
}

/* ---- 已配置列表 ---- */
function renderMyList() {
  mylist.innerHTML = '';
  myEmp.style.display = stocks.length ? 'none' : 'block';
  cntEl.textContent = stocks.length + ' 只';
  stocks.forEach(function (s, i) {
    var d = document.createElement('div');
    d.className = 'mrow' + (i === activeIdx ? ' on' : '');
    var act = i === activeIdx ? '<span class="act">展示中</span>' : '';
    d.innerHTML =
      '<span class="mk">' + esc(marketLabel(s.market)) + '</span>' +
      '<span class="nm">' + esc(s.name) + '</span>' +
      '<span class="cd">' + esc(displayCode(s)) + '</span>' +
      act +
      '<button class="del" title="移除">×</button>';
    d.addEventListener('click', function () {
      saveActive(i);
      renderMyList();
      renderCurrent();
      fetchPrice();
    });
    var del = d.querySelector('.del');
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      removeStock(i);
    });
    mylist.appendChild(d);
  });
}
function removeStock(i) {
  var removed = stocks.splice(i, 1);
  if (!removed.length) return;
  if (i < activeIdx) activeIdx--;
  else if (i === activeIdx) activeIdx = Math.min(activeIdx, stocks.length - 1);
  saveStocks(stocks, function (err) {
    if (err) { showOk('保存失败，请重试', true); return; }
    saveActive(Math.max(0, activeIdx), function (err2) {
      if (err2) { showOk('保存失败，请重试', true); return; }
      showOk();
      renderMyList();
      renderCurrent();
      fetchPrice();
      renderPred();
    });
  });
}

/* ---- 搜索添加 ---- */
function renderList(items) {
  list.innerHTML = '';
  if (!items.length) {
    var emp = document.createElement('div');
    emp.className = 'emp';
    emp.textContent = '未找到匹配项，换个关键字试试';
    list.appendChild(emp);
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
    if (err) { showOk('保存失败，请重试', true); return; }
    saveActive(idx, function (err2) {
      if (err2) { showOk('保存失败，请重试', true); return; }
      showOk();
      renderMyList();
      renderCurrent();
      fetchPrice();
      renderPred();
      kw.value = '';
      list.innerHTML = '';
    });
  });
}
var searchSeq = 0;
var searchTimer = null;
function doSearch(force) {
  var q = kw.value.trim();
  if (!q) { searchSeq++; list.innerHTML = ''; return; }
  if (!force) {
    /* 防抖：连续输入只触发最后一次 */
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { doSearch(true); }, 300);
    return;
  }
  var seq = ++searchSeq;
  list.innerHTML = '<div class="emp">搜索中…</div>';
  searchStocks(q)
    .then(function (items) {
      if (seq !== searchSeq) return; /* 丢弃过期响应 */
      items.sort(function (a, b) {
        var x = isStockType(a.type) ? 0 : 1, y = isStockType(b.type) ? 0 : 1;
        return x - y;
      });
      renderList(items);
    })
    .catch(function () {
      if (seq !== searchSeq) return;
      list.innerHTML = '<div class="emp">搜索失败，请检查网络后重试</div>';
    });
}

/* ---- 当前展示 ---- */
function renderCurrent() {
  var cfg = currentCfg();
  if (!cfg) {
    curMk.textContent = '--';
    curName.textContent = '未配置';
    curCode.textContent = '--';
    curPrice.textContent = '--';
    curPrice.className = 'price';
    prdline.textContent = '预测参考：--';
    return;
  }
  curMk.textContent = marketLabel(cfg.market);
  curName.textContent = cfg.name;
  curCode.textContent = cfg.code;
}
function fetchPrice() {
  var cfg = currentCfg();
  if (!cfg) { curPrice.textContent = '--'; curPrice.className = 'price'; return; }
  curPrice.textContent = '--';
  fetchQuoteOnce(cfg).then(function (r) {
    var d = r.data;
    if (d && isFinite(d.price)) {
      curPrice.textContent = d.price.toFixed(2);
      curPrice.className = 'price ' + (d.pct > 0 ? 'up' : (d.pct < 0 ? 'down' : ''));
    }
  }).catch(function () { curPrice.textContent = '--'; });
}
function renderPred() {
  var cfg = currentCfg();
  if (!cfg) { prdline.textContent = '预测参考：--'; return; }
  chrome.runtime.sendMessage({ type: 'predict', cfg: cfg }, function (resp) {
    if (chrome.runtime.lastError || !resp || !resp.ok || !resp.data) return;
    var p = resp.data;
    var col = p.dir === 'up' ? '#e5484d' : (p.dir === 'down' ? '#10a37f' : '#64748b');
    prdline.innerHTML = '预测参考：<b style="color:' + col + '">' + esc(p.dirTxt) + '</b>' +
      ' · 明日 <b>' + (+p.nextLow).toFixed(2) + '</b>~<b>' + (+p.nextHigh).toFixed(2) + '</b>' +
      ' · 上涨概率 <b>' + Math.round(p.probUp * 100) + '%</b>';
  });
}

kw.maxLength = 30;
kw.addEventListener('keydown', function (e) { if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(true); } });
kw.addEventListener('input', function () {
  if (kw.value.trim().length >= 2) doSearch();
  else { clearTimeout(searchTimer); searchSeq++; list.innerHTML = ''; }
});
openOpts.addEventListener('click', function () {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
});

/* ---- 悬浮球显示开关 ---- */
function renderVis() {
  chrome.storage.local.get('chhVisible', function (o) {
    var v = !(o && o.chhVisible === false);
    visToggle.checked = v;
    visSt.textContent = v ? '显示中' : '已隐藏';
  });
}
visToggle.addEventListener('change', function () {
  var v = visToggle.checked;
  chrome.storage.local.set({ chhVisible: v }, function () {
    if (chrome.runtime.lastError) { showOk('保存失败，请重试', true); renderVis(); return; }
    showOk();
  });
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes.chhStocks || changes.chhActive) {
    reload();
  }
  if (changes.chhVisible) renderVis();
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
      renderPred();
    });
  });
}

reload();
renderVis();
