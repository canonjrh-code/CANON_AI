
const MODEL = "@cf/runwayml/stable-diffusion-v1-5-img2img";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 1500;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost({ request, env }) {
  if (env.ACCESS_CODE) {
    const code = request.headers.get("x-access-code") || "";

    if (code !== env.ACCESS_CODE) {
      return json({
        error: "Access code missing or incorrect."
      }, 401);
    }
  }

  if (!env.AI) {
    return json({
      error: "Cloudflare AI binding named AI is missing."
    }, 500);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON request." }, 400);
  }

  const prompt = String(body.prompt || "")
    .trim()
    .slice(0, MAX_PROMPT_CHARS);

  if (!prompt) {
    return json({
      error: "Please describe the edit you want."
    }, 400);
  }

  const image = typeof body.image === "string"
    ? body.image
    : "";

  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/is.exec(image);

  if (!match) {
    return json({
      error: "Please upload a valid PNG, JPG or WebP image."
    }, 400);
  }

  const base64 = match[2];

  if (base64.length > MAX_IMAGE_BYTES * 1.4) {
    return json({
      error: "Image is too large. Please use a smaller photo."
    }, 413);
  }

  let bytes;

  try {
    const binary = atob(base64);
    bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  } catch {
    return json({
      error: "Could not read the uploaded image."
    }, 400);
  }

  if (!bytes.length) {
    return json({ error: "The image is empty." }, 400);
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    return json({
      error: "Image is too large. Please use a smaller photo."
    }, 413);
  }

  try {
    const result = await env.AI.run(MODEL, {
      prompt,
      image: Array.from(bytes),
      num_steps: 20,
      strength: 0.65,
      guidance: 7.5
    });

    if (!result) {
      return json({
        error: "The image model returned no result."
      }, 502);
    }

    return new Response(result, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    console.error("Canon AI image editing error:", error);

    return json({
      error: "Image editing failed. Please try again later."
    }, 502);
  }
}
