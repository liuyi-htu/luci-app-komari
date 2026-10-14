'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalog = new Map();
let id, context;
for (const line of fs.readFileSync(path.join(root, 'po/zh_Hans/komari.po'), 'utf8').split('\n')) {
  if (line.startsWith('msgctxt ')) context = JSON.parse(line.slice(8));
  if (line.startsWith('msgid ')) id = JSON.parse(line.slice(6));
  if (line.startsWith('msgstr ') && id) {
    assert.equal(context, 'komari');
    assert(!catalog.has(id), 'Duplicate translation: ' + id);
    catalog.set(id, JSON.parse(line.slice(7)));
  }
}
for (const relative of ['htdocs/luci-static/resources/view/komari/overview.js', 'htdocs/luci-static/resources/komari/server.js', 'htdocs/luci-static/resources/komari/agent.js', 'htdocs/luci-static/resources/komari/i18n.js']) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  assert.doesNotMatch(source, /[\u4e00-\u9fff]/);
  for (const match of source.matchAll(/_\(('(?:[^'\\]|\\.)*')(?:, 'komari')?\)/g)) {
    assert(match[0].includes(", 'komari'"), 'Missing private context: ' + match[0]);
    const text = new Function('return ' + match[1])();
    assert(catalog.has(text), 'Missing translation: ' + text);
  }
}
const makeI18n = chinese => {
  const members = new Function('baseclass', '_', fs.readFileSync(path.join(root, 'htdocs/luci-static/resources/komari/i18n.js'), 'utf8'))(
    {extend: obj => obj}, (text, ctx) => ctx === 'komari' && chinese ? catalog.get(text) || text : text);
  return members;
};
const english = makeI18n(false), chinese = makeI18n(true);
assert.equal(chinese.translate('Komari Agent updated to 1.5.11.'), 'Komari Agent 已更新至 1.5.11。');
assert.equal(english.translate('Server settings'), 'Server settings');
assert.equal(chinese.translate('Server settings'), '服务端设置');
assert.equal(chinese.translate('Komari updated to 1.5.1.'), 'Komari 已更新至 1.5.1。');
assert(chinese.translate('Update failed: Failed to download the latest release').includes('下载最新版失败'));
assert(english.logText('2026-10-14 12:00:00 Update started.').endsWith('Update started.'));
assert(chinese.logText('2026-10-14 12:00:00 Update started.').endsWith('更新任务已启动。'));
console.log('English fallback, private-context coverage, and Chinese dynamic messages passed');
if (process.argv[2]) {
  const binary=fs.readFileSync(process.argv[2]);
  const index=binary.readUInt32BE(binary.length-4), TR={};
  for(let offset=index;offset<binary.length-4;offset+=16) {
    const hash=binary.readUInt32BE(offset).toString(16).padStart(8,'0');
    const start=binary.readUInt32BE(offset+8), length=binary.readUInt32BE(offset+12);
    TR[hash]=binary.subarray(start,start+length).toString('utf8');
  }
  const cbi=fs.readFileSync(process.argv[3],'utf8');
  const lookup=new Function('window','TR',cbi.slice(cbi.indexOf('function s8('),cbi.indexOf('function N_('))+';return _;')({TR},TR);
  for (const [id,zh] of catalog) assert.equal(lookup(id,'komari'),zh,'Compiled catalog misses '+id);
  console.log('Compiled Chinese catalog verified with the actual LuCI lookup implementation');
}
