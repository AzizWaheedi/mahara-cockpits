import { z } from "zod";
import {
  type ProposalPatch,
  priceSchema,
  proposalContentSchema,
} from "./proposalContent";
import { type Proposal, ProposalError } from "./proposalSources";

export type SaveState = "saved" | "queued" | "saving" | "error" | "conflict";
export type ProposalSaveSnapshot = {
  proposal: Proposal;
  state: SaveState;
  message: string;
  dirty: boolean;
};
export function applyProposalPatch(
  p: Proposal,
  patch: ProposalPatch,
): Proposal {
  return {
    ...p,
    ...(patch.content ? { content: patch.content } : {}),
    ...(patch.price ? { price: patch.price } : {}),
    ...(patch.lang ? { lang: patch.lang } : {}),
    ...(patch.valid_until !== undefined
      ? { validUntil: patch.valid_until }
      : {}),
    ...(patch.price_reason !== undefined
      ? { priceReason: patch.price_reason }
      : {}),
  };
}
const draftSchema = z.object({
  baseRevision: z.number().int().positive(),
  patch: z
    .object({
      content: proposalContentSchema.optional(),
      price: priceSchema.optional(),
      lang: z.enum(["en", "ar"]).optional(),
      valid_until: z.string().optional(),
      price_reason: z.string().nullable().optional(),
    })
    .strict(),
});
export type ProposalDraft = z.infer<typeof draftSchema>;
export type ProposalDraftStore = {
  load: () => ProposalDraft | null;
  save: (draft: ProposalDraft) => void;
  clear: () => void;
};

/** Per-tab recovery, claimed by one controller. An old request cannot erase a newer draft. */
export function sessionProposalDraft(
  taskId: string,
  id: string,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): ProposalDraftStore {
  const key = `mahara:proposal-draft:v1:${taskId}:${id}`;
  let target = storage;
  if (!target) {
    try {
      target = globalThis.sessionStorage;
    } catch {
      /* Saving still works without browser storage. */
    }
  }
  let token: string | null = null;
  const read = (): { token: string; draft: ProposalDraft } | null => {
    if (!target) return null;
    const raw = target.getItem(key);
    if (!raw) return null;
    const parsed = z
      .object({ token: z.string(), draft: draftSchema })
      .safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  };
  const write = (draft: ProposalDraft) => {
    if (!target || read()?.token !== (token ?? undefined)) return;
    const next = crypto.randomUUID();
    target.setItem(key, JSON.stringify({ token: next, draft }));
    token = next;
  };
  return {
    load() {
      try {
        const current = read();
        token = current?.token ?? null;
        if (current) write(current.draft);
        return current?.draft ?? null;
      } catch {
        return null;
      }
    },
    save(draft) {
      try {
        write(draft);
      } catch {
        /* The in-memory queue remains intact when storage is unavailable/full. */
      }
    },
    clear() {
      try {
        if (target && read()?.token === (token ?? undefined)) {
          target.removeItem(key);
          token = null;
        }
      } catch {
        /* Keep the in-memory state usable. */
      }
    },
  };
}

