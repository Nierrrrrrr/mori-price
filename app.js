// 願望清單價格檢視頁。資料由水藍鼠匯出到 data/site.js（window.BM_DATA）。
// 店主名稱等文字來自其他玩家，一律用 textContent 放進頁面，不組 HTML 字串。
(() => {
  'use strict';
  const D = document;
  const $ = (id) => D.getElementById(id);
  const http = /^https?:$/.test(location.protocol);
  const fmt = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
  const compact = new Intl.NumberFormat('zh-TW', { notation: 'compact', maximumFractionDigits: 1 });
  const SVG = 'http://www.w3.org/2000/svg';

  const CHANGE = {
    new: ['新上架', ''], up: ['↑ 漲價', 'up'], down: ['↓ 降價', 'down'], same: ['持平', ''],
    mixed: ['有漲有跌', ''], quantity: ['數量改變', ''], relisted: ['重新上架', ''], unknown: ['—', ''],
  };
  const STATUS = { complete: '完成', partial: '部分缺漏', failed: '失敗', stopped: '已停止', saved: '已保存' };
  const REASON = {
    no_stall: '到達時已沒有攤位', not_found: '店內沒有這項道具（可能已售出）',
    unreachable: '沒能走到攤位旁', other: '讀取失敗',
  };
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_LABEL = { auto: '自動', light: '淺色', dark: '深色' };

  let data = null;
  let version = null;
  const view = { tab: 'now', q: '', server: '' };
  const charts = [];

  function el(tag, props, ...kids) {
    const n = D.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.append(kid instanceof Node ? kid : D.createTextNode(String(kid)));
    }
    return n;
  }
  function sv(tag, attrs) {
    const n = D.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    return n;
  }

  const time = (ms) => (ms ? new Date(ms).toLocaleString('zh-TW', {
    hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—');
  const day = (ms) => new Date(ms).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
  const clock = (ms) => new Date(ms).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
  // 範圍在一天半內時軸上標時間，否則標日期。
  const span = (t0, t1) => (t1 - t0 < 36 * 3600000 ? (ms) => `${day(ms)} ${clock(ms)}` : day);
  function ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return '剛剛';
    if (m < 60) return `${m} 分鐘前`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h} 小時前`;
    return `${Math.floor(h / 24)} 天前`;
  }
  const where = (r) => `${r.map}（東 ${r.x}，南 ${r.y}）`;
  const qty = (u) => (u == null ? '未顯示' : String(u));
  const price = (n) => `${fmt.format(n)} G`;
  const key = (name, id) => `${name}\u0000${id}`;
  const lower = (s) => String(s || '').toLowerCase();

  // ---- 載入 ----
  function fail(message) {
    $('meta').textContent = message;
    for (const id of ['tab-now', 'tab-history', 'tab-missing']) {
      $(id).replaceChildren(el('p', { class: 'empty', text: message }));
    }
  }
  function loadData(v) {
    const s = D.createElement('script');
    s.src = `data/site.js?v=${encodeURIComponent(v)}`;
    s.onload = () => {
      const d = window.BM_DATA;
      if (!d || d.schema !== 1) return fail('價格資料的格式不符，請稍後再試。');
      data = d;
      version = window.BM_VERSION || null;
      render();
    };
    s.onerror = () => fail('讀不到價格資料，請稍後重新整理。');
    D.head.append(s);
  }
  function poll() {
    fetch(`version.txt?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => {
        const latest = t.trim();
        if (version && latest && latest !== version) $('fresh').hidden = false;
      })
      .catch(() => {});
  }

  // ---- 配色 ----
  function storedTheme() {
    try { return localStorage.getItem('bm-theme') || 'auto'; } catch { return 'auto'; }
  }
  function applyTheme(t) {
    if (t === 'auto') D.documentElement.removeAttribute('data-theme');
    else D.documentElement.setAttribute('data-theme', t);
    $('theme').textContent = `配色：${THEME_LABEL[t] || '自動'}`;
  }

  // ---- 篩選 ----
  function matchText(...texts) {
    if (!view.q) return true;
    return texts.some((t) => lower(t).includes(view.q));
  }
  const matchServer = (s) => !view.server || s === view.server;

  // ---- 頁首 ----
  function renderHeader() {
    if (!data) return;
    const r = data.round;
    const meta = $('meta');
    meta.replaceChildren();
    if (!r) {
      meta.textContent = '還沒有完成的查價輪次。';
    } else {
      meta.append(
        '最後更新 ', el('strong', { text: time(data.generated_at) }), `（${ago(data.generated_at)}）`,
        `・第 ${r.number} 輪${STATUS[r.status] ? `・${STATUS[r.status]}` : ''}`,
        data.interval_minutes ? `・約每 ${data.interval_minutes} 分鐘查一次` : '',
      );
    }
    const notes = [];
    if (data.run_state === 'stopped') {
      notes.push('查價目前已停止，以下是最後一輪的結果。');
    } else {
      const limit = ((data.interval_minutes || 10) * 2 + 10) * 60000;
      if (Date.now() - data.generated_at > limit) {
        notes.push(`已經 ${ago(data.generated_at).replace('前', '')}沒有更新，查價可能中斷，價格僅供參考。`);
      }
    }
    if (r && r.unsearched.length) {
      notes.push(`這輪官網有 ${r.unsearched.length} 個品名沒查完整，下一輪會再查。`);
    }
    const notice = $('notice');
    notice.hidden = notes.length === 0;
    notice.textContent = notes.join(' ');
  }

  // ---- 目前販售 ----
  function copyText(text, btn) {
    const done = () => {
      const old = btn.textContent;
      btn.textContent = '已複製';
      setTimeout(() => { btn.textContent = old; }, 1500);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else {
      fallback();
    }
    function fallback() {
      const t = el('textarea', { class: 'sr', readonly: true });
      t.value = text;
      D.body.append(t);
      t.select();
      try { if (D.execCommand('copy')) done(); } catch { /* 無法複製時保留按鈕原狀 */ }
      t.remove();
    }
  }

  function wishOrder() {
    const order = new Map();
    (data.wishlist || []).forEach((w, i) => { if (!order.has(w.name)) order.set(w.name, i); });
    return (name) => (order.has(name) ? order.get(name) : 1e9);
  }

  function groupedListings() {
    const groups = new Map();
    for (const l of data.listings) {
      const k = key(l.item, l.item_id);
      if (!groups.has(k)) groups.set(k, { item: l.item, id: l.item_id, rows: [] });
      groups.get(k).rows.push(l);
    }
    const rank = wishOrder();
    return [...groups.values()].sort((a, b) => rank(a.item) - rank(b.item) || a.item.localeCompare(b.item) || a.id - b.id);
  }

  function listingRow(l) {
    const [label, cls] = CHANGE[l.change] || CHANGE.unknown;
    const location = `${l.server} ${where(l)} 店主 ${l.owner}`;
    const btn = el('button', { type: 'button', class: 'copy', 'aria-label': `複製位置：${location}` }, '複製位置');
    btn.addEventListener('click', () => copyText(location, btn));
    return el('tr', null,
      el('td', { class: 'num price', 'data-label': '列價' }, price(l.row_price)),
      el('td', { class: 'num', 'data-label': '數量' }, qty(l.units)),
      el('td', { 'data-label': '伺服器' }, l.server),
      el('td', { 'data-label': '位置' }, where(l)),
      el('td', { class: 'owner', 'data-label': '店主' }, l.owner, el('div', { class: 'muted small', text: `#${l.owner_id}` })),
      el('td', { 'data-label': '讀取' }, time(l.observed_at)),
      el('td', { 'data-label': '變化' }, el('span', { class: `change ${cls}`, text: label })),
      el('td', null, btn),
    );
  }

  function renderNow() {
    const box = $('tab-now');
    box.replaceChildren();
    if (!data.round) {
      box.append(el('p', { class: 'empty', text: '還沒有完成的查價輪次。' }));
      return 0;
    }
    const groups = groupedListings();
    box.append(el('p', { class: 'hint', text: '每攤依列價由低到高排列。數量顯示「未顯示」時，列價不能當單價。' }));
    const list = el('div', { class: 'list' });
    for (const g of groups) {
      const rows = g.rows.filter((l) => matchServer(l.server) && matchText(g.item, l.owner, l.server))
        .sort((a, b) => a.row_price - b.row_price || a.server.localeCompare(b.server));
      if (!rows.length) continue;
      const shops = new Set(rows.map((l) => `${l.server}\u0000${l.owner_id}`)).size;
      list.append(el('article', { class: 'card' },
        el('div', { class: 'card-head' },
          el('h3', null, g.item, ' ', el('span', { class: 'id', text: `#${g.id}` })),
          el('span', { class: 'stat' }, '最低 ', el('strong', { text: price(rows[0].row_price) })),
          el('span', { class: 'stat', text: `${shops} 攤・${rows.length} 列` }),
        ),
        el('table', { class: 'stack' },
          el('thead', null, el('tr', null, ['列價', '數量', '伺服器', '位置', '店主', '讀取', '變化', ''].map((h, i) =>
            el('th', { scope: 'col', class: i < 2 ? 'num' : null, text: h })))),
          el('tbody', null, rows.map(listingRow)),
        ),
      ));
    }
    if (list.childElementCount) box.append(list);
    else box.append(el('p', { class: 'empty', text: data.listings.length ? '沒有符合篩選條件的攤位。' : '這輪沒有讀到願望清單裡的道具。' }));

    const unread = (data.unreadable || []).filter((u) => matchServer(u.server) && matchText(...u.items, u.server, u.map));
    if (unread.length) {
      box.append(
        el('h2', { text: '這輪沒讀到的攤位' }),
        el('p', { class: 'hint', text: '官網列出、但這輪到店時沒能讀到商品的位置。' }),
        el('div', { class: 'card' }, el('table', { class: 'stack' },
          el('thead', null, el('tr', null, ['伺服器', '位置', '道具', '原因'].map((h) => el('th', { scope: 'col', text: h })))),
          el('tbody', null, unread.map((u) => el('tr', null,
            el('td', { 'data-label': '伺服器' }, u.server || '—'),
            el('td', { 'data-label': '位置' }, where(u)),
            el('td', { 'data-label': '道具' }, u.items.join('、')),
            el('td', { 'data-label': '原因' }, REASON[u.reason] || REASON.other),
          ))),
        )),
      );
    }
    return groups.length;
  }

  // ---- 歷史價格 ----
  const tip = () => $('tip');
  function showTip(x, y, value, ...lines) {
    const t = tip();
    t.replaceChildren(
      el('div', null, el('span', { class: 'k' }), el('span', { class: 'v', text: value })),
      ...lines.map((s) => el('div', { class: 's', text: s })),
    );
    t.hidden = false;
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const left = Math.min(Math.max(8, x + 14), window.innerWidth - w - 8);
    const top = y - h - 12 < 8 ? y + 16 : y - h - 12;
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
  }
  const hideTip = () => { tip().hidden = true; };

  function drawChart(svg, h) {
    const trend = h.trend || [];
    svg.replaceChildren();
    if (!trend.length) return;
    const W = Math.max(240, svg.clientWidth || 600);
    const H = 132;
    const m = { l: 56, r: 14, t: 12, b: 24 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const t0 = trend[0].t;
    const t1 = trend[trend.length - 1].t;
    let lo = Math.min(...trend.map((p) => p.low));
    let hi = Math.max(...trend.map((p) => p.low));
    if (lo === hi) { const pad = Math.max(1, Math.round(lo * 0.1)); lo = Math.max(0, lo - pad); hi += pad; }
    const x = (t) => (t1 === t0 ? (m.l + W - m.r) / 2 : m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r));
    const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    for (const v of [lo, (lo + hi) / 2, hi]) {
      svg.append(sv('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
      const label = sv('text', { class: 'axis', x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' });
      label.textContent = compact.format(Math.round(v));
      svg.append(label);
    }
    const tick = span(t0, t1);
    for (const [t, anchor] of t0 === t1 ? [[t0, 'middle']] : [[t0, 'start'], [t1, 'end']]) {
      const label = sv('text', { class: 'axis', x: x(t), y: H - 6, 'text-anchor': anchor });
      label.textContent = tick(t);
      svg.append(label);
    }
    const pts = trend.map((p) => [x(p.t), y(p.low)]);
    const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    if (pts.length > 1) {
      const base = H - m.b;
      svg.append(sv('path', { class: 'area', d: `${line}L${pts[pts.length - 1][0].toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z` }));
      svg.append(sv('path', { class: 'line', d: line }));
    }
    const [ex, ey] = pts[pts.length - 1];
    svg.append(sv('circle', { class: 'dot', cx: ex, cy: ey, r: 4 }));
    const cross = sv('line', { class: 'cross', y1: m.t, y2: H - m.b, visibility: 'hidden' });
    const focus = sv('circle', { class: 'dot', r: 4, visibility: 'hidden' });
    svg.append(cross, focus);

    let index = trend.length - 1;
    const show = (i, clientX, clientY) => {
      index = i;
      const [px, py] = pts[i];
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      focus.setAttribute('cx', px); focus.setAttribute('cy', py); focus.setAttribute('visibility', 'visible');
      const box = svg.getBoundingClientRect();
      const sx = box.width / W;
      const p = trend[i];
      showTip(clientX ?? box.left + px * sx, clientY ?? box.top + py * sx, price(p.low),
        `最低列價・${time(p.t)}`, `這輪 ${p.n} 列`);
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      focus.setAttribute('visibility', 'hidden');
      hideTip();
    };
    svg.onpointermove = (e) => {
      const box = svg.getBoundingClientRect();
      const vx = ((e.clientX - box.left) / box.width) * W;
      let best = 0;
      pts.forEach(([px], i) => { if (Math.abs(px - vx) < Math.abs(pts[best][0] - vx)) best = i; });
      show(best, e.clientX, e.clientY);
    };
    svg.onpointerleave = hide;
    svg.onblur = hide;
    svg.onfocus = () => show(index);
    svg.onkeydown = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        show(Math.min(trend.length - 1, Math.max(0, index + (e.key === 'ArrowLeft' ? -1 : 1))));
      } else if (e.key === 'Escape') hide();
    };
  }

  function renderHistory() {
    const box = $('tab-history');
    box.replaceChildren();
    charts.length = 0;
    const rank = wishOrder();
    const products = (data.history || []).filter((h) =>
      h.points.some((p) => matchServer(p.server)) && matchText(h.item, ...h.points.map((p) => p.owner)))
      .sort((a, b) => rank(a.item) - rank(b.item) || a.item.localeCompare(b.item) || a.item_id - b.item_id);
    box.append(el('p', { class: 'hint', text: `最近 ${data.history_days} 天的到店紀錄。統計包含所有伺服器；走勢線是每輪看到的最低列價。` }));
    if (!products.length) {
      box.append(el('p', { class: 'empty', text: (data.history || []).length ? '沒有符合篩選條件的歷史紀錄。' : '還沒有歷史價格紀錄。' }));
      return (data.history || []).length;
    }
    const list = el('div', { class: 'list' });
    for (const h of products) {
      const trend = h.trend || [];
      const last = trend.length ? trend[trend.length - 1].low : h.low;
      const svg = sv('svg', {
        role: 'img', tabindex: '0',
        'aria-label': `${h.item} 每輪最低列價走勢：最近 ${price(last)}，最低 ${price(h.low)}，最高 ${price(h.high)}。可用左右鍵逐輪查看。`,
      });
      charts.push([svg, h]);
      const points = h.points.filter((p) => matchServer(p.server));
      list.append(el('article', { class: 'card' },
        el('div', { class: 'card-head' },
          el('h3', null, h.item, ' ', el('span', { class: 'id', text: `#${h.item_id}` })),
          el('span', { class: 'stat', text: `數量 ${qty(h.units)}` }),
        ),
        el('div', { class: 'stats-row' },
          el('span', { class: 'stat' }, '最低 ', el('strong', { text: price(h.low) })),
          el('span', { class: 'stat' }, '中位 ', el('strong', { text: price(h.median) })),
          el('span', { class: 'stat' }, '最高 ', el('strong', { text: price(h.high) })),
          el('span', { class: 'stat', text: `${h.rounds} 輪・${h.count} 筆` }),
        ),
        el('div', { class: 'chart' }, svg),
        el('div', { class: 'chart-caption', text: trend.length > 1
          ? `${time(trend[0].t)} 到 ${time(trend[trend.length - 1].t)}，最近 ${trend.length} 輪的最低列價`
          : '目前只有一輪紀錄' }),
        el('details', null,
          el('summary', { text: `查看最近 ${points.length} 筆紀錄` }),
          el('table', { class: 'stack' },
            el('thead', null, el('tr', null, ['時間', '列價', '伺服器', '位置', '店主'].map((t, i) =>
              el('th', { scope: 'col', class: i === 1 ? 'num' : null, text: t })))),
            el('tbody', null, points.map((p) => el('tr', null,
              el('td', { 'data-label': '時間' }, time(p.t)),
              el('td', { class: 'num price', 'data-label': '列價' }, price(p.price)),
              el('td', { 'data-label': '伺服器' }, p.server),
              el('td', { 'data-label': '位置' }, where(p)),
              el('td', { class: 'owner', 'data-label': '店主' }, p.owner),
            ))),
          ),
        ),
      ));
    }
    box.append(list);
    requestAnimationFrame(() => charts.forEach(([s, h]) => drawChart(s, h)));
    return (data.history || []).length;
  }

  // ---- 查無攤位 ----
  function renderMissing() {
    const box = $('tab-missing');
    box.replaceChildren();
    const quoted = new Set(data.listings.map((l) => l.item));
    const names = (pred) => [...new Set((data.wishlist || []).filter(pred).map((w) => w.name))];
    const none = names((w) => w.searched === true && w.candidates === 0);
    const unseen = names((w) => w.searched === true && w.candidates > 0 && !quoted.has(w.name));
    const unknown = names((w) => w.searched !== true);
    const section = (title, hint, list) => {
      const shown = list.filter((n) => matchText(n));
      if (!shown.length) return;
      box.append(el('h2', { text: `${title}（${shown.length}）` }), el('p', { class: 'hint', text: hint }),
        el('ul', { class: 'chips' }, shown.map((n) => el('li', { text: n }))));
    };
    if (!data.round) {
      box.append(el('p', { class: 'empty', text: '還沒有完成的查價輪次。' }));
      return 0;
    }
    section('官網查無攤位', '這輪官網完整搜尋過，但沒有找到候選攤位。官網只列離線攤位，所以不代表沒人在賣。', none);
    section('官網有候選、但到店沒看到', '官網有列出攤位，這輪到店時沒有讀到這項道具，可能已售出、收攤，或是同名的其他道具 ID。', unseen);
    section('官網沒查完整', '這輪官網搜尋沒有完成，無法確認有沒有攤位，下一輪會再查。', unknown);
    if (!box.childElementCount) {
      box.append(el('p', { class: 'empty', text: (none.length + unseen.length + unknown.length) ? '沒有符合篩選條件的品名。' : '願望清單裡的道具這輪都有找到攤位。' }));
    }
    return none.length;
  }

  // ---- 組合 ----
  function setCount(name, n) {
    const c = D.querySelector(`[data-count="${name}"]`);
    if (c) c.textContent = n ? `（${n}）` : '';
  }
  function fillServers() {
    const sel = $('server');
    const servers = new Set([...data.listings.map((l) => l.server), ...(data.history || []).flatMap((h) => h.points.map((p) => p.server))]);
    const keep = view.server;
    sel.replaceChildren(
      el('option', { value: '', text: '全部伺服器' }),
      ...[...servers].sort().map((s) => el('option', { value: s, text: s })),
    );
    sel.value = servers.has(keep) ? keep : '';
    view.server = sel.value;
  }
  function renderBody() {
    setCount('now', renderNow());
    setCount('history', renderHistory());
    setCount('missing', renderMissing());
  }
  function render() {
    $('days').textContent = String(data.history_days || 60);
    renderHeader();
    fillServers();
    renderBody();
  }
  function selectTab(name) {
    view.tab = ['now', 'history', 'missing', 'about'].includes(name) ? name : 'now';
    for (const b of D.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === view.tab));
    for (const s of ['now', 'history', 'missing', 'about']) $(`tab-${s}`).hidden = s !== view.tab;
    $('filters').hidden = view.tab === 'about';
    if (view.tab === 'history') requestAnimationFrame(() => charts.forEach(([s, h]) => drawChart(s, h)));
  }

  function start() {
    let theme = storedTheme();
    applyTheme(theme);
    $('theme').addEventListener('click', () => {
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      try { localStorage.setItem('bm-theme', theme); } catch { /* 無法保存時只套用本次 */ }
      applyTheme(theme);
    });
    for (const b of D.querySelectorAll('[data-tab]')) {
      b.addEventListener('click', () => {
        selectTab(b.dataset.tab);
        history.replaceState(null, '', `#${b.dataset.tab}`);
      });
    }
    selectTab(location.hash.slice(1));
    let timer = 0;
    $('q').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { view.q = lower(e.target.value.trim()); if (data) renderBody(); }, 150);
    });
    $('server').addEventListener('change', (e) => { view.server = e.target.value; if (data) renderBody(); });
    $('reload').addEventListener('click', () => location.reload());
    let resize = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resize);
      resize = setTimeout(() => { if (view.tab === 'history') charts.forEach(([s, h]) => drawChart(s, h)); }, 120);
    });
    setInterval(renderHeader, 60000);
    if (http) {
      fetch(`version.txt?t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .then((t) => loadData(t.trim() || String(Date.now())))
        .catch(() => loadData(String(Date.now())));
      setInterval(poll, 120000);
    } else {
      loadData('local');
    }
  }

  start();
})();
