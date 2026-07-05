import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({acceptDownloads:true});
const page=await ctx.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

const btns = {
  imp: await page.locator('#wlImport').count(),
  exp: await page.locator('#wlExport').count(),
};

// EXPORT: trigger download, capture content
const [ download ] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#wlExport').click(),
]);
const path = await download.path();
const fs = await import('fs');
const exported = fs.readFileSync(path,'utf8');
const firstLines = exported.split('\n').slice(0,4);

// IMPORT: feed a custom watchlist text via the import function directly
const importResult = await page.evaluate(()=>{
  const sample = "###CRYPTO\nBTC-USD\nETH-USD\n###ALTS\nSOL-USD\nADA-USD";
  importWatchlistText(sample);
  return { groupCount:GROUPS.length, names:GROUPS.map(g=>g.name), total:GROUPS.flatMap(g=>g.symbols).length, first:GROUPS[0] };
});
// verify the DOM rebuilt with the new sections
await page.waitForTimeout(500);
const sectionLabels = await page.locator('#wlBody .section .gname, #wlBody .section').allInnerTexts().catch(()=>[]);
await page.screenshot({path:'wlio.png'});
console.log(JSON.stringify({btns, firstLines, importResult, hasImportedSections: sectionLabels.join(' ').includes('CRYPTO'), appErrors:errs.slice(0,6)},null,2));
await browser.close();
