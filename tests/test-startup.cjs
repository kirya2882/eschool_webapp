const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root='./';let source=fs.readFileSync(root+'Index.html','utf8').replace('<?!= JSON.stringify(appId) ?>','"test-app"');
for(const name of ['Core','Schedule','ESchoolUI'])source=source.replace(`<?!= HtmlService.createHtmlOutputFromFile('${name}').getContent(); ?>`,fs.readFileSync(root+name+'.html','utf8'));
const scripts=[...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
async function run({deny=false,missing=false,serverFail=false,timeout=false}={}){
 const els={};for(const id of ['syncStatus','notice','noticeText','page','nav','aboutButton','confirmButton','confirmDialog','editor','editForm','demoBanner'])els[id]={hidden:true,open:false,textContent:'',innerHTML:'',classList:{toggle(){},add(){}},addEventListener(){},querySelector(){return {removeAttribute(){}}}};
 let success,failure;const timers=[],handlers={};const runner={withSuccessHandler(fn){success=fn;return this},withFailureHandler(fn){failure=fn;return this},getState(){if(!timeout)queueMicrotask(()=>serverFail?failure(Error('Сначала запустите функцию setup.')):success({revision:0,subjects:[],grades:[],tasks:[],lessons:[],scheduleRanges:[],settings:{}}));}};
 const win={addEventListener:(name,fn)=>handlers[name]=fn,google:{script:{run:runner}}};for(const key of ['localStorage','sessionStorage'])Object.defineProperty(win,key,{get(){if(deny)throw Error('SecurityError: storage blocked');return {getItem:()=>null,setItem(){},removeItem(){}}}});
 const c=vm.createContext({window:win,document:{getElementById:id=>els[id]||null,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},documentElement:{dataset:{}},visibilityState:'visible'},google:win.google,crypto:{randomUUID:()=> 'test_1234'},navigator:{onLine:true},location:{},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},setInterval(){},matchMedia:()=>({matches:false,addListener(){}}),console});
 for(const script of scripts){if(missing&&script.includes('function renderSchedule()'))continue;try{vm.runInContext(script,c);}catch(error){handlers.error?.({error});}}
 if(timeout)timers.find(t=>t.ms===45000).fn();await new Promise(resolve=>setImmediate(resolve));
 return {els,c};
}
(async()=>{
 for(const deny of [false,true]){const {els,c}=await run({deny});assert(els.page.innerHTML.includes('Расписание'));assert.equal(els.syncStatus.textContent,'Всё сохранено');assert.equal(vm.runInContext('loaded&&connected',c),true);}
 const missing=await run({missing:true});assert.equal(missing.els.syncStatus.textContent,'Ошибка запуска');assert.match(missing.els.noticeText.textContent,/renderSchedule/);
 const fail=await run({serverFail:true});assert.equal(fail.els.syncStatus.textContent,'Нет связи');assert.match(fail.els.noticeText.textContent,/setup/);
 const timeout=await run({timeout:true});assert.equal(timeout.els.syncStatus.textContent,'Нет связи');assert.match(timeout.els.noticeText.textContent,/вовремя/);
 console.log('PASS: production bootstrap, blocked Web Storage, legacy media-query listener, missing module diagnostics, server setup error and RPC timeout.');
})().catch(e=>{console.error(e);process.exitCode=1});
