import type { ThreadRouter, ThreadRouterResult, ImageAttachment } from "../../core/ports.js";

export class NullThreadRouter implements ThreadRouter {
  async route(
    _replyText: string,
    _replyImages: ImageAttachment[],
    _candidates: Array<{ pageId: string; summary: string; preambleContext?: string }>,
  ): Promise<ThreadRouterResult[]> {
    return [];
  }
}