/** One in-flight write; newer edits stay ahead of its response and survive SPA departure. */
export class ProposalSaver {
  private row: Proposal;
  private revision: number;
  private pending: ProposalPatch = {};
  private flightPatch: ProposalPatch = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flight: Promise<Proposal> | null = null;
  private state: SaveState = "saved";
  private message = "Saved";
  private closed = false;
  private epoch = 0;
  private listeners = new Set<(s: ProposalSaveSnapshot) => void>();
  private write: (patch: ProposalPatch, revision: number) => Promise<Proposal>;
  private delay: number;
  private drafts?: ProposalDraftStore;
  constructor(
    row: Proposal,
    write: (patch: ProposalPatch, revision: number) => Promise<Proposal>,
    delay = 600,
    drafts?: ProposalDraftStore,
  ) {
    this.row = row;
    this.revision = row.revision;
    this.write = write;
    this.delay = delay;
    this.drafts = drafts;
    const recovered = drafts?.load();
    if (recovered && Object.keys(recovered.patch).length) {
      this.pending = recovered.patch;
      this.row = applyProposalPatch(row, recovered.patch);
      this.revision = recovered.baseRevision;
      this.state =
        row.revision === recovered.baseRevision ? "error" : "conflict";
      this.message =
        this.state === "error"
          ? "Recovered unsaved changes. Retry save to keep them."
          : "Recovered unsaved changes, but a newer version was saved. Reload the saved proposal to discard these edits.";
    }
  }
  snapshot = (): ProposalSaveSnapshot => ({
    proposal: this.row,
    state: this.state,
    message: this.message,
    dirty: !!this.flight || Object.keys(this.pending).length > 0,
  });
  subscribe(fn: (s: ProposalSaveSnapshot) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    if (!this.closed) for (const fn of this.listeners) fn(this.snapshot());
  }
  private persist() {
    const patch = { ...this.flightPatch, ...this.pending };
    if (Object.keys(patch).length)
      this.drafts?.save({ baseRevision: this.revision, patch });
    else this.drafts?.clear();
  }
  edit(patch: ProposalPatch, immediate = false) {
    if (this.closed) return;
    this.pending = { ...this.pending, ...patch };
    this.row = applyProposalPatch(this.row, patch);
    this.persist();
    if (this.timer) clearTimeout(this.timer);
    if (this.state !== "conflict" && this.state !== "error") {
      this.state = this.flight ? "saving" : "queued";
      this.message = "Changes waiting to save";
      this.timer = setTimeout(
        () => {
          this.timer = null;
          void this.flush().catch(() => undefined);
        },
        immediate ? 0 : this.delay,
      );
    }
    this.emit();
  }
  async flush(): Promise<Proposal> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.closed) return this.row;
    if (this.state === "conflict")
      throw new ProposalError(this.message, "40001");
    if (this.flight) {
      await this.flight;
      return this.flush();
    }
    if (!Object.keys(this.pending).length) return this.row;
    const patch = this.pending;
    const epoch = this.epoch;
    this.pending = {};
    this.flightPatch = patch;
    this.state = "saving";
    this.message = "Saving";
    this.persist();
    this.emit();
    this.flight = Promise.resolve()
      .then(() =>
        this.closed || epoch !== this.epoch
          ? null
          : this.write(patch, this.revision),
      )
      .then(saved => {
        if (!saved || epoch !== this.epoch) return this.row;
        this.revision = saved.revision;
        this.flightPatch = {};
        this.row = applyProposalPatch({ ...this.row, ...saved }, this.pending);
        this.state = Object.keys(this.pending).length ? "queued" : "saved";
        this.message =
          this.state === "saved" ? "Saved" : "Changes waiting to save";
        this.persist();
        return this.row;
      })
      .catch((error: unknown) => {
        if (epoch === this.epoch) {
          this.pending = { ...patch, ...this.pending };
          this.flightPatch = {};
          this.state =
            error instanceof ProposalError && error.code === "40001"
              ? "conflict"
              : "error";
          this.message =
            error instanceof Error
              ? error.message
              : "The proposal did not save. Your changes are kept here.";
          this.persist();
        }
        throw error;
      })
      .finally(() => {
        this.flight = null;
        this.emit();
      });
    await this.flight;
    return this.flush();
  }
  replace(row: Proposal) {
    if (this.closed) return;
    if (row.id !== this.row.id || row.taskId !== this.row.taskId)
      throw new Error("This response belongs to another proposal.");
    if (this.snapshot().dirty)
      throw new Error(
        "Save the pending changes before refreshing this proposal.",
      );
    this.row = row;
    this.revision = row.revision;
    this.state = "saved";
    this.message = "Saved";
    this.persist();
    this.emit();
  }
  /** Departure stops queued writes; recovery keeps them available when this page reopens. */
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  /** A request already sent may finish; wait for it before loading the server again. */
  async discard() {
    this.close();
    this.epoch++;
    this.pending = {};
    this.flightPatch = {};
    this.drafts?.clear();
    await this.flight?.catch(() => undefined);
  }
}
