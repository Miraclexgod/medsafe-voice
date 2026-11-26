{
// ===== Состояние =====
const KEY = 'medsafe-voice-v1';
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);

const freshState = () => ({
  patient: { name: 'Айгерим С.', age: '34', weight: '', allergies: ['пенициллин'], chronic: ['хронический гастрит'], meds: ['аспирин 100 мг'] },
  card: { complaints: [], anamnesis: [], prescriptions: [], notes: [], labs: [] },
  risks: [], missing: [], suggested: [], reminders: [], mood: [], plan: null
});
let S = freshState();
try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved && saved.card) S = { ...freshState(), ...saved }; } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

let aiMode = 'demo'; // 'live' — работает Gemini, 'demo' — встроенные примеры ответов

// ===== Демо-ответы (если ИИ не подключён) =====
const SAMPLE_TEXT = 'Пациентка Серикова Айгерим Нурлановна, телефон +7 701 123 45 67. Жалуется на кашель с мокротой и температуру до 38,5 уже три дня, слабость. В анамнезе хронический гастрит, аллергия на пенициллин. Назначаю амоксициллин 500 мг три раза в день семь дней и ибупрофен 400 мг при температуре выше 38.';
const DEMO = {
  visit: {
    summary: 'Разобрал запись приёма: 3 жалобы, 2 пункта анамнеза, 2 назначения. Найден высокий риск: амоксициллин относится к пенициллинам, а у пациентки аллергия на пенициллин.',
    complaints: ['Кашель с мокротой 3 дня', 'Температура до 38,5 °C', 'Слабость'],
    anamnesis: ['Хронический гастрит', 'Аллергия на пенициллин'],
    prescriptions: [{ name: 'Амоксициллин', dose: '500 мг', schedule: '3 раза в день, 7 дней' }, { name: 'Ибупрофен', dose: '400 мг', schedule: 'при температуре выше 38 °C' }],
    notes: [], labs: [],
    risks: [
      { level: 'high', title: 'Аллергия на назначенный препарат', explanation: 'Амоксициллин — антибиотик группы пенициллинов. При аллергии на пенициллин возможна тяжёлая реакция. Нужна замена препарата врачом.', source: 'база знаний, правило R1' },
      { level: 'medium', title: 'Ибупрофен + аспирин при гастрите', explanation: 'Оба препарата раздражают слизистую желудка. Вместе и на фоне гастрита выше риск обострения и кровотечения.', source: 'база знаний, правила R3 и R4' }
    ],
    missing: ['Вес пациента', 'Максимальная суточная доза ибупрофена', 'Дата последних анализов'],
    reminders: [{ title: 'Амоксициллин 500 мг (после проверки врачом)', when: '08:00, 14:00, 20:00 — 7 дней' }, { title: 'Измерить температуру', when: 'утром и вечером' }]
  },
  lab: {
    summary: 'Распознал общий анализ крови: 5 показателей, 3 вне нормы. Повышенные лейкоциты и СОЭ согласуются с воспалением, гемоглобин снижен.',
    complaints: [], anamnesis: [], prescriptions: [], notes: [],
    labs: [
      { name: 'Гемоглобин', value: '108', unit: 'г/л', ref: '120–140', status: 'ниже нормы' },
      { name: 'Лейкоциты', value: '11,8', unit: '×10⁹/л', ref: '4,0–9,0', status: 'выше нормы' },
      { name: 'СОЭ', value: '25', unit: 'мм/ч', ref: '2–15', status: 'выше нормы' },
      { name: 'Тромбоциты', value: '250', unit: '×10⁹/л', ref: '180–320', status: 'норма' },
      { name: 'Эритроциты', value: '4,1', unit: '×10¹²/л', ref: '3,7–4,7', status: 'норма' }
    ],
    risks: [
      { level: 'high', title: 'Аллергия на назначенный препарат', explanation: 'Амоксициллин относится к пенициллинам, а у пациентки аллергия на пенициллин.', source: 'база знаний, правило R1' },
      { level: 'medium', title: 'Сниженный гемоглобин', explanation: 'Гемоглобин 108 г/л ниже нормы для женщин (120–140). Стоит обсудить с врачом причину и контроль.', source: 'база знаний, нормы анализов' },
      { level: 'low', title: 'Признаки воспаления', explanation: 'Лейкоциты и СОЭ выше нормы. Это согласуется с жалобами, нужен контроль в динамике.', source: 'база знаний, нормы анализов' }
    ],
    missing: ['Вес пациента'],
    reminders: [{ title: 'Повторить общий анализ крови', when: 'через 7–10 дней' }]
  },
  plan: {
    summary: 'План составлен по подтверждённой карте. Амоксициллин в план не включён из-за аллергии — нужна замена врачом.',
    medications: [{ name: 'Ибупрофен 400 мг', schedule: 'только при температуре выше 38 °C', duration: 'не дольше 3 дней', note: 'После еды, из-за гастрита и аспирина уточнить у врача защиту желудка' }],
    checkpoints: [
      { when: 'Сегодня', what: 'Связаться с врачом: заменить амоксициллин из-за аллергии на пенициллин' },
      { when: 'Каждый день утром и вечером', what: 'Измерять температуру и отмечать самочувствие' },
      { when: 'Через 3 дня', what: 'Если температура держится — повторный приём' },
      { when: 'Через 7–10 дней', what: 'Повторить общий анализ крови (гемоглобин, лейкоциты, СОЭ)' }
    ],
    redFlags: ['Температура выше 39 °C или держится больше 3 дней', 'Одышка, боль или давление в груди', 'Сыпь, отёк лица или губ после приёма препарата', 'Чёрный стул или рвота с кровью'],
    nextVisit: 'Пациентка 34 лет, кашель с мокротой и температура до 38,5 три дня. Аллергия на пенициллин, хронический гастрит, принимает аспирин 100 мг. Назначенный амоксициллин противопоказан — требуется замена. ОАК: гемоглобин 108 г/л, лейкоциты 11,8, СОЭ 25. Не указан вес.',
    reminders: [{ title: 'Измерить температуру', when: '08:00 и 20:00' }, { title: 'Повторить общий анализ крови', when: 'через 7–10 дней' }]
  }
};

