/** Личный дневник «Отметка». Развёртывание: выполнять от своего имени, доступ — только я. */
function doGet() {
  const page = HtmlService.createTemplateFromFile('Index');
  page.appId = PropertiesService.getScriptProperties().getProperty('STORAGE_ID') || 'unconfigured';
  const output = page.evaluate().setTitle('eCalculator · мой средний балл')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .addMetaTag('mobile-web-app-capable', 'yes');
  const iconUrl = faviconUrl_();
  if(iconUrl&&/^https:\/\/[^\s]+$/.test(iconUrl))output.setFaviconUrl(iconUrl);
  return output;
}

/** Постоянный публичный PNG для значка вкладки во внешней оболочке Google. */
function faviconUrl_() {
  const custom = PropertiesService.getScriptProperties().getProperty('ICON_URL');
  if (custom && /^https:\/\/[^\s]+$/.test(custom)) return custom;
  return 'https://raw.githubusercontent.com/kirya2882/eschool_webapp/main/Icon.png';
}

/** Выполнить один раз в редакторе перед публикацией. Повторный запуск безопасен. */
function setup() {
  return locked_(function () {
    const props = PropertiesService.getScriptProperties();
    let id = props.getProperty('STORAGE_ID');
    if (!id) {
      const book = SpreadsheetApp.create('Отметка — мои предметы и оценки');
      const sheet = book.getSheets()[0];
      sheet.setName('Журнал');
      sheet.appendRow(['ID операции', 'Время UTC', 'Действие', 'Данные JSON']);
      sheet.setFrozenRows(1);
      sheet.getRange('A1:D1').setBackground('#7353c7').setFontColor('#ffffff').setFontWeight('bold');
      sheet.setColumnWidth(1, 290); sheet.setColumnWidth(2, 210);
      sheet.setColumnWidth(3, 160); sheet.setColumnWidth(4, 700);
      sheet.getRange('A:D').setNumberFormat('@');
      SpreadsheetApp.flush();
      id = book.getId();
      props.setProperty('STORAGE_ID', id);
    }
    const url = 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
    console.log('Таблица готова: ' + url);
    return url;
  });
}

function getState() {
  return locked_(function () { return read_().state; });
}

/** Единственная точка записи. Блокировка + версия + ID защищают от дублей и перезаписи. */
function mutate(request) {
  return locked_(function () {
    if (!request || typeof request !== 'object') throw new Error('Некорректный запрос.');
    checkId_(request.id);
    const data = read_();
    // Проверка повтора ДО проверки версии: ответ мог потеряться после успешной записи.
    if (data.ids.has(request.id)) return { ok: true, state: data.state };
    if (request.revision !== data.state.revision) {
      return { ok: false, conflict: true, state: data.state,
        message: 'Данные изменились на другом устройстве. Они обновлены; проверьте и сохраните ещё раз.' };
    }
    let event;
    try { event = validate_(request.event, data.state); }
    catch (error) { return { ok: false, state: data.state, message: error.message }; }
    const now = new Date().toISOString();
    // Одна операция — одна строка. Нет промежуточной очистки или перезаписи всех оценок.
    data.sheet.appendRow([request.id, now, event.type, JSON.stringify(event)]);
    SpreadsheetApp.flush();
    apply_(data.state, event);
    data.state.revision++;
    data.state.updatedAt = now;
    return { ok: true, state: data.state };
  });
}

function locked_(work) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return work(); } finally { lock.releaseLock(); }
}

function read_() {
  const id = PropertiesService.getScriptProperties().getProperty('STORAGE_ID');
  if (!id) throw new Error('Сначала запустите функцию setup в редакторе Apps Script.');
  const sheet = SpreadsheetApp.openById(id).getSheetByName('Журнал');
  if (!sheet) throw new Error('Не найден лист «Журнал». Восстановите его из истории Google Таблицы.');
  const state = { revision: 0, subjects: [], grades: [], tasks: [], lessons: [], scheduleRanges: [], scenarios: {}, settings: {}, updatedAt: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' };
  const ids = new Set();
  const count = sheet.getLastRow() - 1;
  if (count > 0) {
    const rows = sheet.getRange(2, 1, count, 4).getValues();
    rows.forEach(function (row) {
      if (!row[0] || !row[3]) throw new Error('В журнале повреждена строка. Восстановите таблицу из истории версий.');
      apply_(state, JSON.parse(String(row[3])));
      ids.add(String(row[0]));
      state.revision++;
      state.updatedAt = String(row[1]);
    });
  }
  return { state: state, ids: ids, sheet: sheet };
}

function checkId_(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(value)) throw new Error('Некорректный ID.');
  return value;
}

