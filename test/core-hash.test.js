'use strict';
// 仕様書§6：コア7関数（calc/drawRail/verdict/preset/mode/row/fmt）はバイト同一を維持する。
// このテストはindex.htmlから該当関数のソースを再抽出し、PR-1で採取した基準md5（test/core-hashes.json）と照合する。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readIndexHtml, extractScriptContent, coreHashes } = require('./lib/extract');
const baseline = require('./core-hashes.json');

test('core-hash: コア7関数のmd5が基準値と一致する', () => {
  const html = readIndexHtml();
  const script = extractScriptContent(html);
  const actual = coreHashes(script);

  for (const name of Object.keys(baseline)) {
    if (name === '_comment') continue;
    assert.ok(
      Object.prototype.hasOwnProperty.call(actual, name),
      `core-hashes.jsonに記載の関数 "${name}" がindex.htmlから抽出できません`
    );
    assert.equal(
      actual[name],
      baseline[name],
      `コア関数 "${name}" がv1基準からバイト同一でなくなっています（md5不一致）。仕様書§6違反の可能性。`
    );
  }
});
