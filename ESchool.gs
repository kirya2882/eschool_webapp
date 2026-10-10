/** eSchool: read-only school data. Remembered credentials live only in private UserProperties. */
function eschoolLogin(input) {
  if (!input || typeof input.username !== 'string' || typeof input.password !== 'string' || !input.username.trim() || !input.password || input.username.length > 200 || input.password.length > 500) throw new Error('Введи логин и пароль eSchool.');
  const account = { username:input.username.trim(), passwordHash:esHash_(input.password) };
  const session = esAuthorize_(account);
  // This hash is a login credential, not encryption. Keep it server-side, never in Sheets/HTML.
  session.key=Utilities.getUuid();
  PropertiesService.getUserProperties().setProperties({eschool_account:JSON.stringify(account),eschool_session_key:session.key});
  esPut_(session);
  return eschoolInfo();
}
function esAuthorize_(account) {
  const session = { cookies:{}, user:null };
  const device={cliType:'web',cliVer:'4.0.0-web',pushToken:(Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,''),deviceId:Utilities.getUuid().replace(/-/g,''),deviceName:'eCalculator Web',deviceModel:'Apps Script',cliOs:'Web',cliOsVer:'1'};
  esRequest_('/login', session, 'post', 'username=' + encodeURIComponent(account.username) + '&password=' + encodeURIComponent(account.passwordHash)+'&device='+encodeURIComponent(JSON.stringify(device)), true);
  const state = esRequest_('/state', session, undefined, undefined, true);
  if (!state.authenticated || !state.user) throw new Error('eSchool не подтвердил вход. Войди заново.');
  if (state.user.currentPosition && state.user.currentPosition.posTypeCode !== 'S') throw new Error('Нужна роль «Ученик». Выбери её на сайте eSchool.');
  session.user = { userId:state.user.userId, prsId:state.user.prsId, orgYearId:state.user.orgYearId };
  if (!session.user.userId || !session.user.prsId) throw new Error('eSchool не вернул идентификатор ученика.');
  return session;
}
function esHash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function eschoolInfo() {
  const session = esGet_(false);
  if (!session) return { connected: false };
  const classes = esArray_(esRequest_('/usr/getClassByUser?userId=' + encodeURIComponent(session.user.userId), session));
  const years = esArray_(esRequest_('/yearplan/academyears', session));
  session.classes = classes.map(c => ({ yearId:c.yearId, groupId:c.groupId }));
  session.years = years.map(y => ({ yearId:y.yearId, name:y.name || y.yearName || (String(y.bvt || '').slice(0,4) + ' / ' + String(y.evt || '').slice(0,4)), start:y.bvt, end:y.evt }));
  esPut_(session);
  return { connected: true, remembered:!!esAccount_(), years: session.years.filter(y => classes.some(c => c.yearId === y.yearId)), currentYearId:session.user.orgYearId };
}
function eschoolPeriods(input) {
  const session = esGet_(), group = (session.classes || []).find(c => String(c.yearId) === String(input.yearId));
  if (!group) throw new Error('Не найден класс для выбранного учебного года.');
  const data = esRequest_('/dict/periods/0?groupId=' + encodeURIComponent(group.groupId), session);
  const periods = (data.items || esArray_(data)).map(p => ({ id:p.id, name:p.name, start:String(p.date1 || '').slice(0,10), end:String(p.date2 || '').slice(0,10) })).filter(p => p.id && p.start && p.end);
  session.periods = periods;session.periodYearId=input.yearId;esPut_(session);
  return periods;
}
function eschoolRead(input) {
  if(input.kind==='homework')return eschoolHomework_(input);
  if(input.kind==='task')return eschoolTask_(input);
  if(input.kind==='file')return eschoolFile_(input);
  let session=esGet_();
  if(input.yearId!==undefined&&String(session.periodYearId)!==String(input.yearId)){eschoolPeriods({yearId:input.yearId});session=esGet_();}
  const period=(session.periods||[]).find(p=>String(p.id)===String(input.periodId));
  if (!period) throw new Error('Сначала выбери учебный период.');
  const query = '?userId=' + encodeURIComponent(session.user.userId) + '&eiId=' + encodeURIComponent(period.id);
  const units = esArray_(esRequest_('/student/getDiaryUnits/' + query, session));
  const lessons = esArray_(esRequest_('/student/getDiaryPeriod_' + query, session));
  const result = esNormalize_(units, lessons, session.user.userId, period);
  // No raw account credentials or server payloads are exposed to the client.
  esPut_(session);return result;
}
function eschoolLogout() {
  const session=esGet_(false, true), props=PropertiesService.getUserProperties();
  // Forget credentials first: logout must never trigger automatic reauthentication.
  props.deleteProperty('eschool_account');
  esClearSession_();
  if(session){try{esRequest_('/logout_me',session,undefined,undefined,true);}catch(e){/* Local sign-out is complete even if eSchool is unavailable. */}}
  return {connected:false};
}
function esStoredSession_() {
  const props=PropertiesService.getUserProperties(), count=Number(props.getProperty('eschool_session_count')||0);
  if(!Number.isInteger(count)||count<1||count>20)return null;
  let encoded='';for(let i=0;i<count;i++){const chunk=props.getProperty('eschool_session_'+i);if(chunk===null)return null;encoded+=chunk;}
  try{return JSON.parse(decodeURIComponent(encoded));}catch(e){return null;}
}
function esGet_(required, noRecovery) {
  let session=esStoredSession_();
  if(!session){
    const legacy=CacheService.getUserCache().get('eschool_session');
    if(legacy){try{session=JSON.parse(legacy);delete session.expiresAt;session.key=Utilities.getUuid();PropertiesService.getUserProperties().setProperty('eschool_session_key',session.key);esPut_(session);}catch(e){session=null;}}
  }
  if(!session&&!noRecovery){const account=esAccount_();if(account){session=esAuthorize_(account);session.key=PropertiesService.getUserProperties().getProperty('eschool_session_key');esPut_(session);}}
  if(!session&&required!==false)throw new Error('Войди в eSchool, чтобы включить обновление.');
  return session;
}
function esAccount_(){const raw=PropertiesService.getUserProperties().getProperty('eschool_account');if(!raw)return null;try{const account=JSON.parse(raw);return typeof account.username==='string'&&/^[a-f0-9]{64}$/.test(account.passwordHash)?account:null;}catch(e){return null;}}
function esPut_(session){
  delete session.expiresAt;
  const props=PropertiesService.getUserProperties(), encoded=encodeURIComponent(JSON.stringify(session)), count=Math.ceil(encoded.length/6000);
  if(count>20)throw new Error('Слишком большой ответ eSchool. Войди заново.');
  if(!session.key||props.getProperty('eschool_session_key')!==session.key)throw new Error('Сессия завершена. Войди в eSchool заново.');
  const oldCount=Math.min(20,Number(props.getProperty('eschool_session_count')||0)), values={eschool_session_count:String(count)};
  for(let i=0;i<count;i++)values['eschool_session_'+i]=encoded.slice(i*6000,(i+1)*6000);
  props.setProperties(values);
  for(let i=count;i<oldCount;i++)props.deleteProperty('eschool_session_'+i);
  CacheService.getUserCache().remove('eschool_session');
}
function esClearSession_(){const props=PropertiesService.getUserProperties();props.deleteProperty('eschool_session_key');for(let i=0;i<20;i++)props.deleteProperty('eschool_session_'+i);props.deleteProperty('eschool_session_count');CacheService.getUserCache().remove('eschool_session');}
function esRecover_(session){
  const account=esAccount_();if(!account)throw new Error('Войди в eSchool ещё раз, чтобы запомнить вход.');
  const renewed=esAuthorize_(account);
  if(session.user&&String(session.user.userId)!==String(renewed.user.userId))throw new Error('Аккаунт изменился. Открой eSchool в настройках.');
  session.cookies=renewed.cookies;session.user=renewed.user;esPut_(session);
}
function esArray_(data){if(Array.isArray(data))return data;if(data&&Array.isArray(data.result))return data.result;throw new Error('eSchool вернул неожиданный формат данных.');}
function esRequest_(path,session,method,payload,retried){
  if(!/^\/(login|state|logout_me|usr\/getClassByUser|yearplan\/academyears|dict\/periods\/0|dict\/ringsUsing|student\/getDiaryUnits\/|student\/getDiaryPeriod_|student\/getPrsDiary|student\/getLPartPupil)(\?|$)/.test(path))throw new Error('Недопустимый запрос eSchool.');
  const cookie=Object.keys(session.cookies).map(k=>k+'='+session.cookies[k]).join('; ');
  const response=UrlFetchApp.fetch('https://app.eschool.center/ec-server'+path,{method:method||'get',headers:{'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',Cookie:cookie,Accept:'application/json','Origin':'https://app.eschool.center','Referer':'https://app.eschool.center/'},contentType:payload?'application/x-www-form-urlencoded':undefined,payload:payload||undefined,followRedirects:false,muteHttpExceptions:true});
  const headers=response.getAllHeaders();
  Object.keys(headers).filter(k=>k.toLowerCase()==='set-cookie').forEach(k=>{const list=Array.isArray(headers[k])?headers[k]:[headers[k]];list.forEach(row=>String(row).split(/,(?=\s*[^;,=]+=[^;,]*)/).forEach(part=>{const match=/^\s*([^=;\s]+)=([^;]*)/.exec(part);if(match)session.cookies[match[1]]=match[2];}));});
  const status=response.getResponseCode();
  if(status===401||status===403){if(!retried&&path!=='/login'&&path!=='/logout_me'){esRecover_(session);return esRequest_(path,session,method,payload,true);}throw new Error('Нужен повторный вход в eSchool. Проверь пароль; при двухфакторной защите используй официальный сайт.');}
  if(status===429)throw new Error('Слишком много обращений к eSchool. Повтори позже.');
  if(status>=400){let code='';try{const b=JSON.parse(response.getContentText());if(typeof b==='number')code='; код '+b;else if(b&&typeof b.code==='string'&&/^[A-Z0-9_]{1,60}$/.test(b.code))code='; '+b.code;}catch(e){}throw new Error('Ответ eSchool: HTTP '+status+code+' ('+path.split('?')[0]+').');}
  if(path==='/login'&&(status===302||status===303||status===200||status===204))return {};
  if(status>=300){if(!retried&&path!=='/login'&&path!=='/logout_me'){esRecover_(session);return esRequest_(path,session,method,payload,true);}throw new Error('Нужен повторный вход в eSchool на официальном сайте.');}
  let data;try{data=JSON.parse(response.getContentText());}catch(e){throw new Error('eSchool вернул ответ, который не удалось прочитать.');}
  if(data&&data.noAccess)throw new Error('В eSchool нет доступа к этому разделу.');
  return data;
}
function esNormalize_(units,lessons,userId,period){
  const subjects=[],grades=[],warnings=[];
  const idFor=(kind,value)=>'es_'+kind+'_'+String(userId)+'_'+String(value).replace(/[^a-zA-Z0-9_-]/g,'_');
  const byUnit={};
  units.forEach(u=>{const id=idFor('s',u.unitId);if(!byUnit[u.unitId]){byUnit[u.unitId]={id,name:String(u.unitName||u.name||'Предмет').slice(0,60)};subjects.push(byUnit[u.unitId]);}});
  lessons.forEach(lesson=>{
    const sub=byUnit[lesson.unitId];if(!sub){warnings.push('Пропущен урок без предмета.');return;}
    (lesson.part||[]).forEach(part=>(part.mark||[]).forEach((mark,i)=>{
      const raw=String(mark.mrkShortValue||mark.markValue||'').trim(), match=/^([1-5])([+−-]?)$/.exec(raw);
      if(!match){warnings.push('Нечисловая отметка «'+raw+'» не участвует в среднем балле.');return;}
      const weight=Number(part.mrkWt ?? 1),date=String(lesson.startDt||'').slice(0,10);
      if(!Number.isFinite(weight)||weight<=0||weight>100||!/^\d{4}-\d{2}-\d{2}$/.test(date)){warnings.push('Пропущена оценка с неизвестной датой или весом.');return;}
      const id=idFor('g',String(lesson.lessonId)+'_'+String(part.lesPartId??part.partId)+'_'+String(mark.markId??i));
      if(grades.some(g=>g.id===id))return;
      grades.push({id,lessonId:idFor('l',lesson.lessonId),subjectId:sub.id,value:Number(match[1]),modifier:match[2]==='−'?'-':match[2],weight,date,note:String(part.lptName||'eSchool').slice(0,160)});
    }));
  });
  return {subjects,grades,warnings:[...new Set(warnings)],period};
}

