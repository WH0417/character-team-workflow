#!/usr/bin/env node
'use strict';

// Usage: node render-flowcharts.cjs input.json output.svg [output.png]
// Rows and columns are zero-based integers. No dependencies are needed for SVG.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const NODE_W = 180, NODE_H = 64, COL_GAP = 72, ROW_GAP = 76, PAD = 40;
const PALETTES = [
  { fill: '#eaf4ff', stroke: '#3178bb', accent: '#174b7b' },
  { fill: '#eaf7f0', stroke: '#328065', accent: '#205e48' },
  { fill: '#fff3e4', stroke: '#b87528', accent: '#805018' },
];

function xml(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function wrapText(value, maxUnits) {
  const lines = [];
  for (const paragraph of String(value).split(/\r?\n/)) {
    let line = '', units = 0;
    for (const character of paragraph) {
      const width = /[\u0000-\u00ff]/u.test(character) ? 1 : 2;
      if (line && units + width > maxUnits) {
        lines.push(line.trimEnd());
        line = '';
        units = 0;
      }
      line += character;
      units += width;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function textBlock(lines, x, y, options = {}) {
  const { size = 14, lineHeight = 20, color = '#203246', weight = 400, anchor = 'middle' } = options;
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? lineHeight : 0}">${xml(line)}</tspan>`).join('')}</text>`;
}

function checkString(value, location, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${location} must be a nonempty string`);
  return value;
}

function prepareChart(chart, index) {
  if (!chart || !Array.isArray(chart.nodes) || !chart.nodes.length) throw new Error(`charts[${index}].nodes must be a nonempty array`);
  if (chart.edges !== undefined && !Array.isArray(chart.edges)) throw new Error(`charts[${index}].edges must be an array`);
  const ids = new Map(), cells = new Set();
  const nodes = chart.nodes.map((node, i) => {
    const location = `charts[${index}].nodes[${i}]`;
    if (!node || typeof node !== 'object') throw new Error(`${location} must be an object`);
    const id = checkString(node.id, `${location}.id`);
    if (ids.has(id)) throw new Error(`Duplicate node id: ${id}`);
    for (const key of ['row', 'col']) {
      if (!Number.isInteger(node[key]) || node[key] < 0) throw new Error(`${location}.${key} must be a nonnegative integer`);
    }
    const cell = `${node.row},${node.col}`;
    if (cells.has(cell)) throw new Error(`Two nodes occupy row,col ${cell}`);
    cells.add(cell);
    const lines = wrapText(checkString(node.label, `${location}.label`), 22);
    const result = { ...node, id, lines, h: Math.max(NODE_H, lines.length * 20 + 24) };
    ids.set(id, result);
    return result;
  });
  const edges = (chart.edges || []).map((edge, i) => {
    const location = `charts[${index}].edges[${i}]`;
    if (!edge || !ids.has(edge.from) || !ids.has(edge.to)) throw new Error(`${location} references an unknown node id`);
    if (edge.label !== undefined && typeof edge.label !== 'string') throw new Error(`${location}.label must be a string`);
    if (edge.dashed !== undefined && typeof edge.dashed !== 'boolean') throw new Error(`${location}.dashed must be boolean`);
    return { ...edge, source: ids.get(edge.from), target: ids.get(edge.to) };
  });
  for (const edge of edges) {
    edge.bidirectional = edge.from !== edge.to && edges.some(other => other.from === edge.to && other.to === edge.from);
  }
  const rows = Math.max(...nodes.map(n => n.row)) + 1;
  const cols = Math.max(...nodes.map(n => n.col)) + 1;
  if (rows > 100 || cols > 30 || nodes.length > 300) throw new Error('Chart exceeds the supported grid size (100 rows, 30 columns, 300 nodes)');
  const heights = Array.from({ length: rows }, (_, row) => Math.max(NODE_H, ...nodes.filter(n => n.row === row).map(n => n.h)));
  let nextY = 0;
  const offsets = heights.map(height => { const y = nextY; nextY += height + ROW_GAP; return y; });
  for (const node of nodes) {
    node.x = PAD + node.col * (NODE_W + COL_GAP);
    node.y = offsets[node.row] + (heights[node.row] - node.h) / 2;
  }
  return {
    title: checkString(chart.title, `charts[${index}].title`, `流程 ${index + 1}`),
    nodes, edges,
    width: PAD * 2 + cols * NODE_W + (cols - 1) * COL_GAP,
    graphHeight: nextY - ROW_GAP,
  };
}

function edgePath(edge) {
  const a = edge.source, b = edge.target;
  if (a === b) {
    const x = a.x + NODE_W, y = a.y + a.h / 2;
    return { d: `M ${x} ${y - 12} H ${x + 27} V ${y + 12} H ${x + 3}`, lx: x + 31, ly: y, anchor: 'start' };
  }
  if (a.row === b.row) {
    const direction = b.col > a.col ? 1 : -1;
    const lane = edge.bidirectional ? direction * -12 : 0;
    const x1 = a.x + (direction > 0 ? NODE_W : 0), x2 = b.x + (direction > 0 ? -3 : NODE_W + 3);
    const y1 = a.y + a.h / 2 + lane, y2 = b.y + b.h / 2 + lane;
    // Adjacent nodes connect across the column gap; longer edges use the row gap.
    if (Math.abs(a.col - b.col) === 1) return { d: `M ${x1} ${y1} H ${(x1 + x2) / 2} V ${y2} H ${x2}`, lx: (x1 + x2) / 2, ly: Math.min(y1, y2) - 12 };
    const bendY = Math.max(a.y + a.h, b.y + b.h) + 24 + lane;
    return { d: `M ${x1} ${y1} H ${x1 + direction * 20} V ${bendY} H ${x2 - direction * 20} V ${y2} H ${x2}`, lx: (x1 + x2) / 2, ly: bendY - 8 };
  }
  const down = b.row > a.row;
  const lane = edge.bidirectional ? (down ? -12 : 12) : 0;
  const x1 = a.x + NODE_W / 2 + lane, x2 = b.x + NODE_W / 2 + lane;
  const y1 = a.y + (down ? a.h : 0), y2 = b.y + (down ? -3 : b.h + 3);
  if (Math.abs(a.row - b.row) === 1) {
    const bendY = (y1 + y2) / 2 + lane;
    return { d: `M ${x1} ${y1} V ${bendY} H ${x2} V ${y2}`, lx: (x1 + x2) / 2 + (x1 === x2 ? 12 : 0), ly: bendY - 8, anchor: x1 === x2 ? 'start' : 'middle' };
  }
  // Skip-row and feedback edges take an outer channel to avoid intervening boxes.
  const channelX = Math.min(a.x, b.x) - 24 + lane;
  const firstY = y1 + (down ? 20 : -20), lastY = y2 + (down ? -20 : 20);
  return { d: `M ${x1} ${y1} V ${firstY} H ${channelX} V ${lastY} H ${x2} V ${y2}`, lx: channelX - 8, ly: (firstY + lastY) / 2, anchor: 'end' };
}

function render(data) {
  if (!data || !Array.isArray(data.charts) || !data.charts.length) throw new Error('charts must be a nonempty array');
  const charts = data.charts.map(prepareChart);
  const width = Math.max(560, ...charts.map(c => c.width + 48));
  const title = wrapText(checkString(data.title, 'title', '流程图'), Math.floor((width - 96) / 14));
  const note = data.note === undefined ? [] : wrapText(checkString(data.note, 'note'), Math.floor((width - 96) / 6.5));
  let y = 40 + title.length * 34 + 20;
  const content = [textBlock(title, 36, 45, { size: 28, lineHeight: 34, weight: 700, anchor: 'start' })];
  charts.forEach((chart, index) => {
    const palette = PALETTES[index % PALETTES.length];
    const heading = wrapText(chart.title, Math.floor((width - 112) / 10));
    const headingHeight = heading.length * 26;
    const height = headingHeight + 36 + chart.graphHeight + 40;
    const offsetX = (width - chart.width) / 2;
    content.push(`<rect x="24" y="${y}" width="${width - 48}" height="${height}" rx="18" fill="#ffffff" stroke="#d8e1ea"/>`);
    content.push(textBlock(heading, 48, y + 33, { size: 19, lineHeight: 26, weight: 700, color: palette.accent, anchor: 'start' }));
    content.push(`<g transform="translate(${offsetX} ${y + headingHeight + 28})">`);
    for (const edge of chart.edges) {
      const route = edgePath(edge);
      content.push(`<path d="${route.d}" fill="none" stroke="#62758a" stroke-width="2" stroke-linejoin="round"${edge.dashed ? ' stroke-dasharray="7 5"' : ''} marker-end="url(#arrow)"/>`);
    }
    for (const node of chart.nodes) {
      content.push(`<rect x="${node.x}" y="${node.y}" width="${NODE_W}" height="${node.h}" rx="11" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.6"/>`);
      content.push(textBlock(node.lines, node.x + NODE_W / 2, node.y + node.h / 2 - (node.lines.length - 1) * 10 + 5, { weight: 500 }));
    }
    for (const edge of chart.edges) {
      if (!edge.label) continue;
      const route = edgePath(edge), lines = wrapText(edge.label, 18);
      const labelWidth = Math.max(...lines.map(line => [...line].reduce((n, c) => n + (/[\u0000-\u00ff]/u.test(c) ? 6 : 12), 0))) + 12;
      const left = route.anchor === 'start' ? route.lx - 5 : route.anchor === 'end' ? route.lx - labelWidth + 6 : route.lx - labelWidth / 2;
      content.push(`<rect x="${left}" y="${route.ly - 13}" width="${labelWidth}" height="${lines.length * 17 + 3}" rx="4" fill="#ffffff" fill-opacity="0.95"/>`);
      content.push(textBlock(lines, route.lx, route.ly, { size: 12, lineHeight: 17, color: '#45596d', anchor: route.anchor || 'middle' }));
    }
    content.push('</g>');
    y += height + 24;
  });
  if (note.length) {
    content.push(textBlock(note, 36, y + 2, { size: 13, lineHeight: 20, color: '#5e6f81', anchor: 'start' }));
    y += note.length * 20 + 20;
  }
  const height = Math.ceil(y + 12);
  return { width, height, svg: `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(data.title || '流程图')}">\n<title>${xml(data.title || '流程图')}</title>\n<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#62758a"/></marker></defs>\n<rect width="100%" height="100%" fill="#f3f6fa"/>\n<g font-family="Microsoft YaHei, Noto Sans CJK SC, Arial, sans-serif">${content.join('\n')}</g>\n</svg>\n` };
}

async function main() {
  const [input, svgOutput, pngOutput, ...extra] = process.argv.slice(2);
  if (!input || !svgOutput || extra.length) throw new Error('Usage: node render-flowcharts.cjs input.json output.svg [output.png]');
  const data = JSON.parse((await fs.readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
  const result = render(data);
  await fs.mkdir(path.dirname(path.resolve(svgOutput)), { recursive: true });
  await fs.writeFile(svgOutput, result.svg, 'utf8');
  console.log(`SVG: ${path.resolve(svgOutput)} (${result.width} × ${result.height})`);
  if (pngOutput) {
    const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || 'C:/Users/Administrator.DESKTOP-5E2BHJ2/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
    const browser = await playwright.chromium.launch({
      executablePath: process.env.EDGE_EXECUTABLE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: true,
    });
    try {
      await fs.mkdir(path.dirname(path.resolve(pngOutput)), { recursive: true });
      const page = await browser.newPage({ viewport: { width: result.width, height: Math.min(result.height, 1200) }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(path.resolve(svgOutput)).href);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('svg').screenshot({ path: pngOutput, animations: 'disabled' });
      console.log(`PNG: ${path.resolve(pngOutput)}`);
    } finally {
      await browser.close();
    }
  }
}

main().catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
