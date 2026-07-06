// Regression: toolbar ↩/↪ undo/redo buttons — exist, disabled at boot, enable
// after a drawing mutation, and drive undoDraw/redoDraw with correct disabled state.
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
let fail=false;
p.on('pageerror',e=>{if(!/Value is null/.test(e.message)){console.log('PAGEERR:',e.message);fail=true;}});
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:30000});
await p.waitForFunction(()=>typeof lastData!=='undefined'&&lastData.length>0,{timeout:30000});
await p.waitForTimeout(2500);

const state=()=>p.evaluate(()=>({
  hasU:!!document.getElementById('btnUndo'), hasR:!!document.getElementById('btnRedo'),
  uDis:document.getElementById('btnUndo').disabled, rDis:document.getElementById('btnRedo').disabled,
  shapes:draw.shapes.length,
}));

let s=await state();
const boot = s.hasU && s.hasR && s.uDis && s.rDis;
console.log('boot (buttons exist, both disabled):', boot?'PASS':'FAIL', JSON.stringify(s));
if(!boot) fail=true;

// Programmatically add a shape through the same history path a real draw uses.
await p.evaluate(()=>{
  snapshotDraw();
  draw.shapes.push({id:newId(), type:'hline', pts:[{time:lastData[lastData.length-1].time, price:lastData[lastData.length-1].close}], style:{color:'#2962ff',width:1,dash:0,showLabel:true}});
  persist(); redraw(); updateUndoButtons();
});
s=await state();
const afterDraw = s.shapes===1 && !s.uDis && s.rDis;
console.log('after draw (undo enabled, redo disabled):', afterDraw?'PASS':'FAIL', JSON.stringify(s));
if(!afterDraw) fail=true;

// Click Undo → shape removed, undo disabled, redo enabled.
await p.click('#btnUndo'); await p.waitForTimeout(150);
s=await state();
const afterUndo = s.shapes===0 && s.uDis && !s.rDis;
console.log('after Undo click:', afterUndo?'PASS':'FAIL', JSON.stringify(s));
if(!afterUndo) fail=true;

// Click Redo → shape back, undo enabled, redo disabled.
await p.click('#btnRedo'); await p.waitForTimeout(150);
s=await state();
const afterRedo = s.shapes===1 && !s.uDis && s.rDis;
console.log('after Redo click:', afterRedo?'PASS':'FAIL', JSON.stringify(s));
if(!afterRedo) fail=true;

console.log(fail?'FAIL ✗':'clean ✓');
await b.close(); process.exit(fail?1:0);
