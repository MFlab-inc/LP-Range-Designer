'use strict';
// index.html全体（配線コード込み）をvmで実行するための最小限のDOM/fetch/FileReaderスタブ。
// 目的はDOM配線（イベント→再計算→表示更新）の疎通確認であり、数値の厳密検証はpure.test.js/data-regression.test.jsが担う。

// HTML初期状態に合わせた既定値。ここに無いidは空文字/非表示で自動生成される。
const HIDDEN_INIT = new Set(['paneB', 'paneC', 'csvSum', 'gpStatA', 'gpStatC', 'cStatN', 'cStatD', 'cWarn', 'btBlock']);
const VALUE_INIT = {
  aP: '1913', aS: '4.0', aT: '14', aK: '1.4', aSkew: '1.25', aFee: '0.0005', aUtil: '80',
  bS: '4.0',
  cH: '365', cCov: '0.9', cFrom: '2022-01-01', cFee: '0.0005', cUtil: '80',
  gpNetA: 'base', gpNetC: 'base',
};
const INNER_INIT = {
  exdn: '▼下抜け＝ETH側100%',
  exup: '上抜け＝USDC側100%▲',
};
const ATTR_INIT = {
  tabA: { 'aria-selected': 'true' },
  tabB: { 'aria-selected': 'false' },
  tabC: { 'aria-selected': 'false' },
};

function createDomEnv() {
  const elements = new Map();

  function getElementById(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: VALUE_INIT[id] ?? '',
        textContent: '',
        innerHTML: INNER_INIT[id] ?? '',
        hidden: HIDDEN_INIT.has(id),
        className: '',
        style: {},
        files: undefined,
        _attrs: { ...(ATTR_INIT[id] ?? {}) },
        _listeners: {},
        setAttribute(k, v) { this._attrs[k] = String(v); },
        getAttribute(k) { return this._attrs[k]; },
        addEventListener(type, fn) {
          (this._listeners[type] = this._listeners[type] || []).push(fn);
        },
      });
    }
    return elements.get(id);
  }

  function fire(id, type, evt = {}) {
    const el = getElementById(id);
    (el._listeners[type] || []).forEach(fn => fn(Object.assign({ target: el }, evt)));
  }

  class FileReaderStub {
    readAsText(file) {
      queueMicrotask(() => {
        try {
          this.result = file.text;
          if (this.onload) this.onload();
        } catch (e) {
          if (this.onerror) this.onerror(e);
        }
      });
    }
  }

  let fetchImpl = async () => { throw new Error('fetchはテストでスタブされていません'); };
  const fetchStub = (...args) => fetchImpl(...args);

  return {
    document: { getElementById },
    FileReader: FileReaderStub,
    fetch: fetchStub,
    setFetchImpl(fn) { fetchImpl = fn; },
    fire,
    elements,
    get(id) { return getElementById(id); },
  };
}

module.exports = { createDomEnv };
