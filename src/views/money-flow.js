// The money flow card in Analytics: a Sankey diagram drawn as inline SVG
// (no chart library does it, and one more dependency for one card is not
// worth it). Income sources on the left flow into one Income node, which
// flows out to expense categories and to what was saved on the right.
// Narrow screens get a two-column list instead, and a table under the
// diagram says the same in text for screen readers.

import { store } from '../store.js';
import { t, flow } from '../i18n.js';
import { h, clear, icon, money, refreshIcons, lang, categoryName } from '../ui.js';
import { sankeyData } from '../sankey.js';
import { addMonthsToMonth, firstDayOfMonth, formatMonth, lastDayOfMonth, monthOf } from '../dates.js';
import { segmented } from '../modals.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RANGES = ['last', 'this', 'period'];
const BAR = 12;
const BAND_GAP = 2;
const NODE_GAP = 6;
// A node is never shorter than two lines of its label, so labels never
// run into each other however small the amount.
const MIN_SLOT = 34;
const HUB_LABEL = 40;

let range = 'last';
let observer = null;

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, String(v));
  });
  children.flat().forEach(c => { if (c !== null && c !== undefined) el.appendChild(c instanceof Node ? c : document.createTextNode(String(c))); });
  return el;
}

// From and to of each range. 'last' is the last full month: the month in
// progress would show half a picture.
export function flowRange(which, today, periodFrom, periodTo) {
  const month = monthOf(today);
  if (which === 'this') return { from: firstDayOfMonth(month), to: lastDayOfMonth(month), label: formatMonth(month, lang()) };
  if (which === 'period') return { from: periodFrom, to: periodTo, label: t('flow-range-period') };
  const last = addMonthsToMonth(month, -1);
  return { from: firstDayOfMonth(last), to: lastDayOfMonth(last), label: formatMonth(last, lang()) };
}

function nodeLabel(node) {
  if (node.key === 'saved') return t('flow-saved');
  if (node.key === 'from-savings') return t('flow-from-savings');
  if (node.other) return t('flow-other', { n: node.count });
  return node.categoryId ? categoryName(node.categoryId) : t('no-category');
}

// A small share reads '<1%', never '0%' next to money that did move.
function percent(amount, total) {
  if (!total) return '';
  const p = Math.round((amount / total) * 100);
  return p === 0 && amount > 0 ? '<1%' : `${p}%`;
}

