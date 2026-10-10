const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let now=Date.UTC(2026,9,10,12),calls=[],saves=0,fail=false,session=true,editing=false,hold=null;
class Clock extends Date{static now(){return now;}}
const doc={visibilityState:'visible',activeElement:{matches:()=>editing},querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{}};
const els={editor:{open:false,addEventListener:()=>{}},confirmDialog:{open:false},editForm:{addEventListener:()=>{}}};
const state={revision:0,lessons:[],scheduleRanges:[],subjects:[{id:'manual_math',name:'Мой предмет'}],grades:[{id:'manual_grade',subjectId:'manual_math',value:3,weight:1,date:'2026-10-10',note:''}],tasks:[],settings:{esAutoSync:true},scenarios:{}};
const subject={id:'es_s_12_54',name:'Алгебра'},grade={id:'es_g_12_521',subjectId:subject.id,value:5,weight:1.25,modifier:'',date:'2026-10-10',note:'Тест'};
const task={id:'es_t_12_55',subject:'Алгебра',text:'Задача',html:'<p>Задача</p>',date:'2026-10-10',remotePartId:'55',attachments:0};
const c=vm.createContext({console,Date:Clock,state,key:'test',read:(k,d)=>d,write:()=>{},remove:()=>{},DEMO:false,document:doc,navigator:{onLine:true},window:{addEventListener:()=>{}},setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,$:id=>els[id],esc:String,settings:()=>state.settings,Core:{today:()=> '2026-10-10'},screen:'marks',scheduleDate:'2026-10-10',busy:false,pending:null,loaded:true,connected:true,editContext:null,uid:(()=>{let n=0;return ()=>'operation_'+(++n)})(),load:async()=>{},toast:()=>{}});
vm.runInContext(fs.readFileSync('./Code.gs','utf8').slice(fs.readFileSync('./Code.gs','utf8').indexOf('function checkId_'))+'\n'+fs.readFileSync('./Extensions.gs','utf8'),c);
vm.runInContext(fs.readFileSync('./ESchoolUI.html','utf8').replace(/<\/?script>/g,'')+'\nthis.auto=esAuto;',c);
c.esRpc=async(method,input)=>{calls.push({method,input});if(hold){const gate=hold;hold=null;await gate;}if(fail)throw Error('Нет сети');if(method==='eschoolInfo')return {connected:session,currentYearId:2026};if(method==='eschoolPeriods')return [{id:2,start:'2026-09-01',end:'2026-10-31'},{id:1,start:'2026-09-01',end:'2027-08-31'}];if(method==='eschoolRead'&&input.kind==='homework')return {tasks:input.date==='2026-10-05'?[{...task}]:[],warnings:[]};if(method==='eschoolRead')return {subjects:[{...subject}],grades:[{...grade}],warnings:[]};throw Error('Unexpected RPC');};
c.save=async event=>{saves++;const valid=c.validate_(event,state);c.apply_(state,valid);state.revision++;return true;};
(async()=>{
 await c.esAutoRefresh();assert.equal(saves,3);assert.equal(state.grades.length,2);assert.equal(state.tasks.length,1);assert.equal(calls.find(x=>x.input?.periodId).input.periodId,1);assert.equal(calls.filter(x=>x.input?.kind==='homework').map(x=>x.input.date).join(','),'2026-10-05,2026-10-12');
 const count=calls.length;await c.esAutoRefresh();assert.equal(calls.length,count);now+=300001;await c.esAutoRefresh();assert.equal(saves,3);assert(c.auto.message.includes('Данные актуальны'));
 state.tasks[0].done=true;grade.weight=2;task.text='Новое задание';now+=300001;await c.esAutoRefresh();assert.equal(saves,5);assert.equal(state.grades.find(x=>x.id===grade.id).weight,2);assert(state.tasks[0].done);assert.equal(state.grades[0].id,'manual_grade');
 editing=true;now+=300001;const before=calls.length;await c.esAutoRefresh();assert.equal(calls.length,before);editing=false;
 doc.visibilityState='hidden';await c.esAutoRefresh();assert.equal(calls.length,before);doc.visibilityState='visible';
 c.pending={id:'pending'};await c.esAutoRefresh();assert.equal(calls.length,before);c.pending=null;
 let release;hold=new Promise(r=>release=r);const running=c.esAutoRefresh();await Promise.resolve();assert(c.auto.running);const during=calls.length;await c.esAutoRefresh();assert.equal(calls.length,during);release();await running;assert(!c.auto.running);
 state.settings.esAutoSync=false;now+=300001;const disabled=calls.length;await c.esAutoRefresh();assert.equal(calls.length,disabled);await c.esAutoRefresh(true);assert(calls.length>disabled);state.settings.esAutoSync=true;
 fail=true;now+=300001;await c.esAutoRefresh();assert.equal(c.auto.failures,1);assert.equal(c.auto.next-now,60000);assert(!c.auto.running);fail=false;now+=60001;await c.esAutoRefresh();assert.equal(c.auto.failures,0);
 session=false;now+=300001;await c.esAutoRefresh();assert(c.auto.blocked);const blocked=calls.length;now+=3600000;await c.esAutoRefresh();assert.equal(calls.length,blocked);
 assert.equal(c.esWeekDates('2027-01-01').join(','),'2026-12-28,2027-01-04');
 // Selecting an uncached week fetches it once, including an empty week.
 session=true;c.scheduleKnown=date=>state.scheduleRanges.some(r=>date>=r.start&&date<=r.end);c.render=()=>{};
 const originalRpc=c.esRpc;c.esRpc=async(method,input)=>{const result=await originalRpc(method,input);if(method==='eschoolRead'&&input.kind==='homework')result.schedules=[{range:{sourceKey:'es_12',start:input.date,end:new Clock(Clock.parse(input.date+'T12:00:00Z')+6*86400000).toISOString().slice(0,10)},lessons:[]}];return result;};
 vm.runInContext("esScheduleWanted='2026-09-28';",c);await c.esLoadSchedule();assert(c.scheduleKnown('2026-10-01'));const weekCalls=calls.length;
 vm.runInContext("esScheduleWanted='2026-09-28';",c);await c.esLoadSchedule();assert.equal(calls.length,weekCalls);
 const beforeUnchanged=saves;await c.esImportSnapshot({subjects:[],grades:[],tasks:[],schedules:[{range:{sourceKey:'es_12',start:'2026-09-28',end:'2026-10-04'},lessons:[]}]});assert.equal(saves,beforeUnchanged);
 console.log('PASS: automatic year + two-week refresh, five-minute scheduling, no unchanged writes, changed weights, manual data and task completion retained, no overlapping runs, pending/edit/hidden guards, toggle, retry backoff, auth pause, year boundary.');
})().catch(e=>{console.error(e);process.exitCode=1});
