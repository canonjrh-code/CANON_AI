
const MODEL = "@cf/ibm-granite/granite-4.0-h-micro";
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

  if (!env.AI) {
    return json({
      error: "Workers AI binding named AI is missing in Cloudflare settings."
    }, 500);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON request." }, 400);
  }

  if (!body || typeof body !== "object") {
    return json({ error: "Invalid request body." }, 400);
  }

  const messages = cleanMessages(body.messages);

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ error: "Please send a message first." }, 400);
  }

  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content: systemPrompt(body)
        },
        ...messages
      ],
      max_tokens: body.mode === "voice" ? 400 : 800
    });

    const reply = String(
      result?.response ||
      result?.choices?.[0]?.message?.content ||
      ""
    ).trim();

    if (!reply) {
      console.error("Workers AI returned no text:", result);
      return json({
        error: "The AI returned an empty reply."
      }, 502);
    }

    return json({ reply });

  } catch (error) {
    console.error("Canon AI Workers AI error:", error);

    return json({
      error: "Could not connect to Cloudflare Workers AI. Please try again."
    }, 502);
  }
}
