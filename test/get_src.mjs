import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
let scriptContent = null;
p.on('response', async (res) => {
  if(res.url().includes('lightweight-charts') && res.url().endsWith('.js')){
    try { scriptContent = await res.text(); } catch(e){}
  }
});
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(2000);
await b.close();
import { writeFileSync } from 'fs';
writeFileSync('/tmp/claude-1000/-home-morrison-projects-Freeview-Freeview/051bddcf-888a-4d6a-af1d-3af8d5980679/scratchpad/lwc_real.js', scriptContent);
console.log("bytes:", scriptContent.length);