// ===== Обезличивание (та же логика, что на сервере) =====
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function anonymize(text, names = []) {
  let removed = 0, t = String(text || '');
  const rep = (re, tag) => { t = t.replace(re, () => { removed++; return tag; }); };
  const L = 'А-ЯЁӘҒҚҢӨҰҮҺІ', l = 'а-яёәғқңөұүһі';
  rep(new RegExp(`[${L}][${l}]+\\s+[${L}][${l}]+\\s+[${L}][${l}]+(?:ович|евич|ич|овна|евна|ична|инична|ұлы|улы|қызы|кызы)(?![${l}])`, 'g'), '[ФИО]');
  names.filter(Boolean).forEach(n => String(n).split(/\s+/).map(w => w.replace(/\./g, '')).filter(w => w.length > 2)
    .forEach(w => rep(new RegExp(`(?<![${l}${L}])${escRe(w)}(?![${l}])`, 'gi'), '[ИМЯ]')));
  rep(/(?<!\d)\d{12}(?!\d)/g, '[ИИН]');
  rep(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, '[ТЕЛЕФОН]');
  rep(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[EMAIL]');
  return { text: t, removed };
}

// ===== Вызов ИИ =====
async function callAI(payload) {
  if (aiMode === 'live') {
    const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || 'Сервер ИИ не ответил');
    return { result: data.result, anonymized: data.anonymized };
  }
  await new Promise(r => setTimeout(r, 1200));
  const anonymized = anonymize(payload.text || '', [payload.patient?.name]);
  if (payload.mode === 'lab') return { result: DEMO.lab, anonymized };
  if (payload.mode === 'plan') return { result: DEMO.plan, anonymized };
  if (payload.mode === 'check') return { result: { summary: 'Перепроверил карту.', risks: S.risks, missing: S.missing }, anonymized };
  return { result: DEMO.visit, anonymized };
}

async function checkAI() {
  const el = $('aiStatus');
  try {
    const r = await fetch('/api/analyze');
    const d = await r.json();
    if (d.ready) { aiMode = 'live'; el.textContent = 'ИИ подключён · Gemini'; el.className = 'status live'; return; }
  } catch {}
  aiMode = 'demo';
  el.textContent = 'Демо-режим (ИИ не подключён)';
  el.className = 'status demo';
}

