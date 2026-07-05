import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
await page.setViewportSize({width:1000,height:900});
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);

// switch to 1m so the (previously) dense grid would show
await page.evaluate(()=>selectTF('1m')); await page.waitForTimeout(4000);
// add an indicator that opens a sub-pane (MACD) to exercise the sub-chart config
await page.evaluate(()=>{ try{ if(typeof addIndicator==='function') addIndicator('macd'); }catch(e){} });
await page.waitForTimeout(2500);

// probe: are all pane grids' vertLines hidden?
const grids = await page.evaluate(()=>{
  const list=(typeof allPaneCharts==='function')?allPaneCharts():[chart];
  return list.map(c=>{ try{ return c.options().grid.vertLines.visible; }catch(e){ return 'err'; } });
});

await page.screenshot({path:'subgrid_1m.png',fullPage:false});
console.log(JSON.stringify({vertLinesVisiblePerPane:grids},null,2));
await browser.close();
