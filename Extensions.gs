/** Additional journal events for homework, settings and independent calculation scenarios. */
function validateExtension_(input, state) {
  const e = { type: input.type, id: checkId_(input.id) };
  switch (e.type) {
    case 'eschool.import':
      if (!Array.isArray(input.subjects) || !Array.isArray(input.grades) || input.subjects.length > 100 || input.grades.length > 50) throw new Error('Слишком большой пакет импорта.');
      e.subjects = input.subjects.map(s => {
        if (!String(s.id).startsWith('es_s_')) throw new Error('Некорректный предмет eSchool.');
        const name = text_(s.name,60);if(!name)throw new Error('Нет названия предмета.');
        return {id:checkId_(s.id),name,source:'eschool'};
      });
      const importedState={...state,subjects:state.subjects.concat(e.subjects)};
      e.grades=input.grades.map(g=>{
        if(!String(g.id).startsWith('es_g_') || !String(g.subjectId).startsWith('es_s_'))throw new Error('Некорректная оценка eSchool.');
        const event=validate_({...g,type:state.grades.some(item=>item.id===g.id)?'grade.edit':'grade.add'},importedState);
        delete event.type;return {...event,...(g.lessonId?{lessonId:checkId_(g.lessonId)}:{}),source:'eschool'};
      });
      if(input.tasks!==undefined&&(!Array.isArray(input.tasks)||input.tasks.length>2))throw new Error('Слишком большой пакет заданий.');
      e.tasks=(input.tasks||[]).map(t=>{
        if(!String(t.id).startsWith('es_t_')||!/^\d+$/.test(String(t.remotePartId)))throw new Error('Некорректное задание eSchool.');
        return {id:checkId_(t.id),subject:text_(t.subject,60),text:text_(t.text,4000),html:text_(t.html||'',16000),date:dateText_(t.date),remotePartId:String(t.remotePartId),...(t.lessonId?{lessonId:checkId_(t.lessonId)}:{}),attachments:Math.max(0,Math.min(1000,Number(t.attachments)||0)),files:validateTaskFiles_(t.files),source:'eschool',done:false};
      });
      if(JSON.stringify(e).length>45000)throw new Error('Пакет импорта слишком большой.');
      break;
    case 'schedule.replace':
      if(!input.range||!/^es_\d+$/.test(input.range.sourceKey))throw new Error('Некорректный источник расписания.');
      e.range={sourceKey:input.range.sourceKey,start:dateText_(input.range.start),end:dateText_(input.range.end)};
      if(Date.parse(e.range.end)-Date.parse(e.range.start)!==6*86400000)throw new Error('Расписание загружается на семь дней.');
      if(!Array.isArray(input.lessons)||input.lessons.length>200)throw new Error('Слишком большое расписание.');
      const owner=e.range.sourceKey.slice(3),seen=new Set();
      e.lessons=input.lessons.map(l=>{
        const id=checkId_(l.id),date=dateText_(l.date),subject=text_(l.subject,60),subjectId=l.subjectId?checkId_(l.subjectId):'';
        if(!id.startsWith('es_l_'+owner+'_')||seen.has(id)||!subject||date<e.range.start||date>e.range.end||subjectId&&!subjectId.startsWith('es_s_'+owner+'_'))throw new Error('Некорректный урок.');
        seen.add(id);
        if(!Number.isInteger(l.number)||l.number<0||l.number>99||!Array.isArray(l.taskIds)||l.taskIds.length>30)throw new Error('Некорректный номер урока или задания.');
        const taskIds=l.taskIds.map(id=>{checkId_(id);if(!id.startsWith('es_t_'+owner+'_'))throw new Error('Некорректная связь задания.');return id;});
        const time=v=>{if(!v)return '';if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw new Error('Некорректное время урока.');return v;};
        return {id,subjectId,subject,date,startTime:time(l.startTime),endTime:time(l.endTime),timeZone:text_(l.timeZone||'',80),number:l.number,room:text_(l.room||'',80),taskIds,sourceKey:e.range.sourceKey};
      });
      if(JSON.stringify(e).length>45000)throw new Error('Слишком большой пакет расписания.');
      break;
    case 'task.add':
    case 'task.edit':
      const task = (state.tasks || []).find(t => t.id === e.id);
      if (e.type === 'task.add' && task) throw new Error('Задание уже существует.');
      if (e.type === 'task.edit' && !task) throw new Error('Задание уже удалено.');
      e.subject = text_(input.subject, 60);
      e.text = text_(input.text, 4000);
      if (!e.subject || !e.text) throw new Error('Заполните предмет и задание.');
      e.date = dateText_(input.date);
      e.done = input.done === true;
      break;
    case 'task.delete':
      if (!(state.tasks || []).some(t => t.id === e.id)) throw new Error('Задание уже удалено.');
      break;
    case 'settings.save':
      if (!input.settings || typeof input.settings !== 'object') throw new Error('Нет настроек.');
      e.settings = {};
      const rules = { theme: ['system', 'light', 'dark'], periodType: ['quarters', 'semesters', 'halves', 'year'] };
      Object.keys(rules).forEach(key => {
        if (input.settings[key] !== undefined) {
          if (!rules[key].includes(input.settings[key])) throw new Error('Некорректная настройка: ' + key);
          e.settings[key] = input.settings[key];
        }
      });
      if (input.settings.signValue !== undefined) {
        if (![0.25, 0.5].includes(input.settings.signValue)) throw new Error('Выберите 0,25 или 0,5.');
        e.settings.signValue = input.settings.signValue;
      }
      if(input.settings.esAutoSync!==undefined){if(typeof input.settings.esAutoSync!=='boolean')throw new Error('Некорректная настройка обновления.');e.settings.esAutoSync=input.settings.esAutoSync;}
      if (input.settings.plusMinus !== undefined) e.settings.plusMinus = input.settings.plusMinus === true;
      if (input.settings.academicYear !== undefined) {
        const year = Number(input.settings.academicYear);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Некорректный учебный год.');
        e.settings.academicYear = year;
      }
      if (input.settings.period !== undefined) {
        if (!Number.isInteger(input.settings.period) || input.settings.period < 0 || input.settings.period > 4) throw new Error('Некорректный учебный период.');
        e.settings.period = input.settings.period;
      }
      if (input.settings.calendar !== undefined) {
        const calendar = input.settings.calendar;
        if (!calendar || typeof calendar !== 'object' || Array.isArray(calendar) || Object.keys(calendar).length > 80) throw new Error('Некорректный календарь.');
        e.settings.calendar = {};
        Object.keys(calendar).forEach(key => {
          const match = /^(20\d{2}|2100)_(quarters|semesters|halves|year)$/.exec(key);
          if (!match) throw new Error('Некорректный учебный год календаря.');
          const count = match[2] === 'quarters' ? 4 : match[2] === 'year' ? 1 : 2;
          const ranges = calendar[key];
          if (!Array.isArray(ranges) || ranges.length !== count) throw new Error('Проверь количество учебных периодов.');
          const year = Number(match[1]);
          e.settings.calendar[key] = ranges.map((range, i) => {
            if (!Array.isArray(range) || range.length !== 2) throw new Error('Некорректные границы периода.');
            const start = dateText_(range[0]), end = dateText_(range[1]);
            if (start > end || start < year + '-09-01' || end > (year + 1) + '-08-31' || i > 0 && start <= ranges[i - 1][1]) throw new Error('Периоды должны идти по порядку, не пересекаться и входить в учебный год с сентября по август.');
            return [start, end];
          });
        });
      }
      break;
    case 'scenario.save':
      if (!Array.isArray(input.operations) || input.operations.length > 300) throw new Error('Слишком много изменений сценария.');
      if (!state.subjects.some(s => s.id === e.id) && e.id !== 'free_calculator') throw new Error('Предмет не найден.');
      e.operations = input.operations.map(op => {
        const item = { id: checkId_(op.id), kind: op.kind };
        if (!['add', 'edit', 'exclude'].includes(item.kind)) throw new Error('Неизвестное изменение сценария.');
        if (item.kind !== 'add') {
          item.gradeId = checkId_(op.gradeId);
          if (!state.grades.some(g => g.id === item.gradeId && g.subjectId === e.id)) throw new Error('Исходная оценка больше не существует.');
        }
        if (item.kind !== 'exclude') {
          item.value = op.value; item.weight = op.weight; item.modifier = op.modifier || '';
          if (!Number.isInteger(item.value) || item.value < 1 || item.value > 5) throw new Error('Оценка должна быть от 1 до 5.');
          if (typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight <= 0 || item.weight > 100) throw new Error('Некорректный коэффициент.');
          if (!['', '+', '-'].includes(item.modifier)) throw new Error('Некорректный знак оценки.');
        }
        return item;
      });
      if (JSON.stringify(e).length > 40000) throw new Error('Сценарий слишком большой.');
      break;
    default: throw new Error('Неизвестная операция.');
  }
  return e;
}