// ===== Объединение ответа ИИ с картой =====
function merge(res) {
  const add = (list, arr, map) => (arr || []).forEach(x => list.push({ id: uid(), status: 'pending', ...map(x) }));
  add(S.card.complaints, res.complaints, t => ({ text: t }));
  add(S.card.anamnesis, res.anamnesis, t => ({ text: t }));
  add(S.card.notes, res.notes, t => ({ text: t }));
  add(S.card.prescriptions, res.prescriptions, p => ({ name: p.name, dose: p.dose, schedule: p.schedule }));
  add(S.card.labs, res.labs, l => ({ name: l.name, value: l.value, unit: l.unit, ref: l.ref, flag: l.status }));
  if (Array.isArray(res.risks)) S.risks = res.risks;
  if (Array.isArray(res.missing)) S.missing = res.missing;
  (res.reminders || []).forEach(r => {
    if (!S.suggested.some(x => x.title === r.title)) S.suggested.push({ id: uid(), title: r.title, when: r.when });
  });
  save(); renderAll();
}

// Данные карты для ИИ (без служебных полей)
const cardForAI = () => {
  const strip = arr => arr.map(({ id, ...rest }) => rest);
  return Object.fromEntries(Object.entries(S.card).map(([k, v]) => [k, strip(v)]));
};

// ===== Отрисовка результата =====
function resultHTML(res) {
  const list = (title, arr) => arr && arr.length ? `<div class="sec"><h4>${title}</h4>${arr.map(t => `<div class="item pending"><span class="txt">${esc(t)}</span></div>`).join('')}</div>` : '';
  const rx = res.prescriptions?.length ? `<div class="sec"><h4>Назначения</h4>${res.prescriptions.map(p => `<div class="item pending"><span class="txt"><b>${esc(p.name)}</b> ${esc(p.dose)} · ${esc(p.schedule)}</span></div>`).join('')}</div>` : '';
  const risks = res.risks?.length ? `<div class="sec"><h4>Риски</h4>${res.risks.map(riskHTML).join('')}</div>` : '';
  return `<div class="summary"><b>ИИ:</b> ${esc(res.summary || 'Готово.')}</div>
    ${list('Жалобы', res.complaints)}${list('Анамнез', res.anamnesis)}${rx}${list('Заметки', res.notes)}${risks}
    <div class="row"><button class="btn ghost" data-go="card">Проверить в медкарте</button><button class="btn ghost" data-go="risks">Все риски</button></div>`;
}
const anonHTML = a => a ? `<details class="anon"><summary>Обезличено перед отправкой в ИИ: скрыто ${a.removed} ${a.removed === 1 ? 'фрагмент' : 'фрагм.'}</summary><p>${esc(a.text)}</p></details>` : '';
const LV = { high: 'Высокий риск', medium: 'Средний риск', low: 'На заметку' };
const riskHTML = r => `<div class="risk ${['high', 'medium', 'low'].includes(r.level) ? r.level : 'low'}"><span class="lv">${LV[r.level] || 'На заметку'}</span><b>${esc(r.title)}</b>${esc(r.explanation)}${r.source ? `<span class="src">Источник: ${esc(r.source)}</span>` : ''}</div>`;

const statusCls = f => /выше/i.test(f) ? 'hi' : /ниже/i.test(f) ? 'lo' : 'ok';
function labsTable(labs) {
  return `<table class="stack"><thead><tr><th>Показатель</th><th>Значение</th><th>Норма</th><th>Статус</th></tr></thead><tbody>
    ${labs.map(l => `<tr><td data-l="Показатель"><b>${esc(l.name)}</b></td><td class="num" data-l="Значение">${esc(l.value)} ${esc(l.unit)}</td><td class="num" data-l="Норма">${esc(l.ref)}</td><td data-l="Статус"><span class="st ${statusCls(l.flag || l.status)}">${esc(l.flag || l.status)}</span></td></tr>`).join('')}
  </tbody></table>`;
}

