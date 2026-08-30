'use strict';
// DOMスタブ（getElementByIdスタブ＋fetch/FileReaderスタブ）でindex.html全体のUI配線を疎通確認する。
// 数値の厳密検証はpure.test.js／data-regression.test.jsが担当し、ここでは「配線が正しく動くか」のみを見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readIndexHtml, extractScriptContent } = require('./lib/extract');
const { createDomEnv } = require('./lib/domEnv');
const { buildOscillatingCsv } = require('./lib/fixtures');

const html = readIndexHtml();
const script = extractScriptContent(html);

function loadUi() {
  const env = createDomEnv();
  const sandbox = {
    document: env.document,
    fetch: env.fetch,
    FileReader: env.FileReader,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(sandbox);
  // MODEは元スクリプト内のトップレベルletのため、同一コンパイル単位からgetter経由で読む。
  const exportLine = '\n;this.__ui = {setMode, calc, preset, gpGo, getMode: function(){return MODE;}};';
  vm.runInContext(script + exportLine, sandbox, { filename: 'index-script.js' });
  return { env, ui: sandbox.__ui };
}

const tick = () => new Promise(r => setImmediate(r));

test('初期ロード：モードA（設計）の判定台帳が例外なく描画される', () => {
  const { env } = loadUi();
  const out = env.get('out');
  assert.match(out.innerHTML, /推奨レンジ/);
});

test('setMode: タブ切替でpane表示とaria-selectedが連動する', () => {
  const { env, ui } = loadUi();
  ui.setMode('B');
  assert.equal(env.get('paneA').hidden, true);
  assert.equal(env.get('paneB').hidden, false);
  assert.equal(env.get('tabA').getAttribute('aria-selected'), 'false');
  assert.equal(env.get('tabB').getAttribute('aria-selected'), 'true');
  assert.equal(ui.getMode(), 'B');
});

test('setMode(C): 出口ラベルが分子/分母表記に切替わり、未読込プレースホルダを表示', () => {
  const { env, ui } = loadUi();
  ui.setMode('C');
  assert.equal(env.get('exdn').textContent, '▼下抜け＝分子資産100%');
  assert.equal(env.get('exup').textContent, '上抜け＝分母側100%▲');
  assert.match(env.get('out').innerHTML, /資産CSV（分子）を読み込んでください/);
});

test('CSV選択(change)配線: 実測σ読込がcsvSum/chipsへ反映される', async () => {
  const { env } = loadUi();
  const csv = buildOscillatingCsv(20);
  env.get('csvFile').files = [{ text: csv }];
  env.fire('csvFile', 'change');
  await tick();
  const sum = env.get('csvSum');
  assert.equal(sum.hidden, false);
  assert.match(sum.innerHTML, /σ14/);
  assert.match(env.get('chips').innerHTML, /実測14日/);
});

test('中期設計タブ: 分子CSV読込配線でレンジが計算される', async () => {
  const { env, ui } = loadUi();
  ui.setMode('C');
  env.get('cH').value = '10'; // 合成データ(40日)に収まる保有期間に調整（窓数=40-10=30>=20）
  const csv = buildOscillatingCsv(40);
  env.get('cFileN').files = [{ text: csv }];
  env.fire('cFileN', 'change');
  await tick();
  assert.equal(env.get('cStatN').hidden, false);
  assert.match(env.get('out').innerHTML, /推奨レンジ（経験分位）/);
});

test('gpGo: GeckoTerminal取得成功時にVol/TVL/手数料階層が反映される', async () => {
  const { env, ui } = loadUi();
  env.setFetchImpl(async () => ({
    status: 200,
    ok: true,
    json: async () => ({
      data: { attributes: {
        name: 'WETH / USDC 0.3%', volume_usd: { h24: 123456 }, reserve_in_usd: 987654,
        base_token_price_quote_token: '1234.5',
      } },
    }),
  }));
  env.get('gpAddrA').value = '0x' + 'a'.repeat(40);
  await ui.gpGo('A');
  assert.equal(env.get('aVol').value, 123456);
  assert.equal(env.get('aTvl').value, 987654);
  assert.equal(env.get('aFee').value, '0.003');
  assert.match(env.get('gpStatA').innerHTML, /WETH \/ USDC 0\.3%/);
  assert.match(env.get('gpStatA').innerHTML, /data via GeckoTerminal/);
});

test('gpGo: アドレス形式不正はfetchを呼ばずエラー表示', async () => {
  const { env, ui } = loadUi();
  let called = false;
  env.setFetchImpl(async () => { called = true; return {}; });
  env.get('gpAddrA').value = 'not-an-address';
  await ui.gpGo('A');
  assert.equal(called, false);
  assert.match(env.get('gpStatA').innerHTML, /アドレス形式/);
});

test('P3上抜けタイマー: モードB表示時に既定値(空欄=0)でレンジ内表示される', () => {
  const { env, ui } = loadUi();
  ui.setMode('B');
  assert.match(env.get('p3upOut').innerHTML, /レンジ内/);
});

test('P3上抜けタイマー: bUpDays入力配線でdays=1/2の表示が切り替わる', () => {
  const { env, ui } = loadUi();
  ui.setMode('B');
  env.get('bUpDays').value = '1';
  env.fire('bUpDays', 'input');
  assert.match(env.get('p3upOut').innerHTML, /50%再展開の目安（上抜け確定1日目）/);

  env.get('bUpDays').value = '2';
  env.fire('bUpDays', 'input');
  assert.match(env.get('p3upOut').innerHTML, /残り50%再展開の目安/);

  env.get('bUpDays').value = '-5';
  env.fire('bUpDays', 'input');
  assert.match(env.get('p3upOut').innerHTML, /レンジ内/);
});

test('P3下抜けチェックリスト: モードB表示時は未選択の中立表示', () => {
  const { env, ui } = loadUi();
  ui.setMode('B');
  assert.match(env.get('p3dnOut').innerHTML, /選択してください/);
});

test('P3下抜けチェックリスト: state選択と相対ペアチェックの配線', () => {
  const { env, ui } = loadUi();
  ui.setMode('B');

  env.get('bDnState').value = '1';
  env.fire('bDnState', 'input');
  assert.match(env.get('p3dnOut').innerHTML, /下限割れ確定/);
  assert.doesNotMatch(env.get('p3dnOut').innerHTML, /第三の資産/);

  env.get('bDnRel').checked = true;
  env.fire('bDnRel', 'input');
  assert.match(env.get('p3dnOut').innerHTML, /第三の資産/);

  env.get('bDnState').value = '2';
  env.fire('bDnState', 'input');
  assert.match(env.get('p3dnOut').innerHTML, /ステーブル化済み/);

  env.get('bDnState').value = '';
  env.fire('bDnState', 'input');
  assert.match(env.get('p3dnOut').innerHTML, /選択してください/);
});

test('gpGo: fetch失敗時は手入力継続を促すメッセージに劣化', async () => {
  const { env, ui } = loadUi();
  env.setFetchImpl(async () => { throw new Error('network down'); });
  env.get('gpAddrC').value = '0x' + 'b'.repeat(40);
  await ui.gpGo('C');
  assert.match(env.get('gpStatC').innerHTML, /手入力を継続/);
});
