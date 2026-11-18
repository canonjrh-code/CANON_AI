
export async function onRequestPost({ request, env }) {
  try {
    if (!env.AI) {
      return Response.json(
        { error: "AI service is not configured yet." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const messages = body.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "Please send a message." },
        { status: 400 }
      );
    }

    const safeMessages = messages.slice(-12).map(message => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || "").slice(0, 3000)
    }));

    const result = await env.AI.run(
      "@cf/google/gemma-4-26b-a4b-it",
      {
        messages: [
          {
            role: "system",
            content: "You are Canon Jr AI, a helpful, friendly assistant. Support English and Kiswahili. Answer clearly, respectfully and safely."
          },
          ...safeMessages
        ],
        chat_template_kwargs: {
          enable_thinking: false
        }
      }
    );

    const reply =
      result?.response ||
      result?.choices?.[0]?.message?.content ||
      "Sorry, I could not generate a response.";

    return Response.json({ reply });

  } catch (error) {
    return Response.json(
      { error: "AI service error. Please try again." },
      { status: 500 }
    );
  }
}
