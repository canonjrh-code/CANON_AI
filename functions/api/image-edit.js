
export async function onRequestPost({ request, env }) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });

  try {
    if (!env.OPENAI_API_KEY) {
      return json({
        error: "Image editing is not configured. Add OPENAI_API_KEY in Cloudflare."
      }, 503);
    }

    const form = await request.formData();
    const image = form.get("image");
    const prompt = String(form.get("prompt") || "").trim();

    if (!image || typeof image === "string") {
      return json({ error: "Please upload an image." }, 400);
    }

    if (!prompt) {
      return json({ error: "Please describe the edit you want." }, 400);
    }

    if (!["image/png", "image/jpeg", "image/webp"].includes(image.type)) {
      return json({ error: "Use a PNG, JPEG, or WEBP image." }, 415);
    }

    if (image.size > 15 * 1024 * 1024) {
      return json({ error: "Image is too large. Maximum size is 15 MB." }, 413);
    }

    const upstreamForm = new FormData();
    upstreamForm.append("model", "gpt-image-2");
    upstreamForm.append("image", image, image.name || "upload.png");
    upstreamForm.append("prompt", prompt);
    upstreamForm.append("size", "auto");
    upstreamForm.append("quality", "medium");

    const response = await fetch(
      "https://api.openai.com/v1/images/edits",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`
        },
        body: upstreamForm
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return json({
        error: data?.error?.message ||
          "The image provider could not complete the edit."
      }, response.status === 429 ? 429 : 502);
    }

    const editedImage = data?.data?.[0]?.b64_json;

    if (!editedImage) {
      return json({
        error: "The image provider returned no edited image."
      }, 502);
    }

    return json({
      image: editedImage,
      format: "png"
    });

  } catch (error) {
    return json({
      error: "Image editing failed. Please try again."
    }, 500);
  }
}