// Cuts a label to what fits beside the diagram (an estimate from the font
// size, measuring every label would cost a layout per node).
function fit(text, width, fontPx = 13) {
  const max = Math.max(4, Math.floor(width / (fontPx * 0.56)));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Positions of all nodes and bands. One scale for every column, so a band
// is as thick at both ends.
export function sankeyLayout(s, width) {
  const n = Math.max(s.sources.length, s.targets.length, 1);
  const labelW = Math.max(110, Math.min(220, Math.round(width * 0.25)));
  const xL = labelW;
  const xH = Math.round((width - BAR) / 2);
  const xR = width - labelW - BAR;
  const base = Math.min(520, Math.max(220, n * 40));
  const k = s.total ? base / s.total : 0;
  const thickness = (a) => Math.max(1.5, a * k);

  function column(nodes) {
    const slots = nodes.map(node => ({ node, w: thickness(node.amount) }));
    slots.forEach(x => { x.slot = Math.max(MIN_SLOT, x.w); });
    const height = slots.reduce((sum, x) => sum + x.slot, 0) + NODE_GAP * Math.max(0, slots.length - 1);
    return { slots, height };
  }
  const left = column(s.sources);
  const right = column(s.targets);
  const stack = (slots) => slots.reduce((sum, x) => sum + x.w, 0) + BAND_GAP * Math.max(0, slots.length - 1);
  const hubH = Math.max(stack(left.slots), stack(right.slots));
  const height = Math.ceil(Math.max(left.height, right.height, hubH) + HUB_LABEL + 8);
  const mid = HUB_LABEL + (height - HUB_LABEL) / 2;
  const hubY = mid - hubH / 2;

  function place(col, x, side) {
    let y = mid - col.height / 2;
    let band = hubY + (hubH - stack(col.slots)) / 2;
    return col.slots.map(c => {
      const nodeY = y + (c.slot - c.w) / 2;
      const item = { ...c.node, x, y: nodeY, h: c.w, labelY: y + c.slot / 2, bandY: band, side };
      y += c.slot + NODE_GAP;
      band += c.w + BAND_GAP;
      return item;
    });
  }
  return {
    width, height, labelW, xL, xH, xR, hubY, hubH,
    sources: place(left, xL, 'in'),
    targets: place(right, xR, 'out')
  };
}

// A band between two vertical edges, curved in the middle.
function bandPath(x1, y1, x2, y2, w) {
  const xm = (x1 + x2) / 2;
  return `M${x1},${y1} C${xm},${y1} ${xm},${y2} ${x2},${y2} L${x2},${y2 + w} C${xm},${y2 + w} ${xm},${y1 + w} ${x1},${y1 + w} Z`;
}

function drawSankey(wrap, s) {
  const width = Math.max(480, Math.floor(wrap.clientWidth || 800));
  const L = sankeyLayout(s, width);
  const tip = h('div', { class: 'sankey-tip', role: 'presentation' });
  const root = svg('svg', {
    class: 'sankey', width: L.width, height: L.height, viewBox: `0 0 ${L.width} ${L.height}`,
    role: 'img', 'aria-label': t('flow-aria', { income: money(s.income), expense: money(s.expense) })
  });

  function show(ev, lines, active) {
    root.classList.add('has-active');
    active.forEach(el => el.classList.add('is-active'));
    clear(tip);
    lines.forEach((line, i) => tip.appendChild(h('div', { class: i ? 'sankey-tip-sub' : 'sankey-tip-title' }, line)));
    tip.classList.add('is-visible');
    move(ev);
  }
  function move(ev) {
    const box = wrap.getBoundingClientRect();
    const x = ev.clientX - box.left;
    const y = ev.clientY - box.top;
    const tw = tip.offsetWidth || 180;
    tip.style.left = `${Math.max(4, Math.min(x + 14, box.width - tw - 4))}px`;
    tip.style.top = `${Math.max(4, y + 14)}px`;
  }
  function hide() {
    root.classList.remove('has-active');
    root.querySelectorAll('.is-active').forEach(el => el.classList.remove('is-active'));
    tip.classList.remove('is-visible');
  }

  const links = svg('g', { class: 'sankey-links' });
  const nodes = svg('g', { class: 'sankey-nodes' });
  const labels = svg('g', { class: 'sankey-labels' });
  const hub = svg('rect', { class: 'sankey-node is-hub', x: L.xH, y: L.hubY, width: BAR, height: Math.max(1, L.hubH), rx: 3 });
  const hubName = t('an-income');

  function add(node) {
    const isIn = node.side === 'in';
    const kind = node.key === 'saved' ? 'is-saved' : node.key === 'from-savings' ? 'is-savings' : '';
    const name = nodeLabel(node);
    const path = isIn
      ? bandPath(node.x + BAR, node.y, L.xH, node.bandY, node.h)
      : bandPath(L.xH + BAR, node.bandY, node.x, node.y, node.h);
    const rect = svg('rect', { class: `sankey-node ${isIn ? 'is-in' : 'is-out'} ${kind}`, x: node.x, y: node.y, width: BAR, height: node.h, rx: Math.min(3, node.h / 2) });
    const link = svg('path', { class: `sankey-link ${isIn ? 'is-in' : 'is-out'} ${kind}`, d: path });
    const lines = [isIn ? flow(name, hubName) : flow(hubName, name), `${money(node.amount)} · ${percent(node.amount, s.total)}`];
    if (node.key === 'saved' && s.toGoals) lines.push(t('flow-to-goals', { amount: money(s.toGoals) }));
    if (node.other) lines.push(t('flow-other-hint', { n: node.count }));
    [link, rect].forEach(el => {
      el.addEventListener('mouseenter', (ev) => show(ev, lines, [link, rect]));
      el.addEventListener('mousemove', move);
      el.addEventListener('mouseleave', hide);
    });
    links.appendChild(link);
    nodes.appendChild(rect);
    const tx = isIn ? node.x - 8 : node.x + BAR + 8;
    const room = L.labelW - 14;
    labels.appendChild(svg('text', { class: 'sankey-label', x: tx, y: node.labelY - 3, 'text-anchor': isIn ? 'end' : 'start' }, fit(name, room)));
    labels.appendChild(svg('text', { class: 'sankey-amount', x: tx, y: node.labelY + 13, 'text-anchor': isIn ? 'end' : 'start' },
      fit(`${money(node.amount, { decimals: false })} · ${percent(node.amount, s.total)}`, room, 12)));
  }
  L.sources.forEach(add);
  L.targets.forEach(add);
  nodes.appendChild(hub);
  labels.appendChild(svg('text', { class: 'sankey-label', x: L.xH + BAR / 2, y: L.hubY - 22, 'text-anchor': 'middle' }, hubName));
  labels.appendChild(svg('text', { class: 'sankey-amount', x: L.xH + BAR / 2, y: L.hubY - 7, 'text-anchor': 'middle' }, money(s.income, { decimals: false })));

  root.append(links, nodes, labels);
  clear(wrap);
  wrap.append(root, tip);
}

// The two-column list that replaces the diagram on narrow screens.
function flowList(s) {
  const col = (title, nodes) => h('div', { class: 'flow-col' },
    h('div', { class: 'flow-col-title' }, title),
    nodes.map(n => h('div', { class: `flow-row ${n.key === 'saved' ? 'is-saved' : ''}` },
      h('span', { class: 'flow-name' }, nodeLabel(n)),
      h('span', { class: 'flow-amount money' }, money(n.amount)),
      h('span', { class: 'flow-share muted' }, percent(n.amount, s.total)))));
  return h('div', { class: 'flow-list' }, col(t('flow-came-in'), s.sources), col(t('flow-went-out'), s.targets));
}

function flowTable(s) {
  const hubName = t('an-income');
  const rows = s.sources.map(n => [nodeLabel(n), hubName, n.amount]).concat(s.targets.map(n => [hubName, nodeLabel(n), n.amount]));
  return h('details', { class: 'flow-table' },
    h('summary', {}, t('flow-as-table')),
    h('div', { class: 'table-scroll' }, h('table', { class: 'an-table' },
      h('caption', { class: 'visually-hidden' }, t('flow-title')),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('flow-from')), h('th', { scope: 'col' }, t('flow-to')),
        h('th', { scope: 'col', class: 'num' }, t('an-period-total')), h('th', { scope: 'col', class: 'num' }, t('an-share')))),
      h('tbody', {}, rows.map(([from, to, amount]) => h('tr', {},
        h('td', {}, from), h('td', {}, to),
        h('td', { class: 'num money' }, money(amount)),
        h('td', { class: 'num muted' }, percent(amount, s.total))))))));
}

