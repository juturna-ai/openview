import { chromium } from 'playwright';
const URL='http://127.0.0.1:5501/';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto(URL,{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

// open tf menu
await page.locator('#tfSelBtn').click(); await page.waitForTimeout(300);
const inputVisible = await page.locator('#tfCustom').isVisible();

// test parser directly (pure logic) for several inputs
const parse = await page.evaluate(()=>({
  '45m': parseCustomTF('45m'), '3h': parseCustomTF('3h'), '8h': parseCustomTF('8h'),
  '10d': parseCustomTF('10d'), '90': parseCustomTF('90'), 'bad': parseCustomTF('xyz'),
  '7s': parseCustomTF('7s'), '2h': parseCustomTF('2h')
}));

// apply 45m via the input + Enter
await page.locator('#tfCustom').fill('45m');
await page.locator('#tfCustom').press('Enter');
await page.waitForTimeout(2500);
const label45 = await page.locator('#tfName, #tfSelLabel').first().innerText().catch(()=>null);
const activeTF45 = await page.evaluate(()=>activeTF);
await page.screenshot({path:'customtf_45m.png'});

// apply invalid → should flag .bad, not change TF
await page.locator('#tfSelBtn').click(); await page.waitForTimeout(200);
await page.locator('#tfCustom').fill('nonsense');
await page.locator('#tfCustom').press('Enter');
await page.waitForTimeout(400);
const stillActive = await page.evaluate(()=>activeTF);

console.log(JSON.stringify({inputVisible, parse, label45, activeTF45, stillActive, appErrors:errs.slice(0,6)},null,2));
await browser.close();
