#!/usr/bin/env node
// แปลงไฟล์ Mermaid (.mmd) เป็น PNG ด้วย Chromium ของ Playwright แบบออฟไลน์
// ใช้: node render_mermaid.js <mermaid.min.js> <out_dir> <a.mmd> [b.mmd ...]
// แต่ละไฟล์ <x>.mmd จะได้ <out_dir>/<x>.png
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  const tries = ['playwright', '/opt/node22/lib/node_modules/playwright',
    '/usr/local/lib/node_modules_global/playwright'];
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  throw new Error('ไม่พบ playwright');
}

(async () => {
  const [mermaidJs, outDir, ...files] = process.argv.slice(2);
  if (!mermaidJs || !outDir || files.length === 0) {
    console.error('usage: render_mermaid.js <mermaid.min.js> <out_dir> <files...>');
    process.exit(2);
  }
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 3 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
    <style>body{margin:0;background:#fff;font-family:'TH SarabunPSK','Laksaman','Loma',sans-serif}
    #c{display:inline-block;padding:8px}</style></head><body><div id="c"></div></body></html>`);
  await page.addScriptTag({ path: mermaidJs });
  await page.evaluate(() => {
    window.mermaid.initialize({
      startOnLoad: false, theme: 'neutral', securityLevel: 'strict',
      fontFamily: "'TH SarabunPSK','Laksaman','Loma',sans-serif", fontSize: 20,
      flowchart: { htmlLabels: true, useMaxWidth: false },
      sequence: { useMaxWidth: false, actorFontSize: 20, messageFontSize: 20, noteFontSize: 18 },
    });
  });
  let failed = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const out = path.join(outDir, path.basename(f).replace(/\.mmd$/, '') + '.png');
    try {
      const ok = await page.evaluate(async (code) => {
        const { svg } = await window.mermaid.render('m' + Math.random().toString(36).slice(2), code);
        document.getElementById('c').innerHTML = svg;
        return true;
      }, src);
      if (!ok) throw new Error('render failed');
      const el = await page.$('#c');
      await el.screenshot({ path: out, omitBackground: false });
      console.log('OK ' + out);
    } catch (e) {
      failed++;
      console.log('FAIL ' + f + ' ' + String(e.message || e).split('\n')[0]);
    }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
