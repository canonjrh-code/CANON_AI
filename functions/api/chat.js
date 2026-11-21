// Canon Jr AI - chat endpoint (Vercel serverless function)
//
// Environment variables (set them in the Vercel dashboard):
//   ANTHROPIC_API_KEY   required  your Anthropic API key
//   ANTHROPIC_MODEL     optional  defaults to claude-sonnet-5-5 (claude-haiku-5-5 is faster and cheaper)
//   ACCESS_CODE         optional  if set, the app must send the same code (Settings page)
//   TIMEZONE            optional  defaults to Africa/Dar_es_Salaam

const crypto = require('crypto');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MAX_HISTORY = 12;
const MAX_CHARS = 6000;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    raw = Buffer.concat(chunks).toString('utf8');
  }
  return raw ? JSON.parse(raw) : {};
}

// Keep only valid user/assistant turns, merge repeats, start with a user turn
function cleanMessages(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const m of input.slice(-MAX_HISTORY)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const text = String(m.content == null ? '' : m.content).trim().slice(0, MAX_CHARS);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + text;
    else out.push({ role: m.role, content: text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function nowText() {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: process.env.TIMEZONE || 'Africa/Dar_es_Salaam',
      dateStyle: 'full',
      timeStyle: 'short'
    }).format(new Date());
  } catch (e) {
    return new Date().toUTCString();
  }
}

function buildSystem({ language, name, mode }) {
  const who = String(name || 'Canon').trim().slice(0, 40) || 'Canon';
  return [
    'You are Canon Jr AI, a calm, intelligent and friendly personal assistant. In voice mode people also call you Jarvis.',
    'You are talking with ' + who + '.',
    'Current date and time: ' + nowText() + '.',
    language === 'sw'
      ? 'Reply in clear, natural Kiswahili as spoken in Tanzania, unless the user asks for another language.'
      : 'Reply in English unless the user writes in, or asks for, another language.',
    'Your replies are shown as plain text and are often read aloud, so do not use markdown, bullet symbols, headings, tables, emojis or code fences. Write in short, natural sentences.',
    mode === 'voice'
      ? 'This is a spoken conversation: answer in one to three short sentences unless the user asks for more.'
      : 'Keep answers concise and useful. Go into more detail only when the user asks or the question needs it.',
    'Be honest. If you do not know something or cannot do it (for example browse the web), say so briefly instead of guessing.'
  ].join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST.' });
  }

  const access = process.env.ACCESS_CODE;
  if (access && !sameSecret(req.headers['x-access-code'] || '', access)) {
    return send(res, 401, { error: 'Access code missing or wrong.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return send(res, 500, { error: 'The server is missing ANTHROPIC_API_KEY.' });

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return send(res, 400, { error: 'Invalid JSON.' });
  }

  const messages = cleanMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return send(res, 400, { error: 'There is no message to answer.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: body.mode === 'voice' ? 400 : 800,
        system: buildSystem({ language: body.language, name: body.name, mode: body.mode }),
        messages
      }),
      signal: controller.signal
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const detail = (data && data.error && data.error.message) || '';
      console.error('Anthropic error', upstream.status, detail);
      if (upstream.status === 429 || upstream.status === 529) {
        return send(res, 429, { error: 'The AI is busy right now. Please try again in a moment.' });
      }
      if (upstream.status === 401 || upstream.status === 403) {
        return send(res, 500, { error: 'The AI key on the server was rejected. Check ANTHROPIC_API_KEY.' });
      }
      return send(res, 502, { error: 'The AI service returned an error' + (detail ? ': ' + detail : '.') });
    }

    const reply = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!reply) return send(res, 502, { error: 'The AI returned an empty reply.' });
    return send(res, 200, { reply });
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    console.error('chat error', e);
    return send(res, timedOut ? 504 : 502, {
      error: timedOut ? 'The AI took too long to answer. Please try again.' : 'Could not reach the AI service.'
    });
  } finally {
    clearTimeout(timer);
  }
};