function dateText_(value) {
  const date = text_(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Введите корректную дату.');
  return date;
}

function applyExtension_(state, e) {
  if (!state.tasks) state.tasks = [];
  if (!state.settings) state.settings = {};
  if (!state.scenarios) state.scenarios = {};
  if (!state.lessons) state.lessons = [];
  if (!state.scheduleRanges) state.scheduleRanges = [];
  switch (e.type) {
    case 'eschool.import':
      e.subjects.forEach(s=>{const index=state.subjects.findIndex(x=>x.id===s.id);if(index<0)state.subjects.push(s);else state.subjects[index]=s;});
      e.grades.forEach(g=>{const index=state.grades.findIndex(x=>x.id===g.id);if(index<0)state.grades.push(g);else state.grades[index]=g;});
      (e.tasks||[]).forEach(t=>{const index=state.tasks.findIndex(x=>x.id===t.id);if(index<0)state.tasks.push(t);else state.tasks[index]={...t,done:state.tasks[index].done};});
      break;
    case 'schedule.replace':
      const newIds=new Set(e.lessons.map(l=>l.id));
      state.lessons=state.lessons.filter(l=>!newIds.has(l.id)&&!(l.sourceKey===e.range.sourceKey&&l.date>=e.range.start&&l.date<=e.range.end)).concat(e.lessons);
      state.scheduleRanges=state.scheduleRanges.filter(r=>!(r.sourceKey===e.range.sourceKey&&r.start===e.range.start&&r.end===e.range.end)).concat([e.range]);
      break;
    case 'task.add':
    case 'task.edit':
      const i = state.tasks.findIndex(t => t.id === e.id);
      const task = { ...(i<0?{}:state.tasks[i]), id: e.id, subject: e.subject, text: e.text, date: e.date, done: e.done };
      if (i < 0) state.tasks.push(task); else state.tasks[i] = task;
      break;
    case 'task.delete': state.tasks = state.tasks.filter(t => t.id !== e.id); break;
    case 'settings.save': Object.assign(state.settings, e.settings); break;
    case 'scenario.save': state.scenarios[e.id] = e.operations; break;
    default: throw new Error('Неизвестная запись в журнале.');
  }
}

function validateTaskFiles_(files){
 if(files===undefined)return [];
 if(!Array.isArray(files)||files.length>100)throw new Error('Слишком много файлов у задания.');
 return files.map(f=>{if(!/^\d+$/.test(String(f.id))||!/^\d+$/.test(String(f.variantId)))throw new Error('Некорректный файл задания.');return {id:String(f.id),variantId:String(f.variantId),name:text_(f.name,240),size:Math.max(0,Number(f.size)||0),mime:text_(f.mime||'application/octet-stream',120)};});
}
