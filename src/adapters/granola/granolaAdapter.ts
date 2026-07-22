import type {
  GranolaClient,
  GranolaGate,
  Enricher,
  Judge,
  NotionWriter,
  DedupStore,
  SimilarityDetector,
  FeedbackCategory,
} from "../../core/ports.js";
import type { Logger } from "../../util/logger.js";

export interface GranolaPollerOptions {
  folderId: string;
  pollIntervalMs: number;
}

export interface GranolaPollerDeps {
  granolaClient: GranolaClient;
  gate: GranolaGate;
  enricher: Enricher;
  judge: Judge;
  notion: NotionWriter;
  dedup: DedupStore;
  similarityDetector: SimilarityDetector;
  similarityWindowDays: number;
  /** Written to FeedbackRecord.source. Defaults to "Granola". */
  source?: string;
}

/**
 * Derives the client company name from the participants list.
 * Looks for the first participant whose email domain is NOT @spottedzebra.co.uk.
 * Falls back to extracting the last word of the meeting title if no external email found.
 */
function deriveClientCompany(participants: string[], title: string): string {
  for (const p of participants) {
    const emailMatch = p.match(/@([^)>\s]+)/);
    if (emailMatch) {
      const domain = emailMatch[1].toLowerCase();
      if (!domain.includes("spottedzebra")) {
        // Return the company part (strip TLD): "acme.com" → "acme"
        return domain.split(".")[0]!;
      }
    }
  }
  // Fall back: try to extract a company name from the title.
  // e.g. "Eddie / Priya Sharma - QBR: Assessment" → no clear company
  // Return empty so the field is omitted rather than guessed wrongly.
  return "";
}

/**
 * Extracts participant names from a Granola markdown note.
 * Granola formats participants as bullet list items before section headings.
 * We look for a line that starts with "- " and contains a name.
 */
function extractParticipants(markdownContent: string): string[] {
  const lines = markdownContent.split("\n");
  const participants: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Participant lines: "- Name (Company)" or "- Name, Title"
    if (trimmed.startsWith("- ") && !trimmed.startsWith("- **") && trimmed.length < 120) {
      const name = trimmed.slice(2).trim();
      if (name && !name.match(/^[A-Z][a-z]+ to /)) { // skip action items like "Eddie to ..."
        participants.push(name);
      }
    }
    // Stop at first section heading (indicates we've left the participant block)
    if (trimmed.startsWith("###")) break;
  }
  return participants;
}