function eschoolHomework_(input){
  const session=esGet_();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new Error('Выбери дату.');
  const start=Date.parse(input.date+'T00:00:00+03:00'),end=start+7*86400000-1;
  const data=esRequest_('/student/getPrsDiary?prsId='+encodeURIComponent(session.user.prsId)+'&d1='+start+'&d2='+end,session);
    const tasks=[],warnings=[];
  let rings=[];try{rings=esArray_(esRequest_('/dict/ringsUsing?yearId='+encodeURIComponent(session.user.orgYearId),session));}catch(e){warnings.push('Не удалось загрузить время звонков.');}
  if(!session.schoolTimeZone){const info=esRequest_('/state',session);session.schoolTimeZone=info.user?.currentPosition?.timeZone?.timeZone||'Europe/Moscow';}

  for(const lesson of data.lesson||[]){
    for(const part of lesson.part||[]){
      if(!part.hasTask)continue;
      const detail=esTaskData_(part.id,session);
      const html=String(detail.taskText||'');
      if(html.length>16000){warnings.push('Длинный текст задания сокращён в карточке.');}
      const date=typeof lesson.date==='number'?new Date(lesson.date+10800000).toISOString().slice(0,10):String(lesson.date).slice(0,10);
      tasks.push({id:'es_t_'+session.user.userId+'_'+part.id,subject:String(lesson.unit?.name||detail.unitName||'Задание eSchool').slice(0,60),date,text:esPlain_(html).slice(0,4000)||'Материалы к заданию' ,html:html.slice(0,16000),remotePartId:String(part.id),lessonId:'es_l_'+session.user.userId+'_'+lesson.id,attachments:detail.files.length,files:detail.files,done:false,source:'eschool'});
    }
  }
  const schedule=esSchedule_(data.lesson||[],session.user.userId,input.date,rings,session.schoolTimeZone);
  esPut_(session);return {subjects:[],grades:[],tasks,schedules:[schedule],warnings:[...new Set(warnings)]};
}

