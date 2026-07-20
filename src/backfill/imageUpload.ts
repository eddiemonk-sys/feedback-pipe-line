// src/backfill/imageUpload.ts
const NOTION_VERSION = "2022-06-28";

/**
 * Upload one image to Notion via the File Upload REST API and return its file-upload id,
 * or null on any failure. Never throws — image embed is best-effort; the Slack link is
 * the fallback. Uses raw fetch because @notionhq/client v2.3.0 exposes no fileUploads API.
 */
export async function uploadImageToNotion(
  apiKey: string,
  image: { data: string; mimeType: string },
): Promise<string | null> {
  try {
    // 1. Create the file-upload object (single-part default).
    const createRes = await fetch("https://api.notion.com/v1/file_uploads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      console.warn(`[imageUpload] file_uploads create failed ${createRes.status}: ${body}`);
      return null;
    }
    const created = (await createRes.json()) as { id?: string; upload_url?: string };
    if (!created.id || !created.upload_url) return null;

    // 2. Send the bytes as multipart/form-data (fetch sets the boundary — do NOT set Content-Type).
    const buffer = Buffer.from(image.data, "base64");
    const blob = new Blob([buffer], { type: image.mimeType });
    const form = new FormData();
    form.append("file", blob, "screenshot.png");

    const sendRes = await fetch(created.upload_url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_VERSION,
      },
      body: form,
    });
    if (!sendRes.ok) {
      const body = await sendRes.text().catch(() => "");
      console.warn(`[imageUpload] file upload send failed ${sendRes.status}: ${body}`);
      return null;
    }

    return created.id;
  } catch (err) {
    console.warn("[imageUpload] unexpected error:", err);
    return null;
  }
}