/** Finds related feedback (same-category recent rows). Fails open (null). */
async function findRelatedFeedback(
  deps: GranolaPollerDeps,
  summary: string,
  categories: FeedbackCategory[],
  logger: Logger,
): Promise<{ matchedPageId: string; rationale: string } | null> {
  try {
    const sinceDateIso = new Date(Date.now() - deps.similarityWindowDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const candidates = await deps.notion.findRecentByCategories(categories, sinceDateIso);
    if (candidates.length === 0) return null;
    return await deps.similarityDetector.findSimilar(summary, categories, candidates);
  } catch (err) {
    logger.warn("[granolaAdapter] Similarity check failed (fail-open)", { err: String(err) });
    return null;
  }
}

/**
 * Processes a single Granola note through the pipeline:
 * gate → split → enrich → judge → write to Notion.
 * Fails open — a failure in any step is logged and the note is skipped.
 */
async function processNote(
  noteId: string,
  title: string,
  content: string,
  deps: GranolaPollerDeps,
  logger: Logger,
): Promise<void> {
  const source = deps.source ?? "Granola";
  const dedupKey = `granola:${noteId}`;

  // Gate: should we capture this note?
  const gateResult = await deps.gate
    .classify(title, content, [])
    .catch((err) => {
      logger.warn("[granolaAdapter] Gate threw (fail-open → capture)", { noteId, err: String(err) });
      return null; // null = fail-open → treat as capture
    });

  if (gateResult !== null && !gateResult.shouldCapture) {
    logger.info("[granolaAdapter] Gate skipped note", { noteId, title, reason: gateResult.reason });
    return;
  }

  // Extract participants from content for clientCompany derivation.
  const participants = extractParticipants(content);
  const clientCompany = deriveClientCompany(participants, title);

  const dateIso = new Date().toISOString().slice(0, 10);
  const authorName = participants.length > 0 ? participants.join(", ") : "Unknown";

  // Enrich: split note into individual feedback items.
  const enrichments = await deps.enricher.enrich(content, "Granola").catch((err) => {
    logger.warn("[granolaAdapter] Enrichment failed (fail-open → skip)", { noteId, err: String(err) });
    return null;
  });

  if (!enrichments || enrichments.length === 0) {
    logger.info("[granolaAdapter] Enrichment returned null/empty — skipping note", { noteId });
    return;
  }

  const pageIds: string[] = [];

  for (const enrichment of enrichments) {
    const verdict = await deps.judge
      .review(content, "Granola", enrichment.summary, enrichment.categories)
      .catch(() => null);

    const relatedMatch = await findRelatedFeedback(deps, enrichment.summary, enrichment.categories, logger);

    try {
      const pageId = await deps.notion.createFeedback({
        message: content.slice(0, 2000),
        channelName: title,
        authorName,
        dateIso,
        flaggedByName: "Granola (auto)",
        source,
        messageUrl: "",
        customerAccount: enrichment.clientName ?? clientCompany,
        summary: enrichment.summary,
        categories: enrichment.categories,
        aiSuggestedCategories: [...enrichment.categories],
        aiSuggestedSummary: enrichment.summary,
        confidence: verdict?.confidence,
        rationale: verdict?.rationale,
        sourceMessageKey: dedupKey,
        preambleContext: enrichment.preambleContext,
        mentionedUsers: enrichment.mentionedUsers,
        relatedFeedbackPageId: relatedMatch?.matchedPageId,
        relatedFeedbackRationale: relatedMatch?.rationale,
        ...(clientCompany ? { clientCompany } : {}),
        audience: "Unknown",
        status: "New",
      });
      pageIds.push(pageId);
    } catch (err) {
      logger.error("[granolaAdapter] notion.createFeedback failed", { noteId, err: String(err) });
    }
  }

  if (pageIds.length === 0) {
    logger.warn("[granolaAdapter] No pages created for note — skipping dedup record", { noteId });
    return;
  }

  // Record in dedup store ONLY after successful write.
  deps.dedup.recordMultiple(dedupKey, pageIds);
  logger.info("[granolaAdapter] Captured note", { noteId, title, pageCount: pageIds.length });

  // Pass 2: sibling links. Fail-open.
  if (pageIds.length > 1) {
    for (const pageId of pageIds) {
      const siblings = pageIds.filter((id) => id !== pageId);
      await deps.notion.updateSiblingLinks(pageId, siblings).catch((err) => {
        logger.warn("[granolaAdapter] updateSiblingLinks failed (fail-open)", { pageId, err: String(err) });
      });
    }
  }
}

/**
 * Starts the Granola poller. Non-blocking — uses setInterval.
 * On each tick: list notes in folder, skip already-seen ones, process each new note.
 *
 * Called from main() alongside startHttpMode. The interval fires independently of the
 * HTTP server lifecycle.
 */
export function startGranolaPoller(
  options: GranolaPollerOptions,
  deps: GranolaPollerDeps,
  logger: Logger,
): void {
  logger.info(`[granolaAdapter] Granola poller started (folder=${options.folderId}, interval=${options.pollIntervalMs}ms)`);

  const tick = async (): Promise<void> => {
    try {
      const notes = await deps.granolaClient.listNotes(options.folderId);
      const newNotes = notes.filter((n) => !deps.dedup.has(`granola:${n.id}`));

      if (newNotes.length === 0) {
        logger.info("[granolaAdapter] Poll: no new notes");
        return;
      }

      logger.info(`[granolaAdapter] Poll: ${newNotes.length} new note(s) to process`);

      for (const note of newNotes) {
        const content = await deps.granolaClient.getNoteContent(note.id).catch((err) => {
          logger.warn("[granolaAdapter] getNoteContent failed", { noteId: note.id, err: String(err) });
          return "";
        });

        if (!content.trim()) {
          logger.info("[granolaAdapter] Skipping empty note", { noteId: note.id });
          continue;
        }

        await processNote(note.id, note.title, content, deps, logger);
      }
    } catch (err) {
      logger.error("[granolaAdapter] Poll tick failed (fail-open)", { err: String(err) });
    }
  };

  // Run once immediately, then on interval.
  // unref() so the interval never prevents the process from exiting naturally
  // (important for tests and clean shutdown).
  void tick();
  const interval = setInterval(() => void tick(), options.pollIntervalMs);
  interval.unref();
}

/**
 * Stub GranolaClient. Returns an empty list — safe no-op.
 * Used when the Granola MCP is not connected.
 *
 * TODO(DS-73-mcp): Replace with a real McpGranolaClient once MCP access
 * from the Node process is confirmed. The MCP tools are:
 *   - mcp__claude_ai_Granola__list_meetings (with folder filter)
 *   - mcp__claude_ai_Granola__get_meeting_transcript
 */
export class StubGranolaClient implements GranolaClient {
  // GranolaClient is imported from ports.ts but this file also needs the type
  async listNotes(_folderId: string): Promise<import("../../core/ports.js").GranolaNote[]> {
    return [];
  }

  async getNoteContent(_noteId: string): Promise<string> {
    return "";
  }
}
