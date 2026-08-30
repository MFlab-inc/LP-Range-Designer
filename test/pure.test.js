'use strict';
// 仕様書§6：index.htmlのマーカー区間から純関数を抽出し、合成データ（CI安全・実データ不要）で検証する。
// 実CSVによる§8スポットチェックの厳密値照合はdata-regression.test.jsが担当する（ローカルCSVが無ければSKIP）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readIndexHtml, extractScriptContent, loadPureFunctions } = require('./lib/extract');
const { buildCsv, buildConstantRatioCsv } = require('./lib/fixtures');

const html = readIndexHtml();
const script = extractScriptContent(html);
const fn = loadPureFunctions(script);

test('parseCmcCsv: 正常な合成CSV（20日・欠損ゼロ）', () => {
  const csv = buildConstantRatioCsv(20);
  const r = fn.parseCmcCsv(csv);
  assert.equal(r.err, undefined);
  assert.equal(r.rows.length, 20);
  // r.warnはvmサンドボックス内で生成された配列のため、realmをまたぐdeepEqualではなくlengthで比較する。
  assert.equal(r.warn.length, 0);
});

test('parseCmcCsv: 必須列欠落はエラー', () => {
  const bad = 'timeOpen;open;high;low\n"2024-01-01T00:00:00.000Z";1;1;1';
  const r = fn.parseCmcCsv(bad);
  assert.ok(r.err);
});

test('parseCmcCsv: 有効データ15日未満はエラー', () => {
  const csv = buildConstantRatioCsv(10);
  const r = fn.parseCmcCsv(csv);
  assert.ok(r.err);
});

test('parseCmcCsv: 重複日付・不正行は除外され警告が出る', () => {
  const base = buildConstantRatioCsv(20).split('\n');
  const header = base[0];
  const dupRow = base[1]; // 先頭データ行を複製して重複日付を作る
  const badRow = '"2099-13-40T00:00:00.000Z";"x";"x";"x";"BAD";-1;-1;-1;-1;0;0;0;"x"'; // 不正な数値/日付
  const csv = [header, ...base.slice(1), dupRow, badRow].join('\n');
  const r = fn.parseCmcCsv(csv);
  assert.equal(r.err, undefined);
  assert.equal(r.rows.length, 20); // 重複1件・不正1件は除外
  assert.ok(r.warn.some(w => w.includes('重複日付')));
  assert.ok(r.warn.some(w => w.includes('不正')));
});

test('sampleStdev: 既知の配列で厳密値と一致', () => {
  assert.equal(fn.sampleStdev([1, 2, 3]), 1);
});

test('sampleStdev: 定数配列は分散ゼロ', () => {
  assert.equal(fn.sampleStdev([5, 5, 5, 5, 5]), 0);
});

test('computeRealized: 対数リターンが完全一定ならσ14=0、30日未満ならσ30=NaN', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ day: i, o: 100 * Math.pow(1.01, i), h: 101, l: 99, c: 100 }));
  const warn = [];
  const r = fn.computeRealized(rows, warn);
  assert.equal(r.nRet, 19);
  assert.ok(Math.abs(r.s14) < 1e-9);
  assert.ok(Number.isNaN(r.s30));
});

test('computeRealized: 日付ギャップは除外され警告が出る', () => {
  const rows = [
    { day: 0, o: 100, h: 101, l: 99, c: 100 },
    { day: 1, o: 101, h: 102, l: 100, c: 101 },
    { day: 3, o: 103, h: 104, l: 102, c: 103 }, // day2欠落＝ギャップ
  ];
  const warn = [];
  const r = fn.computeRealized(rows, warn);
  assert.equal(r.nRet, 1); // day0→1のみ有効、day1→3はギャップで除外
  assert.ok(warn.some(w => w.includes('ギャップ')));
});

test('buildRelSeries: 分母ありは比率、分母なしはそのまま', () => {
  const num = [{ day: 1, o: 10 }, { day: 2, o: 20 }, { day: 3, o: 30 }];
  const den = [{ day: 1, o: 2 }, { day: 2, o: 4 }, { day: 3, o: 5 }];
  const rel = fn.buildRelSeries(num, den);
  assert.deepEqual(rel.map(r => r.o), [5, 5, 6]);
  const passthrough = fn.buildRelSeries(num, null);
  assert.deepEqual(passthrough.map(r => r.o), [10, 20, 30]);
});