function text_(value, max) {
  if (typeof value !== 'string' || value.length > max) throw new Error('Текст слишком длинный или некорректный.');
  return value.trim();
}

function validate_(input, state) {
  if (!input || typeof input !== 'object') throw new Error('Нет данных операции.');
  const e = { type: input.type, id: checkId_(input.id) };
  const subject = state.subjects.find(function (s) { return s.id === e.id; });
  const grade = state.grades.find(function (g) { return g.id === e.id; });
  switch (e.type) {
    case 'subject.add':
    case 'subject.edit':
      e.name = text_(input.name, 60);
      if (!e.name) throw new Error('Введите название предмета.');
      if (e.type === 'subject.add' && subject) throw new Error('Предмет уже существует.');
      if (e.type === 'subject.edit' && !subject) throw new Error('Предмет уже удалён.');
      if (state.subjects.some(function (s) { return s.id !== e.id && s.name.toLocaleLowerCase() === e.name.toLocaleLowerCase(); })) throw new Error('Предмет с таким названием уже есть.');
      break;
    case 'subject.delete':
      if (!subject) throw new Error('Предмет уже удалён.');
      break;
    case 'grade.add':
    case 'grade.edit':
      e.subjectId = checkId_(input.subjectId);
      if (!state.subjects.some(function (s) { return s.id === e.subjectId; })) throw new Error('Сначала добавьте предмет.');
      if (e.type === 'grade.add' && grade) throw new Error('Оценка уже существует.');
      if (e.type === 'grade.edit' && !grade) throw new Error('Оценка уже удалена.');
      e.value = input.value; e.weight = input.weight;
      if (!Number.isInteger(e.value) || e.value < 1 || e.value > 5) throw new Error('Оценка должна быть целым числом от 1 до 5.');
      if (typeof e.weight !== 'number' || !Number.isFinite(e.weight) || e.weight <= 0 || e.weight > 100) throw new Error('Коэффициент должен быть больше 0 и не больше 100.');
      e.modifier = input.modifier || '';
      if (!['', '+', '-'].includes(e.modifier)) throw new Error('Некорректный знак оценки.');
      e.note = text_(input.note || '', 160);
      e.date = text_(input.date, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(Date.parse(e.date)) || new Date(e.date).toISOString().slice(0, 10) !== e.date) throw new Error('Введите корректную дату.');
      break;
    case 'grade.delete':
      if (!grade) throw new Error('Оценка уже удалена.');
      break;
    default: return validateExtension_(input, state);
  }
  return e;
}

function apply_(state, e) {
  switch (e.type) {
    case 'subject.add': state.subjects.push({ id: e.id, name: e.name }); break;
    case 'subject.edit': state.subjects.forEach(function (s) { if (s.id === e.id) s.name = e.name; }); break;
    case 'subject.delete':
      state.subjects = state.subjects.filter(function (s) { return s.id !== e.id; });
      state.grades = state.grades.filter(function (g) { return g.subjectId !== e.id; });
      if (state.scenarios) delete state.scenarios[e.id]; break;
    case 'grade.add':
    case 'grade.edit':
      const index = state.grades.findIndex(function (g) { return g.id === e.id; });
      const grade = { ...(index<0?{}:state.grades[index]), id: e.id, subjectId: e.subjectId, value: e.value, weight: e.weight, modifier: e.modifier || '', note: e.note, date: e.date };
      if (index < 0) state.grades.push(grade); else state.grades[index] = grade;
      break;
    case 'grade.delete':
      state.grades = state.grades.filter(function (g) { return g.id !== e.id; });
      Object.keys(state.scenarios || {}).forEach(key => { state.scenarios[key] = state.scenarios[key].filter(op => op.gradeId !== e.id); }); break;
    default: applyExtension_(state, e);
  }
}
