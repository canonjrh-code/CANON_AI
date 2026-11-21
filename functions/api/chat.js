
const MODEL = "claude-sonnet-5-5";
const MAX_HISTORY = 12;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function cleanMessages(input) {
  if (!Array.isArray(input)) return [];

  const messages = [];

  for (const m of input.slice(-MAX_HISTORY)) {
    if (!m || !["user", "assistant"].includes(m.role)) continue;

    const content = String(m.content || "").trim().slice(0, 6000);
    if (!content) continue;

    const last = messages[messages.length - 1];

    if (last && last.role === m.role) {
      last.content += "\n\n" + content;
    } else {
      messages.push({ role: m.role, content });
    }
  }

  while (messages.length && messages[0].role !== "user") {
    messages.shift();
  }

  return messages;
}

function systemPrompt(body) {
  const name = String(body.name || "Canon").slice(0, 40);

  const language = body.language === "sw"
    ? "Reply in natural Tanzanian Kiswahili unless asked otherwise."
    : "Reply in English unless asked otherwise.";

  return [
    "You are Canon Jr AI, a friendly intelligent personal assistant.",
    "You are also known as Jarvis in voice mode.",
    "You are speaking with " + name + ".",
    language,
    "Be helpful, accurate and honest.",
    "Keep answers concise unless more detail is requested."
  ].join("\n");
}

export async function onRequestPost({ request, env }) {
  if (env.ACCESS_CODE) {
    const code = request.headers.get("x-access-code") || "";

    if (code !== env.ACCESS_CODE) {
      return json({ error: "Access code missing or incorrect." }, 401);
    }
  }

  if (!env.ANTHROPIC_API_KEY) {
    return json({
      error: "Missing ANTHROPIC_API_KEY in Cloudflare settings."
    }, 500);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON request." }, 400);
  }

  const messages = cleanMessages(body.messages);

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ error: "Please send a message first." }, 400);
  }

  try {
    const response = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL || MODEL,
          max_tokens: body.mode === "voice" ? 400 : 800,
          system: systemPrompt(body),
          messages
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Anthropic API error:", response.status, data);

      return json({
        error: data.error?.message || "AI service request failed."
      }, response.status === 429 ? 429 : 502);
    }

    const reply = (data.content || [])
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n")
      .trim();

    if (!reply) {
      return json({ error: "The AI returned an empty reply." }, 502);
    }

    return json({ reply });

  } catch (error) {
    console.error("Canon AI backend error:", error);

    return json({
      error: "Could not connect to the AI service."
    }, 502);
  }
}
