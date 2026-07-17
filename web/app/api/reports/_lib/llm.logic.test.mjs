// Contract tests for the Reports LLM layer (see llm.ts) — no API key required; global.fetch is
// stubbed so each provider's behaviour is asserted rather than assumed.
//
// WHAT THESE PROTECT — the honesty guarantees of the feature:
//
//   • Groq is the fallback ONLY on a 429 (quota exhausted). On any other Gemini failure the
//     analysis must come back null, so a real fault stays visible instead of being silently
//     masked by a fallback that also changes the voice of the report.
//   • A response missing the disclaimer must be REJECTED. This is the one honesty rule enforced
//     in code rather than merely requested of the model.
//   • The stored disclaimer is always our canonical text, never the model's echo of it — a model
//     that "helpfully" rewords it into advice must not be able to publish that.
//   • A thesis for a symbol we didn't rank is dropped (a hallucinated row implies a ranking that
//     never happened).
//   • An empty report costs zero LLM calls — the free tier is a budget, not a given.
//
// Run: node web/app/api/reports/_lib/llm.logic.test.mjs

import assert from 'node:assert/strict';

const { analyze, REQUIRED_DISCLAIMER } = await import('./llm.ts');

const coins=[{id:1,symbol:'AAA',name:'A',slug:'a',thumb:'',cmcRank:10,price:1,changePct:12,volume:2e6,marketCap:2e7,turnover:0.1}];
const pairs=[]; const sent={fearGreed:null,trending:[],mostVisited:[],recentlyAdded:[]};
const good={summary:'S',coinTheses:[{symbol:'AAA',thesis:'no clear catalyst identified'}],riskFlags:['r'],disclaimer:REQUIRED_DISCLAIMER};

const gem=t=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(t)}]}}]})});
const grq=t=>({ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(t)}}]})});
const isG=u=>String(u).includes('generativelanguage');
let calls=[];
const mock=h=>{global.fetch=async(u,o)=>{calls.push(isG(u)?'gemini':'groq');return h(u,o)}};

process.env.GEMINI_API_KEY='x'; process.env.GROQ_API_KEY='y';

// 1. happy path
calls=[]; mock(u=>gem(good));
let r=await analyze('daily',coins,pairs,sent);
assert.equal(r.provider,'gemini'); assert.equal(r.analysis.summary,'S');
console.log('1 gemini happy path -> provider=gemini OK');

// 2. 429 => groq fallback
calls=[]; mock(u=>isG(u)?{ok:false,status:429,json:async()=>({})}:grq(good));
r=await analyze('daily',coins,pairs,sent);
assert.equal(r.provider,'groq'); assert.deepEqual(calls,['gemini','groq']);
console.log('2 gemini 429 -> falls back to groq OK');

// 3. non-429 => null, groq NOT called
calls=[]; mock(u=>isG(u)?{ok:false,status:500,json:async()=>({})}:grq(good));
r=await analyze('daily',coins,pairs,sent);
assert.equal(r.analysis,null); assert.equal(r.provider,null);
assert.deepEqual(calls,['gemini'],'groq must NOT be called on a non-429');
console.log('3 gemini 500 -> null, groq NOT called (fault visible) OK');

// 4. missing disclaimer => rejected
calls=[]; const noDisc={...good}; delete noDisc.disclaimer;
mock(u=>isG(u)?gem(noDisc):grq(noDisc));
r=await analyze('daily',coins,pairs,sent);
assert.equal(r.analysis,null,'missing disclaimer must be rejected');
console.log('4 missing disclaimer -> rejected OK');

// 5. hallucinated symbol dropped
calls=[]; mock(u=>gem({...good,coinTheses:[{symbol:'AAA',thesis:'real'},{symbol:'FAKE',thesis:'invented'}]}));
r=await analyze('daily',coins,pairs,sent);
assert.deepEqual(r.analysis.coinTheses.map(t=>t.symbol),['AAA'],'unknown symbol must be dropped');
console.log('5 hallucinated symbol -> dropped OK');

// 6. model reworded disclaimer => canonical text still used
calls=[]; mock(u=>gem({...good,disclaimer:'trust me bro, financial advice'}));
r=await analyze('daily',coins,pairs,sent);
assert.equal(r.analysis.disclaimer,REQUIRED_DISCLAIMER,'must store canonical disclaimer');
console.log('6 reworded disclaimer -> canonical text enforced OK');

// 7. empty coins => no LLM call at all (quota not burned)
calls=[]; mock(u=>gem(good));
r=await analyze('daily',[],pairs,sent);
assert.equal(r.analysis,null); assert.deepEqual(calls,[],'must not call any LLM for an empty report');
console.log('7 empty coins -> zero LLM calls (quota saved) OK');

// 8. fenced JSON still parses
calls=[]; global.fetch=async()=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:'```json\n'+JSON.stringify(good)+'\n```'}]}}]})});
r=await analyze('daily',coins,pairs,sent);
assert.equal(r.provider,'gemini','fenced output must still parse');
console.log('8 ```json fenced output -> parsed OK');

console.log('\nAll LLM contract assertions passed');
