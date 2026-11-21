// Canon Jr AI - image editing endpoint (Vercel serverless function)
//
// Environment variables (set them in the Vercel dashboard):
//   OPENAI_API_KEY         required  your OpenAI API key (Anthropic has no image editing)
//   IMAGE_MODEL            optional  defaults to gpt-image-1
//   IMAGE_QUALITY          optional  low | medium | high | auto   (defaults to medium)
//   IMAGE_INPUT_FIDELITY   optional  "high" keeps faces closer to the original (if your model supports it)
//   ACCESS_CODE            optional  if set, the app must send the same code (Settings page)
//
// The page sends JSON: { image: "data:image/jpeg;base64,...", prompt: "..." }
// and gets back JSON:  { imageUrl: "data:image/jpeg;base64,..." }

const crypto = require('crypto');

const MODEL = process.env.IMAGE_MODEL || 'gpt-image-1';
const QUALITY = process.env.IMAGE_QUALITY || 'medium';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 1500;

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST.' });
  }

  const access = process.env.ACCESS_CODE;
  if (access && !sameSecret(req.headers['x-access-code'] || '', access)) {
    return send(res, 401, { error: 'Access code missing or wrong.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return send(res, 500, { error: 'The server is missing OPENAI_API_KEY.' });

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return send(res, 400, { error: 'Invalid JSON.' });
  }

  const prompt = String(body.prompt || '').trim().slice(0, MAX_PROMPT_CHARS);
  if (!prompt) return send(res, 400, { error: 'Please describe the edit you want.' });

  const image = typeof body.image === 'string' ? body.image : '';
  const head = /^data:image\/(png|jpe?g|webp);base64,/i.exec(image.slice(0, 64));
  if (!head) return send(res, 400, { error: 'Unsupported image. Please use a PNG, JPG or WebP photo.' });

  const type = head[1].toLowerCase().replace('jpg', 'jpeg');
  const ext = type === 'jpeg' ? 'jpg' : type;
  const bytes = Buffer.from(image.slice(head[0].length), 'base64');
  if (!bytes.length) return send(res, 400, { error: 'The image was empty.' });
  if (bytes.length > MAX_IMAGE_BYTES) return send(res, 413, { error: 'The image is too large. Try a smaller photo.' });

  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', prompt);
  form.append('n', '1');
  form.append('quality', QUALITY);
  form.append('output_format', 'jpeg');
  form.append('output_compression', '85');
  if (process.env.IMAGE_INPUT_FIDELITY) form.append('input_fidelity', process.env.IMAGE_INPUT_FIDELITY);
  form.append('image', new Blob([bytes], { type: 'image/' + type }), 'photo.' + ext);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);

  try {
    const upstream = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: form,
      signal: controller.signal
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const detail = (data && data.error && data.error.message) || '';
      console.error('Image API error', upstream.status, detail);
      if (upstream.status === 429) {
        return send(res, 429, { error: 'The image service is busy. Please wait a moment and try again.' });
      }
      if (upstream.status === 401 || upstream.status === 403) {
        return send(res, 500, { error: 'The image key on the server was rejected. Check OPENAI_API_KEY.' });
      }
      if (upstream.status === 400) {
        return send(res, 400, { error: detail || 'The image service could not process that request.' });
      }
      return send(res, 502, { error: 'The image service returned an error' + (detail ? ': ' + detail : '.') });
    }

    const first = data && Array.isArray(data.data) ? data.data[0] : null;
    if (first && first.b64_json) {
      return send(res, 200, { imageUrl: 'data:image/jpeg;base64,' + first.b64_json });
    }
    if (first && first.url) return send(res, 200, { imageUrl: first.url });

    return send(res, 502, { error: 'The image service did not return an edited image.' });
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    console.error('image-edit error', e);
    return send(res, timedOut ? 504 : 502, {
      error: timedOut
        ? 'The editing service took too long. Please try again.'
        : 'Could not reach the image service.'
    });
  } finally {
    clearTimeout(timer);
  }
};
