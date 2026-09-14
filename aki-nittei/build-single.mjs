// index.html / style.css / slots.js / app.js を1つのHTMLにまとめる。
// 使い方: node build-single.mjs 出力先.html [--body-only]
// 1ファイルで渡したいとき（メール添付、claude.ai のページなど）に使う。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const args = process.argv.slice(2);
const bodyOnly = args.includes('--body-only');
const out = args.find((a) => !a.startsWith('--')) || path.join(dir, 'dist', 'aki-nittei.html');

let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + read('style.css') + '</style>');
html = html.replace('<script src="slots.js"></script>', '<script>\n' + read('slots.js') + '</script>');
html = html.replace('<script src="app.js"></script>', '<script>\n' + read('app.js') + '</script>');
// 1ファイル版では外部ファイルへの参照を落とす
html = html.replace(/ *<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/g, '');

// --body-only: <title> と <style> を先頭に置いた本文だけにする（外側の枠を用意してくれる置き場所向け）
if (bodyOnly) {
  const title = html.match(/<title>.*?<\/title>/)[0];
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
  html = title + '\n' + style + '\n' + body.trim() + '\n';
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote', out, html.length, 'bytes');
