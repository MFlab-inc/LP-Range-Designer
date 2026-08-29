'use strict';
// 仕様書§8の実データスポットチェック。§5-3の正規CSV2本（Ethereum/Bitcoin）がリポジトリ直下に
// ローカルで存在する場合のみ実行する（.gitignoreによりCIには存在しない＝fail-closedではなくskip-explicit）。
// CIでは全件SKIPになることが期待される正常動作であり、失敗ではない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT, readIndexHtml, extractScriptContent, loadPureFunctions } = require('./lib/extract');

const ETH_PATH = path.join(REPO_ROOT, 'Ethereum_2016_11_27-2026_8_23_daily_merged_coinmarketcap.csv');
const BTC_PATH = path.join(REPO_ROOT, 'Bitcoin_2016_11_27-2026_8_23_daily_merged_coinmarketcap.csv');
const HAVE_ETH = fs.existsSync(ETH_PATH);
const HAVE_BTC = fs.existsSync(BTC_PATH);
const SKIP_MSG = 'ローカルに正規CSV(§5-3)が無いためSKIP（CIでは想定どおりの動作。§6参照）';

const fn = loadPureFunctions(extractScriptContent(readIndexHtml()));

function closeTo(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected≈${expected}±${tol}, actual=${actual}`);
}

let ethRows = null, btcRows = null;
function getEthRows() {
  if (!ethRows) ethRows = fn.parseCmcCsv(fs.readFileSync(ETH_PATH, 'utf8')).rows;
  return ethRows;
}
function getBtcRows() {
  if (!btcRows) btcRows = fn.parseCmcCsv(fs.readFileSync(BTC_PATH, 'utf8')).rows;
  return btcRows;
}

test('§8 中期設計: 正規CSV読込（ETH）＝3,557日・欠損ゼロ・警告ゼロ', t => {
  if (!HAVE_ETH) return t.skip(SKIP_MSG);
  const r = fn.parseCmcCsv(fs.readFileSync(ETH_PATH, 'utf8'));
  assert.equal(r.err, undefined);
  assert.equal(r.rows.length, 3557);
  assert.equal(r.warn.length, 0);
});

test('§8 中期設計: 正規CSV読込（BTC）＝3,557日・欠損ゼロ・警告ゼロ', t => {
  if (!HAVE_BTC) return t.skip(SKIP_MSG);
  const r = fn.parseCmcCsv(fs.readFileSync(BTC_PATH, 'utf8'));
  assert.equal(r.err, undefined);
  assert.equal(r.rows.length, 3557);
  assert.equal(r.warn.length, 0);
});

test('§8 中期設計: ETH単体・365日・90%・2022年以降 ≈ [-62%,+138%]・窓1,331個', t => {
  if (!HAVE_ETH) return t.skip(SKIP_MSG);
  const ser = fn.buildRelSeries(getEthRows(), null);
  const e = fn.excQuantiles(ser, 365, 0.9, '2022-01-01');
  assert.equal(e.err, undefined);
  assert.equal(e.n, 1331);
  closeTo(e.d, 0.62, 0.015, '下振れ分位');
  closeTo(e.u, 1.38, 0.015, '上振れ分位');
});

test('§8 中期設計: ETH÷BTC・90日・90%・2022年以降 ≈ [-28%,+32%]・窓1,606個', t => {
  if (!HAVE_ETH || !HAVE_BTC) return t.skip(SKIP_MSG);
  const ser = fn.buildRelSeries(getEthRows(), getBtcRows());
  const e = fn.excQuantiles(ser, 90, 0.9, '2022-01-01');
  assert.equal(e.err, undefined);
  assert.equal(e.n, 1606);
  closeTo(e.d, 0.28, 0.015, '下振れ分位');
  closeTo(e.u, 0.32, 0.015, '上振れ分位');
});

test('§8 中期設計: ETH÷BTC・730日・90%・2022年以降 ≈ [-71%,+23%]・窓966個', t => {
  if (!HAVE_ETH || !HAVE_BTC) return t.skip(SKIP_MSG);
  const ser = fn.buildRelSeries(getEthRows(), getBtcRows());
  const e = fn.excQuantiles(ser, 730, 0.9, '2022-01-01');
  assert.equal(e.err, undefined);
  assert.equal(e.n, 966);
  closeTo(e.d, 0.71, 0.015, '下振れ分位');
  closeTo(e.u, 0.23, 0.015, '上振れ分位');
});

test('§8 中期設計: ETH÷BTC・母集団σ（2022年以降）≈1.9〜2.0%', t => {
  if (!HAVE_ETH || !HAVE_BTC) return t.skip(SKIP_MSG);
  const ser = fn.buildRelSeries(getEthRows(), getBtcRows());
  const sd = fn.sigmaDailyPct(ser, '2022-01-01');
  closeTo(sd, 1.95, 0.2, '日次σ（母集団実測）');
});

test('§8 バックテスト: ETH単体・365日バンド・手数料なし（2022-01-01〜） LP≈49.8/50:50≈82.9/100%分子≈65.8', t => {
  if (!HAVE_ETH) return t.skip(SKIP_MSG);
  const ser = fn.buildRelSeries(getEthRows(), null);
  const e = fn.excQuantiles(ser, 365, 0.9, '2022-01-01');
  const d = Math.max(e.d, 0), u = Math.max(e.u, 0);
  const conc = 1 / (1 - Math.pow((1 - d) / (1 + u), 0.25));
  const s0 = ser.findIndex(r => fn.dayISO(r.day) >= '2022-01-01');
  const b = fn.backtestBand(ser, s0, d, u, 0, conc);
  assert.equal(b.err, undefined);
  closeTo(b.lpEx * 100, 49.8, 0.5, 'LP(手数料抜き)');
  closeTo(b.h5050 * 100, 82.9, 0.5, '50:50保有');
  closeTo(b.h100 * 100, 65.8, 0.5, '100%分子保有');
});