function renderProfile() {
  const p = S.patient;
  const cell = (k, v, alert) => `<div class="${alert ? 'alert' : ''}"><small>${k}</small><b>${esc(v || '—')}</b></div>`;
  $('profile').innerHTML = cell('Пациент', p.name) + cell('Возраст', p.age) + cell('Вес', p.weight ? p.weight + ' кг' : '') +
    cell('Аллергии', p.allergies.join(', '), p.allergies.length) + cell('Хронические', p.chronic.join(', ')) + cell('Принимает', p.meds.join(', '));
}

const SECTIONS = [['complaints', 'Жалобы'], ['anamnesis', 'Анамнез'], ['prescriptions', 'Назначения'], ['labs', 'Анализы'], ['notes', 'Заметки']];
const itemText = (sec, it) => sec === 'prescriptions' ? `<b>${esc(it.name)}</b> <mark>${esc(it.dose)}</mark> · ${esc(it.schedule)}`
  : sec === 'labs' ? `<b>${esc(it.name)}</b>: <mark>${esc(it.value)} ${esc(it.unit)}</mark> (норма ${esc(it.ref)}) — <span class="st ${statusCls(it.flag)}">${esc(it.flag)}</span>`
  : esc(it.text);
const itemPlain = (sec, it) => sec === 'prescriptions' ? `${it.name} ${it.dose} ${it.schedule}` : sec === 'labs' ? `${it.name} ${it.value} ${it.unit}` : it.text;

const confirmLabel = (sec, it) => sec === 'prescriptions' && it.dose ? 'Подтвердить дозу ' + esc(it.dose)
  : sec === 'labs' && it.value ? 'Подтвердить ' + esc(it.value) + ' ' + esc(it.unit) : 'Подтвердить';
const NUMERIC = ['prescriptions', 'labs'];
function renderCard() {
  const total = SECTIONS.reduce((n, [k]) => n + S.card[k].length, 0);
  if (!total) { $('cardView').innerHTML = '<div class="result empty">Карта пока пустая. Запишите приём или загрузите анализ.</div>'; return; }
  $('cardView').innerHTML = SECTIONS.filter(([k]) => S.card[k].length).map(([k, t]) => `<div class="sec"><h4>${t}</h4>${S.card[k].map(it => `
    <div class="item ${it.status}" data-sec="${k}" data-id="${it.id}">
      <span class="txt">${itemText(k, it)}<br><span class="tag">${it.status === 'ok' ? '✓ Подтверждено человеком' : 'Предложено ИИ — проверьте'}</span></span>
      <span class="acts">${it.status !== 'ok' ? `<button class="yes" data-act="ok">${confirmLabel(k, it)}</button>` : ''}<button data-act="edit">Изменить</button><button data-act="del">Удалить</button></span>
    </div>`).join('')}</div>`).join('');
}