function esSchoolDate_(value){return typeof value==='number'?new Date(value+10800000).toISOString().slice(0,10):String(value||'').slice(0,10);}
function esSchedule_(lessons,userId,start,rings=[],timeZone='Europe/Moscow'){
  const end=new Date(Date.parse(start+'T12:00:00Z')+6*86400000).toISOString().slice(0,10),sourceKey='es_'+userId;
  const items=lessons.map(lesson=>({id:'es_l_'+userId+'_'+lesson.id,subjectId:lesson.unit?.id?'es_s_'+userId+'_'+lesson.unit.id:'',subject:String(lesson.unit?.name||lesson.subject||'Урок').slice(0,60),...esLessonTime_(lesson,rings,timeZone),date:esSchoolDate_(lesson.date),number:Number.isInteger(lesson.numInDay)&&lesson.numInDay>=0?lesson.numInDay:0,room:String(lesson.classroomShortName||lesson.classroomName||'').slice(0,80),taskIds:(lesson.part||[]).filter(part=>part.hasTask).map(part=>'es_t_'+userId+'_'+part.id)})).filter(l=>l.date>=start&&l.date<=end).sort((a,b)=>a.date.localeCompare(b.date)||a.number-b.number||a.id.localeCompare(b.id));
  return {range:{sourceKey,start,end},lessons:items};
}

