import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource|Value is null/.test(m.text()))errs.push(m.text());});
p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push('PAGEERR: '+e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(6000);
const h=await p.evaluate(()=>({
  chartOk: typeof chart!=='undefined',
  canvases: document.querySelectorAll('canvas').length,
  dataBars: (typeof lastData!=='undefined')?lastData.length:0,
  indicators: (typeof IND_CATALOG!=='undefined')?IND_CATALOG.length:0,
  chartTypes: (typeof CHART_TYPES!=='undefined')?CHART_TYPES.length:0,
  timeframes: (typeof TF!=='undefined')?Object.keys(TF).length:0,
  toolCategories: document.querySelectorAll('.tool.cat').length,
  floatingLegend: !!document.getElementById('chartLegend'),
  bottomBar: !!document.getElementById('bottomBar'),
  rightRail: document.querySelectorAll('#rightRail .rr-btn').length,
  wsConnected: (typeof _ws!=='undefined' && _ws)? _ws.readyState : 'n/a',
}));
console.log(JSON.stringify({health:h, appErrors:errs.slice(0,8)},null,2));
await b.close();
