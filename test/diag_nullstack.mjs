import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const stacks=[];
p.on('pageerror', e=>{ if(e.message==='Value is null') stacks.push(e.stack||'(no stack)'); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(14000);
console.log("Value-is-null count:", stacks.length);
console.log("FIRST STACK:\n", stacks[0]);
await b.close();