function renderRisks() {
  const r = S.risks, m = S.missing;
  $('riskView').innerHTML = (r.length ? r.map(riskHTML).join('') : '<div class="result empty">Рисков пока не найдено.</div>') +
    (m.length ? `<h3>Не хватает данных</h3><div class="miss">${m.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '');
}

function renderReminders() {
  $('remSuggest').innerHTML = S.suggested.length ? S.suggested.map(s => `<div class="rem"><span><b>${esc(s.title)}</b><br><span class="when">${esc(s.when)}</span></span><span class="acts"><button class="yes" data-sadd="${s.id}">Добавить</button><button data-sdel="${s.id}">Скрыть</button></span></div>`).join('')
    : 'После обработки приёма или анализа здесь появятся предложения.';
  $('remList').innerHTML = S.reminders.length ? S.reminders.map(r => `<div class="rem ${r.done ? 'done' : ''}"><span><b>${esc(r.title)}</b><br><span class="when">${esc(r.when)}</span></span><span class="acts"><button data-rdone="${r.id}">${r.done ? 'Вернуть' : 'Выполнено'}</button><button data-rdel="${r.id}">Удалить</button></span></div>`).join('')
    : '<div class="result empty">Напоминаний пока нет.</div>';
}

function renderMood() {
  const last = S.mood.slice(-10);
  $('moodChart').innerHTML = last.length ? last.map(m => `<div style="height:${m.v * 10}%" title="${esc(m.date)}"><span>${m.v}</span></div>`).join('') : '';
  $('moodList').innerHTML = last.length ? last.slice().reverse().map(m => `<div class="mrow"><span>${esc(m.date)}</span><span>${m.v}/10 ${esc(m.note)}</span></div>`).join('') : '<div class="result empty">Записей пока нет.</div>';
}

function renderBadges() {
  const pending = SECTIONS.reduce((n, [k]) => n + S.card[k].filter(i => i.status !== 'ok').length, 0);
  const high = S.risks.filter(r => r.level === 'high').length;
  $('pendingBadge').hidden = !pending; $('pendingBadge').textContent = pending;
  $('riskBadge').hidden = !high; $('riskBadge').textContent = high;
}

function renderAll() { renderProfile(); renderCard(); renderRisks(); renderPlan(); renderReminders(); renderMood(); renderBadges(); }

// ===== Вкладки =====
function go(tab) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + tab));
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
  window.scrollTo({ top: 0 });
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); });
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

const toast = msg => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); };
const loading = (el, msg) => { el.className = 'result'; el.innerHTML = `<div class="loading"><div class="spin"></div>${msg}</div>`; };

// ===== Голос =====
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recording = false, baseText = '';
if (!SR) { $('micHint').textContent = 'Этот браузер не поддерживает голос. Откройте в Chrome или введите текст.'; }
$('micBtn').addEventListener('click', () => {
  if (!SR) { toast('Голосовой ввод работает в Chrome и Edge'); return; }
  if (recording) { rec.stop(); return; }
  rec = new SR(); rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = true;
  baseText = $('visitText').value.trim();
  rec.onresult = e => {
    let fin = '', tmp = '';
    for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; e.results[i].isFinal ? fin += t + ' ' : tmp += t; }
    $('visitText').value = [baseText, fin + tmp].filter(Boolean).join(' ').trim();
  };
  rec.onstart = () => { recording = true; $('micBtn').classList.add('rec'); $('micState').textContent = 'Идёт запись… нажмите, чтобы остановить'; };
  rec.onend = () => { recording = false; $('micBtn').classList.remove('rec'); $('micState').textContent = 'Запись остановлена'; };
  rec.onerror = e => { toast(e.error === 'not-allowed' ? 'Разрешите доступ к микрофону' : 'Ошибка распознавания: ' + e.error); };
  rec.start();
});
$('sampleBtn').addEventListener('click', () => { $('visitText').value = SAMPLE_TEXT; });
$('clearText').addEventListener('click', () => { $('visitText').value = ''; });

$('processVisit').addEventListener('click', async () => {
  const text = $('visitText').value.trim();
  if (!text) { toast('Сначала запишите или введите текст приёма'); return; }
  if (recording) rec.stop();
  const btn = $('processVisit'); btn.disabled = true;
  loading($('visitResult'), 'ИИ разбирает запись и проверяет риски…');
  try {
    const { result: res, anonymized } = await callAI({ mode: 'visit', text, patient: S.patient, card: cardForAI() });
    $('visitResult').innerHTML = anonHTML(anonymized) + resultHTML(res);
    merge(res); toast('Данные добавлены в медкарту, проверьте их');
  } catch (e) { $('visitResult').innerHTML = `<div class="risk high"><b>Не получилось</b>${esc(e.message)}</div>`; }
  btn.disabled = false;
});

// ===== Анализы =====
let labFile = null;
const MAX = 3 * 1024 * 1024;
function setFile(f) {
  if (!f) return;
  if (f.size > MAX) { toast('Файл больше 3 МБ'); return; }
  if (!/^image\/|application\/pdf/.test(f.type)) { toast('Нужно фото или PDF'); return; }
  labFile = f; $('fileName').textContent = f.name; $('processLab').disabled = false;
}
$('labFile').addEventListener('change', e => setFile(e.target.files[0]));
const drop = $('drop');
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));

const toB64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });

// Демо-бланк анализа рисуется на canvas и отправляется ИИ как настоящая картинка
$('sampleLab').addEventListener('click', () => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 560;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 560);
  g.fillStyle = '#111'; g.font = 'bold 30px Arial'; g.fillText('Лаборатория «Демо-Лаб»  ·  Общий анализ крови', 30, 55);
  g.font = '20px Arial'; g.fillText('Пациент: Айгерим С., 34 года      Дата: 24.11.2026', 30, 95);
  const rows = [['Показатель', 'Результат', 'Ед.', 'Норма'], ['Гемоглобин', '108', 'г/л', '120–140'], ['Лейкоциты', '11,8', '×10⁹/л', '4,0–9,0'], ['СОЭ', '25', 'мм/ч', '2–15'], ['Тромбоциты', '250', '×10⁹/л', '180–320'], ['Эритроциты', '4,1', '×10¹²/л', '3,7–4,7']];
  rows.forEach((r, i) => {
    const y = 160 + i * 62; g.font = (i ? '' : 'bold ') + '24px Arial';
    [30, 330, 520, 700].forEach((x, j) => g.fillText(r[j], x, y));
    g.strokeStyle = '#999'; g.beginPath(); g.moveTo(30, y + 20); g.lineTo(870, y + 20); g.stroke();
  });
  c.toBlob(b => { const f = new File([b], 'demo-analiz-krovi.png', { type: 'image/png' }); setFile(f); toast('Демо-бланк анализа готов, нажмите «Распознать ИИ»'); });
});

$('processLab').addEventListener('click', async () => {
  if (!labFile) return;
  const btn = $('processLab'); btn.disabled = true;
  loading($('labResult'), 'ИИ читает анализ и сравнивает с нормой…');
  try {
    const data = await toB64(labFile);
    const { result: res } = await callAI({ mode: 'lab', file: { mimeType: labFile.type, data }, patient: S.patient, card: cardForAI() });
    $('labResult').innerHTML = `<div class="summary"><b>ИИ:</b> ${esc(res.summary || 'Готово.')}</div>` + (res.labs?.length ? labsTable(res.labs) : '<p class="muted">Показатели не найдены.</p>') +
      (res.risks?.length ? `<div class="sec"><h4>Риски</h4>${res.risks.map(riskHTML).join('')}</div>` : '') +
      '<div class="row"><button class="btn ghost" data-go="card">Проверить в медкарте</button><button class="btn ghost" data-go="reminders">Напоминания</button></div>';
    merge(res); toast('Показатели добавлены в медкарту');
  } catch (e) { $('labResult').innerHTML = `<div class="risk high"><b>Не получилось</b>${esc(e.message)}</div>`; }
  btn.disabled = false;
});

// ===== Медкарта: подтвердить / изменить / удалить =====
$('cardView').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const row = b.closest('.item'); const sec = row.dataset.sec; const list = S.card[sec];
  const it = list.find(x => x.id === row.dataset.id); if (!it) return;
  if (b.dataset.act === 'ok') { it.status = 'ok'; toast('Подтверждено'); }
  if (b.dataset.act === 'del') { S.card[sec] = list.filter(x => x !== it); toast('Удалено'); }
  if (b.dataset.act === 'edit') {
    row.innerHTML = `<div class="edit-in"><input value="${esc(itemPlain(sec, it))}" aria-label="Исправить пункт"><button class="btn primary sm" data-act="save">Сохранить</button></div>`;
    row.querySelector('input').focus(); return;
  }
  if (b.dataset.act === 'save') {
    const v = row.querySelector('input').value.trim(); if (!v) return;
    if (sec === 'prescriptions') { it.name = v; it.dose = ''; it.schedule = ''; }
    else if (sec === 'labs') { it.name = v; it.value = ''; it.unit = ''; }
    else it.text = v;
    it.status = 'ok'; toast('Исправлено и подтверждено');
  }
  save(); renderAll();
});
$('confirmAll').addEventListener('click', () => {
  SECTIONS.filter(([k]) => !NUMERIC.includes(k)).forEach(([k]) => S.card[k].forEach(i => i.status = 'ok'));
  save(); renderAll();
  const left = NUMERIC.reduce((n, k) => n + S.card[k].filter(i => i.status !== 'ok').length, 0);
  toast(left ? `Текст подтверждён. Дозы и значения (${left}) подтвердите по одному` : 'Все пункты подтверждены');
});

// ===== Профиль =====
const split = s => s.split(',').map(x => x.trim()).filter(Boolean);
$('editProfile').addEventListener('click', () => {
  const p = S.patient;
  $('pName').value = p.name; $('pAge').value = p.age; $('pWeight').value = p.weight;
  $('pAllergies').value = p.allergies.join(', '); $('pChronic').value = p.chronic.join(', '); $('pMeds').value = p.meds.join(', ');
  $('profileDlg').showModal();
});
$('profileDlg').addEventListener('close', () => {
  if ($('profileDlg').returnValue !== 'ok') return;
  S.patient = { name: $('pName').value.trim(), age: $('pAge').value.trim(), weight: $('pWeight').value.trim(), allergies: split($('pAllergies').value), chronic: split($('pChronic').value), meds: split($('pMeds').value) };
  save(); renderAll(); toast('Профиль сохранён. Перепроверьте риски');
});

// ===== Риски =====
$('recheck').addEventListener('click', async () => {
  const btn = $('recheck'); btn.disabled = true; btn.textContent = 'Проверяю…';
  try { const { result: res } = await callAI({ mode: 'check', patient: S.patient, card: cardForAI() }); merge({ risks: res.risks, missing: res.missing, reminders: res.reminders }); toast('Риски обновлены'); }
  catch (e) { toast(e.message); }
  btn.disabled = false; btn.textContent = 'Перепроверить ИИ';
});

// ===== План сопровождения =====
const pendingCount = () => SECTIONS.reduce((n, [k]) => n + S.card[k].filter(i => i.status !== 'ok').length, 0);
function renderPlan() {
  const v = $('planView'), p = S.plan;
  if (!p) { v.innerHTML = '<div class="result empty">Плана пока нет. Подтвердите карту и нажмите «Сформировать план».</div>'; return; }
  v.innerHTML = `<div class="summary"><b>ИИ:</b> ${esc(p.summary)}</div>
    ${p.medications?.length ? `<h3>Лекарства</h3><table class="stack"><thead><tr><th>Препарат</th><th>Как принимать</th><th>Сколько</th><th>Важно</th></tr></thead><tbody>${p.medications.map(m => `<tr><td data-l="Препарат"><b>${esc(m.name)}</b></td><td data-l="Как принимать">${esc(m.schedule)}</td><td data-l="Сколько">${esc(m.duration)}</td><td data-l="Важно">${esc(m.note)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${p.checkpoints?.length ? `<h3>Контрольные точки</h3>${p.checkpoints.map(c => `<div class="rem"><span><span class="when">${esc(c.when)}</span><br>${esc(c.what)}</span></div>`).join('')}` : ''}
    ${p.redFlags?.length ? `<h3>Красные флаги: срочно к врачу, если</h3><div class="risk high">${p.redFlags.map(f => `• ${esc(f)}`).join('<br>')}</div>` : ''}
    ${p.nextVisit ? `<h3>Сводка к следующему визиту</h3><div class="panel inner">${esc(p.nextVisit)}</div><button class="btn ghost sm" id="copyVisit">Скопировать сводку</button>` : ''}
    ${p.reminders?.length ? `<div class="row"><button class="btn primary" id="planRem">Добавить напоминания из плана (${p.reminders.length})</button></div>` : ''}`;
}
$('makePlan').addEventListener('click', async () => {
  const n = pendingCount();
  const total = SECTIONS.reduce((m, [k]) => m + S.card[k].length, 0);
  if (!total) { $('planView').innerHTML = '<div class="result empty">Карта пустая. Сначала запишите приём или загрузите анализ.</div>'; return; }
  if (n) { $('planView').innerHTML = `<div class="risk medium"><b>Сначала подтвердите карту</b>Не проверено пунктов: ${n}. План строится только по данным, которые подтвердил человек.<div class="row"><button class="btn ghost sm" data-go="card">Открыть медкарту</button></div></div>`; return; }
  const btn = $('makePlan'); btn.disabled = true;
  loading($('planView'), 'ИИ составляет план сопровождения…');
  try { const { result } = await callAI({ mode: 'plan', patient: S.patient, card: cardForAI() }); S.plan = result; save(); renderPlan(); toast('План готов'); }
  catch (e) { $('planView').innerHTML = `<div class="risk high"><b>Не получилось</b>${esc(e.message)}</div>`; }
  btn.disabled = false;
});
$('planView').addEventListener('click', async e => {
  if (e.target.id === 'planRem') {
    S.plan.reminders.forEach(r => { if (!S.reminders.some(x => x.title === r.title)) S.reminders.push({ id: uid(), title: r.title, when: r.when, done: false }); });
    save(); renderReminders(); toast('Напоминания добавлены');
  }
  if (e.target.id === 'copyVisit') {
    try { await navigator.clipboard.writeText(S.plan.nextVisit); toast('Сводка скопирована'); } catch { toast('Не получилось скопировать'); }
  }
});

// ===== База знаний =====
async function renderKB() {
  try {
    const kb = await (await fetch('knowledge.json')).json();
    $('kbView').innerHTML = `
      <h3>Нормы анализов (${kb.labNorms.length})</h3>
      <div class="scroll"><table><thead><tr><th>Показатель</th><th>Ед.</th><th>Женщины</th><th>Мужчины</th></tr></thead><tbody>${kb.labNorms.map(n => `<tr><td>${esc(n.name)}</td><td class="num">${esc(n.unit)}</td><td class="num">${esc(n.female)}</td><td class="num">${esc(n.male)}</td></tr>`).join('')}</tbody></table></div>
      <h3>Чек-лист обязательных полей (${kb.checklist.length})</h3>
      ${kb.checklist.map(c => `<div class="rem"><span><b>${esc(c.field)}</b><br><span class="muted">${esc(c.why)}</span></span></div>`).join('')}
      <h3>Правила безопасности (${kb.safetyRules.length})</h3>
      ${kb.safetyRules.map(r => `<div class="risk ${esc(r.level)}"><span class="lv">${esc(r.id)} · ${LV[r.level] || ''}</span><b>${esc(r.if)}</b>${esc(r.then)}</div>`).join('')}
      <h3>Красные флаги</h3><div class="miss">${kb.redFlags.map(f => `<span>${esc(f)}</span>`).join('')}</div>
      <p class="warn" style="margin-top:18px">${esc(kb.about)}</p>`;
  } catch { $('kbView').innerHTML = '<div class="result empty">Не удалось загрузить базу знаний (откройте сайт через сервер, а не как файл).</div>'; }
}

// ===== Напоминания =====
$('remForm').addEventListener('submit', e => {
  e.preventDefault();
  S.reminders.push({ id: uid(), title: $('remTitle').value.trim(), when: $('remWhen').value.trim(), done: false });
  e.target.reset(); save(); renderReminders(); toast('Напоминание добавлено');
});
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.sadd) { const s = S.suggested.find(x => x.id === d.sadd); if (s) { S.reminders.push({ id: uid(), title: s.title, when: s.when, done: false }); S.suggested = S.suggested.filter(x => x !== s); toast('Добавлено в напоминания'); } }
  else if (d.sdel) S.suggested = S.suggested.filter(x => x.id !== d.sdel);
  else if (d.rdone) { const r = S.reminders.find(x => x.id === d.rdone); if (r) r.done = !r.done; }
  else if (d.rdel) S.reminders = S.reminders.filter(x => x.id !== d.rdel);
  else return;
  save(); renderReminders();
});

// ===== Самочувствие =====
$('moodRange').addEventListener('input', e => { $('moodVal').textContent = e.target.value; });
$('moodSave').addEventListener('click', () => {
  const d = new Date();
  S.mood.push({ v: +$('moodRange').value, note: $('moodNote').value.trim(), date: d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) });
  $('moodNote').value = ''; save(); renderMood(); toast('Запись сохранена');
});

// ===== Сброс =====
$('resetAll').addEventListener('click', () => {
  if ($('resetAll').dataset.sure) { S = freshState(); save(); renderAll(); $('visitResult').className = 'result empty'; $('visitResult').textContent = 'Здесь появится разбор.'; $('labResult').className = 'result empty'; $('labResult').textContent = 'Пока анализов нет.'; $('resetAll').textContent = 'Сбросить все данные'; delete $('resetAll').dataset.sure; toast('Данные сброшены'); return; }
  $('resetAll').dataset.sure = '1'; $('resetAll').textContent = 'Нажмите ещё раз для сброса';
});

// ===== Старт =====
renderAll();
renderKB();
checkAI();
const start = location.hash.slice(1);
if (start && $('view-' + start)) go(start);
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if ($('view-' + t)) go(t); });
}
