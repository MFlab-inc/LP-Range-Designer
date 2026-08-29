'use strict';
// 合成テスト用のCMC日足CSV（セミコロン区切り）を生成するヘルパー。実データは使わない。
const CMC_HEADER = 'timeOpen;timeClose;timeHigh;timeLow;name;open;high;low;close;volume;marketCap;circulatingSupply;timestamp';

function isoDay(daysFromEpochStart, startMs) {
  return new Date(startMs + daysFromEpochStart * 86400000).toISOString().slice(0, 10);
}

function cmcRow(iso, o, h, l, c) {
  return `"${iso}T00:00:00.000Z";"${iso}T23:59:59.999Z";"${iso}T12:00:00.000Z";"${iso}T01:00:00.000Z";"TEST";${o};${h};${l};${c};1000;100000;1000;"${iso}T23:59:59.999Z"`;
}

// priceAt(i) で各日のOpenを決める合成CSVを生成する。high/lowはopen±1%、close=open×1.001。
function buildCsv(days, priceAt, opts = {}) {
  const startMs = opts.startMs ?? Date.UTC(2024, 0, 1);
  const rows = [CMC_HEADER];
  for (let i = 0; i < days; i++) {
    const o = priceAt(i);
    const h = o * 1.01;
    const l = o * 0.99;
    const c = o * 1.001;
    rows.push(cmcRow(isoDay(i, startMs), o, h, l, c));
  }
  return rows.join('\n');
}

// 対数リターンが厳密に一定（=定数比）となる系列。sampleStdev/sigmaが0になる基準ケース用。
function buildConstantRatioCsv(days, opts = {}) {
  const start = opts.start ?? 100;
  return buildCsv(days, i => start * Math.pow(1.0, i), opts); // 比率1.0=完全一定
}

// 上下に振動する系列（経験分位テストで上下とも正の値を得るため）。
function buildOscillatingCsv(days, opts = {}) {
  const start = opts.start ?? 100;
  const amp = opts.amp ?? 0.02;
  return buildCsv(days, i => start * (1 + amp * Math.sin(i / 3)), opts);
}

module.exports = { CMC_HEADER, isoDay, cmcRow, buildCsv, buildConstantRatioCsv, buildOscillatingCsv };
