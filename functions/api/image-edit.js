
export async function onRequestPost({ request, env }) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });

  try {
    // Require the existing Cloudflare AI binding.
    if (!env.AI) {
      return json({
        error: "Cloudflare AI is not configured."
      }, 503);
    }

    const form = await request.formData();
    const image = form.get("image");
    const prompt = String(form.get("prompt") || "").trim();

    if (!image || typeof image === "string") {
      return json({
        error: "Please upload an image."
      }, 400);
    }

    if (!prompt) {
      return json({
        error: "Please describe the edit you want."
      }, 400);
    }

    if (!["image/png", "image/jpeg", "image/webp"].includes(image.type)) {
      return json({
        error: "Use a PNG, JPEG, or WEBP image."
      }, 415);
    }

    if (image.size > 15 * 1024 * 1024) {
      return json({
        error: "Image is too large. Maximum size is 15 MB."
      }, 413);
    }

    // Prepare the image and prompt for FLUX.
    const fluxForm = new FormData();

    fluxForm.append("prompt", prompt);
    fluxForm.append(
      "input_image_0",
      image,
      image.name || "upload.png"
    );

    const wrapped = new Response(fluxForm);

    // Use Cloudflare Workers AI only.
    // There is deliberately no paid-provider fallback.
    const result = await env.AI.run(
      "@cf/black-forest-labs/flux-2-klein-4b",
      {
        multipart: {
          body: wrapped.body,
          contentType: wrapped.headers.get("content-type")
        }
      }
    );

    if (!result || !result.image) {
      return json({
        error: "FLUX did not return an edited image."
      }, 502);
    }

    return json({
      image: result.image,
      format: "png"
    });

  } catch (error) {
    const message = String(error?.message || "");

    if (/3036|429|daily free allocation|account limited/i.test(message)) {
      return json({
        error: "The free daily AI allowance may be exhausted. Please try again after it resets."
      }, 429);
    }

    return json({
      error: "Image editing failed. Please try again later."
    }, 502);
  }
}

