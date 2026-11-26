// Серверная функция Vercel: /api/analyze
// 1) обезличивает данные (ФИО, телефоны, ИИН, e-mail),
// 2) добавляет базу знаний (нормы, чек-лист, правила безопасности),
// 3) отправляет всё в Google Gemini и возвращает структурированный JSON.
// Ключ хранится в переменной окружения GEMINI_API_KEY и не попадает в браузер.

const KB = require('../knowledge.json');

// Запасные модели на случай перегрузки основной
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

const SYSTEM_PROMPT = `Ты — MedSafe Voice, ИИ-помощник по медицинской безопасности. Ты помогаешь врачу или пациенту вести медкарту.

Твои задачи:
1. Из расшифровки голосовой записи приёма выделить: жалобы, анамнез (история болезни, хронические заболевания, операции, аллергии), назначения (препарат, доза, кратность и длительность), прочие заметки.
2. Из фото или PDF анализа извлечь показатели: название, значение, единицы, референсный интервал и статус (норма / выше нормы / ниже нормы).
3. Проверить ВСЮ медкарту вместе с профилем пациента и найти риски:
   - аллергия на назначенный препарат или его группу;
   - опасные сочетания лекарств;
   - противопоказания при хронических заболеваниях;
   - показатели анализов вне нормы;
   - недостающие данные по чек-листу.
4. Предложить напоминания: приём лекарств и повторные анализы.

Как пользоваться БАЗОЙ ЗНАНИЙ (она передаётся ниже):
- Нормы анализов бери из labNorms с учётом пола, если он известен. Если на бланке есть свой референс — используй его.
- Недостающие данные определяй по checklist.
- Риски проверяй в первую очередь по safetyRules. Если сработало правило, укажи source: "база знаний, правило R…".
- Если риск найден по общим медицинским знаниям, а не по базе, укажи source: "общие знания ИИ".
- Красные флаги для плана бери из redFlags.

Правила:
- Ты НЕ ставишь диагноз и НЕ назначаешь лечение. Ты только структурируешь данные и подсвечиваешь возможные риски, решение принимает человек.
- Не выдумывай данных, которых нет во входе. Чего не хватает — пиши в "missing".
- Данные обезличены: метки вида [ФИО], [ТЕЛЕФОН] оставляй как есть. Не переписывай ФИО, телефоны и номера документов с бланков анализов.
- Пиши коротко и понятно, на русском языке.
- Уровень риска: "high" — может навредить, нужна проверка до приёма; "medium" — обсудить с врачом; "low" — на заметку.
- Отвечай ТОЛЬКО валидным JSON строго по схеме, без текста вокруг.

Схема ответа для задач "visit", "lab", "check":
{
  "summary": "1–2 предложения: что сделано и главное, на что обратить внимание",
  "complaints": ["..."],
  "anamnesis": ["..."],
  "prescriptions": [{"name": "...", "dose": "...", "schedule": "..."}],
  "notes": ["..."],
  "labs": [{"name": "...", "value": "...", "unit": "...", "ref": "...", "status": "норма|выше нормы|ниже нормы"}],
  "risks": [{"level": "high|medium|low", "title": "...", "explanation": "...", "source": "..."}],
  "missing": ["..."],
  "reminders": [{"title": "...", "when": "..."}]
}
В "complaints", "anamnesis", "prescriptions", "notes", "labs" — только НОВОЕ из текущего входа. В "risks" и "missing" — итог по всей карте.

Схема ответа для задачи "plan" (план сопровождения по ПОДТВЕРЖДЁННОЙ карте):
{
  "summary": "1–2 предложения",
  "medications": [{"name": "...", "schedule": "...", "duration": "...", "note": "..."}],
  "checkpoints": [{"when": "...", "what": "..."}],
  "redFlags": ["когда срочно обратиться к врачу"],
  "nextVisit": "короткая сводка для врача на следующий визит",
  "reminders": [{"title": "...", "when": "..."}]
}
Препараты с высоким риском не включай в план приёма — вместо этого добавь пункт в checkpoints: обсудить с врачом замену.`;

// ===== Обезличивание =====
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function anonymize(text, names = []) {
  let removed = 0;
  let t = String(text || '');
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

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json({ ready: Boolean(process.env.GEMINI_API_KEY), model: process.env.GEMINI_MODEL || 'gemini-flash-latest' });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Только POST' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { mode = 'visit', text = '', file = null, patient = {}, card = {} } = body || {};

  // Имя пациента в ИИ не отправляем, а заодно вырезаем его из текста
  const { name, ...patientSafe } = patient || {};
  const anon = anonymize(String(text).slice(0, 8000), [name]);
  const cardAnon = anonymize(JSON.stringify(card), [name]);

  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(501).json({ error: 'no_key', message: 'На сервере не задан GEMINI_API_KEY' }); return; }
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';

  const task = {
    visit: 'visit — обработай расшифровку голосовой записи приёма.',
    lab: 'lab — извлеки показатели из прикреплённого анализа (фото или PDF).',
    check: 'check — новых данных нет, перепроверь риски и недостающие данные по всей карте.',
    plan: 'plan — составь план сопровождения пациента по подтверждённой карте.'
  }[mode] || 'visit';

  const userText = [
    `Задача: ${task}`,
    `БАЗА ЗНАНИЙ: ${JSON.stringify(KB)}`,
    `Профиль пациента: ${JSON.stringify(patientSafe)}`,
    `Текущая медкарта: ${cardAnon.text}`,
    mode === 'visit' ? `Расшифровка приёма (обезличена):\n${anon.text}` : ''
  ].filter(Boolean).join('\n\n');

  const parts = [{ text: userText }];
  if (file && file.data && file.mimeType) parts.push({ inlineData: { mimeType: file.mimeType, data: file.data } });

  const reqBody = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
  });

  // Если модель перегружена — повторяем и переходим на запасные модели
  const models = [...new Set([model, ...FALLBACK_MODELS])];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const started = Date.now();
  const BUDGET = 45000; // общий лимит, чтобы Vercel не оборвал запрос
  let lastError = 'Ошибка Gemini';
  try {
    outer:
    for (const m of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const left = BUDGET - (Date.now() - started);
        if (left < 4000) break outer;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), Math.min(20000, left));
        let r;
        try {
          r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: reqBody,
            signal: ctrl.signal
          });
        } catch (e) {
          clearTimeout(timer);
          lastError = e.name === 'AbortError' ? `модель ${m} отвечала слишком долго` : String(e.message || e);
          break; // следующая модель
        }
        clearTimeout(timer);
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          const raw = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
          const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
          let result;
          try { result = JSON.parse(clean); } catch { lastError = 'ИИ вернул ответ не в формате JSON'; break; }
          res.status(200).json({ model: m, result, anonymized: { text: anon.text, removed: anon.removed + cardAnon.removed } });
          return;
        }
        lastError = data?.error?.message || `Ошибка Gemini (${r.status})`;
        if (r.status === 400 || r.status === 401 || r.status === 403) { res.status(502).json({ error: 'gemini_error', message: lastError }); return; }
        if (r.status === 404) break;            // такой модели нет — следующая
        if (attempt === 0) await sleep(1500);   // 429 / 500 / 503 — подождать и повторить
      }
    }
    res.status(503).json({ error: 'busy', message: 'Серверы ИИ сейчас перегружены, попробуйте ещё раз через минуту. (' + lastError + ')' });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: String(e.message || e) });
  }
};

module.exports.anonymize = anonymize;
