'use strict';
// 仕様書§6の方法論（マーカー抽出＋コア7関数md5照合）をindex.htmlに対して実行するための共有ユーティリティ。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const REPO_ROOT = path.join(__dirname, '..', '..');
const INDEX_HTML_PATH = path.join(REPO_ROOT, 'index.html');

const MARK_START = '/* ==== v1.1 実測σ（CMC日足CSV）ここから ==== */';
const MARK_END = '/* ==== v1.1 実測σ ここまで（純関数） ==== */';

const CORE_FUNCTION_NAMES = ['calc', 'drawRail', 'verdict', 'preset', 'mode', 'row'];
const PURE_EXPORT_NAMES = [
  'parseCmcCsv', 'sampleStdev', 'computeRealized', 'dayISO',
  'buildRelSeries', 'sigmaDailyPct', 'excQuantiles',
  'v3ValuePerL', 'backtestBand', 'parsePoolJson',
];

function readIndexHtml() {
  return fs.readFileSync(INDEX_HTML_PATH, 'utf8');
}

function extractScriptContent(html) {
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('index.htmlに<script>タグが見つかりません');
  return m[1];
}

function md5(text) {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

// srcのopenIdx（'{'の位置）から対応する閉じ'}'の位置を返す。文字列/テンプレートリテラル内は無視する。
function extractBalanced(src, openIdx) {
  if (src[openIdx] !== '{') throw new Error('openIdxは"{"を指していません');
  let depth = 0;
  let inStr = null;
  let esc = false;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('括弧の対応が取れませんでした');
}

// `function name(...)...{...}` 形式の関数ソースをブレースバランスで抽出する。
function extractFunctionSource(src, name) {
  const sigRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = sigRe.exec(src);
  if (!m) throw new Error('関数シグネチャが見つかりません: ' + name);
  const braceIdx = m.index + m[0].length - 1;
  const endIdx = extractBalanced(src, braceIdx);
  return src.slice(m.index, endIdx + 1);
}

// fmt は `const fmt=(x,d=2)=>...;` の1行のみで、ブレース抽出だとオブジェクトリテラルで止まるため専用処理。
function extractFmtSource(src) {
  const m = /^const fmt=.*$/m.exec(src);
  if (!m) throw new Error('fmtの定義が見つかりません');
  return m[0];
}

function extractCoreSources(scriptSrc) {
  const out = {};
  for (const name of CORE_FUNCTION_NAMES) out[name] = extractFunctionSource(scriptSrc, name);
  out.fmt = extractFmtSource(scriptSrc);
  return out;
}

function coreHashes(scriptSrc) {
  const sources = extractCoreSources(scriptSrc);
  const hashes = {};
  for (const [name, src] of Object.entries(sources)) hashes[name] = md5(src);
  return hashes;
}

function extractMarkerBlock(src) {
  const s = src.indexOf(MARK_START);
  const e = src.indexOf(MARK_END);
  if (s < 0 || e < 0 || e < s) throw new Error('純関数マーカー区間が見つかりません');
  return src.slice(s, e + MARK_END.length);
}

// マーカー区間のみをvmサンドボックスで評価し、純関数群をエクスポートする（DOM非依存）。
function loadPureFunctions(scriptSrc) {
  const block = extractMarkerBlock(scriptSrc);
  const sandbox = {};
  vm.createContext(sandbox);
  const code = block + '\n;this.__exports = {' + PURE_EXPORT_NAMES.join(',') + '};';
  vm.runInContext(code, sandbox, { filename: 'marker-block.js' });
  return sandbox.__exports;
}

module.exports = {
  REPO_ROOT,
  INDEX_HTML_PATH,
  CORE_FUNCTION_NAMES,
  PURE_EXPORT_NAMES,
  readIndexHtml,
  extractScriptContent,
  md5,
  extractBalanced,
  extractFunctionSource,
  extractFmtSource,
  extractCoreSources,
  coreHashes,
  extractMarkerBlock,
  loadPureFunctions,
};