// The card for the Analytics screen. periodFrom / periodTo are the days of
// the Analytics period, one of the three ranges the card offers.
export function moneyFlowCard(today, periodFrom, periodTo) {
  if (observer) { observer.disconnect(); observer = null; }
  const body = h('div', { class: 'flow-body' });
  const card = h('div', { class: 'card flow-card' },
    h('div', { class: 'card-title-row flow-head' }, icon('waypoints'), h('h3', {}, t('flow-title')),
      segmented(RANGES.map(r => ({ value: r, label: t(`flow-range-${r}`) })), range, (v) => { range = v; fill(); })),
    body);

  function fill() {
    const r = flowRange(range, today, periodFrom, periodTo);
    const s = sankeyData(store.data, r.from, r.to);
    clear(body);
    if (s.empty) {
      body.appendChild(h('p', { class: 'muted small' }, t('flow-empty')));
      return;
    }
    const wrap = h('div', { class: 'sankey-wrap' });
    body.append(
      h('p', { class: 'field-hint' }, t(s.saved ? 'flow-summary-saved' : s.fromSavings ? 'flow-summary-short' : 'flow-summary-even',
        { range: r.label, income: money(s.income), expense: money(s.expense), amount: money(s.saved || s.fromSavings) })),
      wrap, flowList(s), flowTable(s));
    // The diagram needs its real width, which it has only in the page.
    requestAnimationFrame(() => { if (wrap.isConnected) drawSankey(wrap, s); });
    if (observer) observer.disconnect();
    if (typeof window.ResizeObserver === 'function') {
      let lastWidth = 0;
      observer = new window.ResizeObserver(() => {
        if (!wrap.isConnected) { observer?.disconnect(); return; }
        const w = Math.floor(wrap.clientWidth);
        if (w && Math.abs(w - lastWidth) > 4) { lastWidth = w; drawSankey(wrap, s); }
      });
      observer.observe(wrap);
    }
    refreshIcons();
  }
  fill();
  return card;
}