test('sigmaDailyPct: fromISOで対象期間を絞ると分散が変わる', () => {
  // 前半10日は乱高下、day9以降(=day10からの計算区間)は完全にフラット
  const ser = [];
  for (let i = 0; i < 10; i++) ser.push({ day: i, o: i % 2 === 0 ? 100 : 105 });
  for (let i = 10; i < 30; i++) ser.push({ day: i, o: 105 });
  const fromISO = fn.dayISO(10);
  const filtered = fn.sigmaDailyPct(ser, fromISO);
  const whole = fn.sigmaDailyPct(ser, null);
  assert.equal(filtered, 0);
  assert.ok(whole > 0);
});

test('excQuantiles: 窓数20未満はエラー', () => {
  const ser = Array.from({ length: 20 }, (_, i) => ({ day: i, o: 100 * (1 + 0.05 * Math.sin(i / 3)) }));
  const e = fn.excQuantiles(ser, 5, 0.8, null); // 窓数=20-5=15<20
  assert.ok(e.err);
});

test('excQuantiles: 窓数ちょうど20は成功、被覆率90%は50%以上', () => {
  const ser = Array.from({ length: 25 }, (_, i) => ({ day: i, o: 100 * (1 + 0.05 * Math.sin(i / 3)) }));
  const e = fn.excQuantiles(ser, 5, 0.9, null); // 窓数=25-5=20
  assert.equal(e.err, undefined);
  assert.equal(e.n, 20);
  assert.ok(e.u >= e.u50);
  assert.ok(e.d >= e.d50);
});

test('v3ValuePerL: 下限・上限・クランプ・中間点で式どおりの値', () => {
  const sa = 2, sb = 3; // Pl=4, Pu=9
  assert.ok(Math.abs(fn.v3ValuePerL(4, sa, sb) - (4 * 1 / 6)) < 1e-9);
  assert.ok(Math.abs(fn.v3ValuePerL(9, sa, sb) - 1) < 1e-9);
  assert.ok(Math.abs(fn.v3ValuePerL(1, sa, sb) - (1 / 6)) < 1e-9); // 下限未満はsaにクランプ
  assert.ok(Math.abs(fn.v3ValuePerL(6.25, sa, sb) - 0.9166666667) < 1e-6);
});

test('backtestBand: レンジ外で即時再センタリング、手数料ゼロ時のfeeSumは厳密ゼロ', () => {
  const ser = [
    { day: 0, o: 100 }, { day: 1, o: 100 }, { day: 2, o: 105 },
    { day: 3, o: 120 }, { day: 4, o: 120 }, { day: 5, o: 60 },
  ];
  const b = fn.backtestBand(ser, 0, 0.1, 0.1, 0, 1);
  assert.equal(b.err, undefined);
  assert.equal(b.resU, 1);
  assert.equal(b.resD, 1);
  assert.equal(b.days, 5);
  assert.equal(b.feeSum, 0);
  assert.ok(Math.abs(b.util - 0.6) < 1e-9);
  assert.ok(isFinite(b.lpEx) && b.lpEx > 0);
});

test('parsePoolJson: 正常応答からVol/TVL/手数料階層を抽出', () => {
  const p = fn.parsePoolJson({
    data: { attributes: {
      name: 'WETH / USDC 0.3%', volume_usd: { h24: 123456 }, reserve_in_usd: 987654,
      base_token_price_quote_token: '1234.5',
    } },
  });
  assert.equal(p.err, undefined);
  assert.equal(p.vol, 123456);
  assert.equal(p.tvl, 987654);
  assert.equal(p.fee, 0.003);
  assert.equal(p.priceQuote, 1234.5);
});

test('parsePoolJson: Vol/TVLが0以下やレスポンス欠落はエラー', () => {
  assert.ok(fn.parsePoolJson({}).err);
  assert.ok(fn.parsePoolJson({ data: { attributes: { volume_usd: { h24: 0 }, reserve_in_usd: 100 } } }).err);
});