function eschoolTask_(input){return esTaskData_(input.partId,esGet_());}
function esTaskData_(id,session){
  if(!/^\d+$/.test(String(id)))throw new Error('Некорректное задание.');
  const response=esRequest_('/student/getLPartPupil?partId='+encodeURIComponent(id)+'&prsId='+encodeURIComponent(session.user.prsId),session);
  const detail=response.result?.[0];if(response.error||!detail)throw new Error('Задание недоступно в eSchool.');
  if(detail.viewLimitDt&&new Date(detail.viewLimitDt).getTime()>Date.now())return {taskText:'Задание ещё не открыто преподавателем.',files:[]};
  return {taskText:String(detail.taskText||''),unitName:detail.unitName,files:esTaskFiles_(detail)};
}
function esPlain_(html){return String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>|<\/(p|div|li)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();}

function esLessonTime_(lesson,sets,timeZone){
 const set=sets.find(s=>String(s.id)===String(lesson.rngId)),ring=set?.rings?.find(r=>Number(r.num)===Number(lesson.numInDay));
 if(!ring||!Number.isFinite(ring.date1)||!Number.isFinite(ring.date2))return {startTime:'',endTime:'',timeZone};
 const fmt=n=>new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(n));
 return {startTime:fmt(ring.date1),endTime:fmt(ring.date2),timeZone};
}
function esTaskFiles_(detail){
 const seen=new Set();return (detail.attach||[]).filter(f=>Number(f.is_result)!==1).map(f=>({id:String(f.fileId||''),variantId:String(detail.varId||''),name:String(f.fileName||'Файл').replace(/[\/\\\x00-\x1f]/g,'_').slice(0,240),size:Math.max(0,Number(f.fileSize)||0),mime:String(f.fileType||'application/octet-stream').slice(0,120)})).filter(f=>/^\d+$/.test(f.id)&&/^\d+$/.test(f.variantId)&&!seen.has(f.id)&&seen.add(f.id));
}
function eschoolFile_(input,retried){
 const session=esGet_(),task=esTaskData_(input.partId,session),file=task.files.find(f=>f.id===String(input.fileId));
 if(!file)throw new Error('Файл больше не прикреплён к этому заданию. Обнови задание.');
 const offset=Number(input.offset||0),chunkSize=1048576;
 if(!Number.isSafeInteger(offset)||offset<0||offset>52428800)throw new Error('Некорректная часть файла.');
 const response=UrlFetchApp.fetch('https://app.eschool.center/ec-server/files/HOMEWORK_VARIANT/'+file.variantId+'/'+file.id,{headers:{'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36','Referer':'https://app.eschool.center/','Origin':'https://app.eschool.center',Cookie:Object.keys(session.cookies).map(k=>k+'='+session.cookies[k]).join('; '),Accept:'application/octet-stream',Range:'bytes='+offset+'-'+(offset+chunkSize-1)},followRedirects:false,muteHttpExceptions:true});
 const status=response.getResponseCode();
 if((status===401||status===403)&&!retried){esRecover_(session);return eschoolFile_(input,true);}
 if(status!==200&&status!==206)throw new Error('Не удалось скачать файл: HTTP '+status+'.');
 let base64,total,length;
 if(typeof response.getBlob==='function'){
  const headers=response.getAllHeaders(),range=String(Object.keys(headers).find(k=>k.toLowerCase()==='content-range')?headers[Object.keys(headers).find(k=>k.toLowerCase()==='content-range')]:'');
  let bytes=response.getBlob().getBytes();
  if(status===206){const parsed=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);if(!parsed||Number(parsed[1])!==offset||Number(parsed[2])-offset+1!==bytes.length)throw new Error('Сервер вернул другую часть файла.');}
  total=status===206?Number(range.split('/')[1]):bytes.length;
  if(status===200)bytes=bytes.slice(offset,offset+chunkSize);length=bytes.length;base64=Utilities.base64Encode(bytes);
 }else{const part=JSON.parse(response.getContentText());base64=part.base64;total=part.total;length=part.length;}
 if(!Number.isSafeInteger(total)||total<1||total>52428800||!length)throw new Error('Файл слишком большой или сервер вернул неполные данные.');
 esPut_(session);return {name:file.name,mime:file.mime,base64,total,next:offset+length,done:offset+length>=total};
}
