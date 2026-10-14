import puppeteer from 'puppeteer';
import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';

const root = process.cwd();
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>reduced-motion check</title>
<link rel="stylesheet" href="/style.css" />
<style>
  body { margin: 0; min-height: 100vh; padding: 72px 24px 24px; }
  .demo-row { display:flex; gap:16px; flex-wrap:wrap; }
  .panel-collapsible {
    width: 220px; min-height: 120px; padding: 16px;
    color: var(--text-primary);
  }
  .probe {
    margin-top: 16px; font-family: var(--font-mono); font-size: 12px;
    color: var(--text-secondary); white-space: pre-wrap;
  }
</style>
</head>
<body>
  <header class="cs-topbar" role="banner">
    <div class="cs-topbar__brand">创世之眼</div>
    <time class="cs-topbar__clock">2026-10-14 18:30:00 北京时间</time>
    <div class="cs-topbar__sources">
      <span class="cs-topbar__dot" data-state="ok"></span>
      <span class="cs-topbar__dot" data-state="ok"></span>
      <span class="cs-topbar__dot" data-state="ok"></span>
      <span class="cs-topbar__dot" data-state="ok"></span>
    </div>
  </header>
  <div class="demo-row">
    <section class="panel-collapsible"><h3 class="panel-title">数据概览</h3><p>面板入场与毛玻璃探测</p></section>
    <section class="panel-collapsible"><h3 class="panel-title">场景</h3><p>减弱动态时应无动画、无模糊</p></section>
  </div>
  <pre class="probe" id="probe"></pre>
</body>
</html>`;

const mime = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  const path = join(root, decodeURIComponent(req.url.split('?')[0]));
  try {
    const data = readFileSync(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('missing');
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

async function shot(reduced, out) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 640, deviceScaleFactor: 1 });
  if (reduced) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  } else {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  }
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  const probe = await page.evaluate(() => {
    const el = document.querySelector('.panel-collapsible');
    const cs = getComputedStyle(el);
    const top = document.querySelector('.cs-topbar__brand');
    const tcs = getComputedStyle(top);
    return {
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
      background: cs.backgroundColor,
      brandColor: tcs.color,
      mq: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
  await page.$eval('#probe', (n, p) => {
    n.textContent = JSON.stringify(p, null, 2);
  }, probe);
  await page.screenshot({ path: out, type: 'jpeg', quality: 85 });
  await page.close();
  return probe;
}

const normal = await shot(false, join(root, 'docs/pr-screenshots/motion-normal-sm.jpg'));
const reduced = await shot(true, join(root, 'docs/pr-screenshots/motion-reduced-sm.jpg'));
writeFileSync(join(root, 'docs/pr-screenshots/motion-check.json'), JSON.stringify({ normal, reduced }, null, 2));
console.log(JSON.stringify({ normal, reduced }, null, 2));
await browser.close();
server.close();