test('p3UpStage: days=0はレンジ内表示', () => {
  const s = fn.p3UpStage(0);
  assert.equal(s.days, 0);
  assert.equal(s.warn, false);
  assert.match(s.label, /レンジ内/);
});

test('p3UpStage: days=1は50%再展開の目安（1日目）', () => {
  const s = fn.p3UpStage(1);
  assert.equal(s.days, 1);
  assert.equal(s.warn, true);
  assert.match(s.label, /50%再展開/);
  assert.doesNotMatch(s.label, /残り/);
});

test('p3UpStage: days=2以上は残り50%再展開の目安（継続）', () => {
  const s2 = fn.p3UpStage(2);
  assert.equal(s2.days, 2);
  assert.match(s2.label, /残り50%再展開/);
  const s5 = fn.p3UpStage(5);
  assert.equal(s5.days, 5);
  assert.match(s5.label, /残り50%再展開/);
});

test('p3UpStage: 負数・非数値・空文字は0（レンジ内）扱い', () => {
  assert.equal(fn.p3UpStage(-3).days, 0);
  assert.equal(fn.p3UpStage('abc').days, 0);
  assert.equal(fn.p3UpStage('').days, 0);
  assert.equal(fn.p3UpStage(undefined).days, 0);
  assert.equal(fn.p3UpStage(NaN).days, 0);
});

test('p3UpStage: 小数は切り捨て', () => {
  assert.equal(fn.p3UpStage(1.9).days, 1);
  assert.equal(fn.p3UpStage(2.9).days, 2);
  assert.equal(fn.p3UpStage('2.1').days, 2);
});

test('p3DnStage: state=0はレンジ内表示（isRelativeに関わらず注記なし）', () => {
  const s = fn.p3DnStage('0', false);
  assert.equal(s.state, 0);
  assert.equal(s.warn, false);
  assert.match(s.label, /レンジ内/);
  const sRel = fn.p3DnStage('0', true);
  assert.doesNotMatch(sRel.label, /第三の資産/);
});

test('p3DnStage: state=1は下限割れ確定・ステーブル退避の指示', () => {
  const s = fn.p3DnStage('1', false);
  assert.equal(s.state, 1);
  assert.equal(s.warn, true);
  assert.match(s.label, /下限割れ確定/);
  assert.match(s.label, /再センタリング禁止/);
  assert.doesNotMatch(s.label, /第三の資産/);
});

test('p3DnStage: state=2はステーブル化済み・継続の指示', () => {
  const s = fn.p3DnStage('2', false);
  assert.equal(s.state, 2);
  assert.equal(s.warn, true);
  assert.match(s.label, /ステーブル化済み/);
  assert.match(s.label, /再センタリング禁止を継続/);
});

test('p3DnStage: isRelative=trueは第三資産への退避注意が両状態に付く', () => {
  const s1 = fn.p3DnStage('1', true);
  assert.match(s1.label, /第三の資産/);
  const s2 = fn.p3DnStage('2', true);
  assert.match(s2.label, /第三の資産/);
});

test('p3DnStage: 想定外値（未選択・非対応値）は中立表示にフォールバックし、レンジ内表示は流用しない', () => {
  const blank = fn.p3DnStage('', false);
  assert.equal(blank.state, null);
  assert.equal(blank.warn, false);
  assert.match(blank.label, /選択してください/);
  assert.doesNotMatch(blank.label, /レンジ内/);

  const undef = fn.p3DnStage(undefined, false);
  assert.equal(undef.state, null);
  assert.match(undef.label, /選択してください/);

  const bogus = fn.p3DnStage('3', false);
  assert.equal(bogus.state, null);
  assert.match(bogus.label, /選択してください/);
});

test('parsePoolJson: 既知の手数料階層以外はfee=null', () => {
  const p = fn.parsePoolJson({
    data: { attributes: { name: 'FOO/BAR 2.5%', volume_usd: { h24: 1 }, reserve_in_usd: 1 } },
  });
  assert.equal(p.err, undefined);
  assert.equal(p.fee, null);
});
