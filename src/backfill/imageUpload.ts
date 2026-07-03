import { Client } from "@notionhq/client";

/**
 * Upload one image to Notion via the File Upload API and return its id, or null on
 * any failure. Never throws — image embed is best-effort; the Slack link is the fallback.
 */
export async function uploadImageToNotion(
  apiKey: string,
  image: { data: string; mimeType: string },
): Promise<string | null> {
  try {
    const client = new Client({ auth: apiKey, notionVersion: "2022-06-28" });
    const created: any = await (client as any).fileUploads.create({
      mode: "single_part",
      filename: "screenshot.png",
      content_type: image.mimeType,
    });
    const buffer = Buffer.from(image.data, "base64");
    const blob = new Blob([buffer], { type: image.mimeType });
    await (client as any).fileUploads.send({ file_upload_id: created.id, file: { data: blob, filename: "screenshot.png" } });
    return created.id ?? null;
  } catch {
    return null;
  }
}
