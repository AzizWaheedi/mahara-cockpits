// The pipeline board's Closed column (the CEO, 2026-10-11: a signed client
// stays in the sales tool, in Closed): the answer's check, the column's
// order and header, and a client's card as it draws (no drag, no "Move to…").
//
// bun test src/pages/PipelinePage.test.tsx

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

// The Supabase client needs the build's settings; nothing here reaches it.
mock.module("../lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));
mock.module("../lib/api", () => ({
  api: async () => ({}),
}));

const {
  boardProblem,
  ClientCard,
  closedHeader,
  columnOrder,
  fixed,
  signedLabel,
} = await import("./PipelinePage");
const { pipelineBoardFake, pipelineMoveFake } = await import(
  "../dev/pipelineFake"
);
type Card = import("./PipelinePage").Card;

const YEAR = new Date().getFullYear();
const STAGES = [
  {
    id: "st-demo",
    name: "📅Demo Booked (Qualified)",
    position: 3,
    role: "demo_booked",
  },
  { id: "st-closed", name: "🎉Closed", position: 5, role: "won" },
];

const card = (over: Partial<Card> = {}): Card => ({
  contact_id: "lead-13",
  name: "Faisal 12",
  lead_class: "qualified",
  stage_id: "st-closed",
  heat: 0,
  reasons: [],
  hot: false,
  last_objection: null,
  last_touch_at: null,
  wrote_at: null,
  next_at: null,
  next_what: null,
  owner: "Sara Khalil",
  dnd: false,
  quiet: false,
  client: true,
  closed: true,
  signed_at: `${YEAR}-10-09T12:00:00Z`,
  value: 6000,
  closer: "Omar Haddad",
  setter: "Sara Khalil",
  crm_stage: "📅Demo Booked (Qualified)",
  ...over,
});

const draw = (c: Card) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ClientCard c={c} stages={STAGES} />
    </MemoryRouter>,
  );

describe("the board's answer is checked before it is drawn", () => {
  test("a whole board passes", () => {
    expect(boardProblem(pipelineBoardFake({ scope: "team" }))).toBeNull();
  });
  test("an answer with no pipeline stages is a failed read, never a crash", () => {
    // The harness's default answer before 2026-10-11 (a mark's).
    expect(boardProblem({ mark: { crm: "written" } })).toBe(
      "the answer had no pipeline stages in it",
    );
    expect(boardProblem(null)).toBe("the answer was empty");
    expect(boardProblem({ pipeline: { id: "p", name: "P", stages: [] } })).toBe(
      "the answer had no cards in it",
    );
    expect(
      boardProblem({
        pipeline: { id: "p", name: "P", stages: [] },
        cards: [],
      }),
    ).toBe("the answer had no pipelines in it");
  });
});

describe("the Closed column", () => {
  test("its header counts open leads apart from signed clients, the zeros left out", () => {
    expect(closedHeader({ open: 6, signed: 69 })).toBe("6 open · 69 signed");
    expect(closedHeader({ open: 0, signed: 3 })).toBe("3 signed");
    expect(closedHeader({ open: 2, signed: 0 })).toBe("2 open");
    expect(closedHeader({ open: 0, signed: 0 })).toBe("0");
  });

  test("closed cards keep the server's order (newest signing first), ahead of a lead just dropped in", () => {
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const later = new Date(Date.now() + 9_000_000).toISOString();
    const list = [
      card({ contact_id: "a", closed: true }),
      card({
        contact_id: "dropped",
        closed: false,
        client: false,
        next_at: later,
      }),
      card({ contact_id: "b", closed: true }),
      card({ contact_id: "c", closed: true }),
      card({
        contact_id: "dropped-soon",
        closed: false,
        client: false,
        next_at: soon,
      }),
    ];
    expect(columnOrder(list).map(c => c.contact_id)).toEqual([
      "a",
      "b",
      "c",
      "dropped-soon",
      "dropped",
    ]);
  });

  test("open columns still go by next step, then heat", () => {
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const list = [
      card({ contact_id: "cold", closed: false, client: false, heat: 1 }),
      card({ contact_id: "hot", closed: false, client: false, heat: 9 }),
      card({ contact_id: "next", closed: false, client: false, next_at: soon }),
    ];
    expect(columnOrder(list).map(c => c.contact_id)).toEqual([
      "next",
      "hot",
      "cold",
    ]);
  });

  test("only a client is fixed in place; a legacy Closed lead can still be moved", () => {
    expect(fixed(card())).toBe(true);
    expect(fixed(card({ client: false }))).toBe(false);
    expect(fixed(card({ client: undefined }))).toBe(false);
  });

  test("the chip: the day they signed, or Active client for the tag alone", () => {
    expect(signedLabel(card())).toBe("Signed 9 Oct");
    expect(signedLabel(card({ signed_at: null }))).toBe("Active client");
  });
});

describe("a client's card", () => {
  test("signed: the chip, the value and who closed it, HighLevel's real stage; no drag and no Move to", () => {
    const html = draw(card());
    expect(html).toContain("Signed 9 Oct");
    expect(html).toContain("$6,000");
    expect(html).toContain("closed by Omar");
    expect(html).toContain("In HighLevel: Demo booked (qualified)");
    expect(html).not.toContain("draggable");
    expect(html).not.toContain("Move to");
    expect(html).not.toContain("<select");
  });

  test("tag only: Active client, and no value line (unknown, never $0)", () => {
    const html = draw(
      card({ signed_at: null, value: null, closer: null, setter: null }),
    );
    expect(html).toContain("Active client");
    expect(html).not.toContain("$0");
    expect(html).not.toContain("closed by");
  });

  test("HighLevel's stage is said only when it is not the column's own", () => {
    expect(draw(card({ crm_stage: "🎉Closed" }))).not.toContain("In HighLevel");
  });
});

describe("the harness's board and move", () => {
  test("the 2-Call board: a tagged client, two signed on the form and a legacy Closed lead, in Closed", () => {
    const b = pipelineBoardFake({ scope: "team" }) as {
      cards: Card[];
      counts: { open: number; signed: number };
      closed_stage: { id: string; synthetic: boolean };
    };
    const closed = b.cards.filter(c => c.closed);
    expect(closed.map(c => c.contact_id)).toEqual([
      "lead-13",
      "lead-14",
      "lead-24",
      "lead-20",
    ]);
    expect(closed.every(c => c.stage_id === "st-closed")).toBe(true);
    expect(b.counts).toEqual({ open: 1, signed: 3 });
    expect(b.closed_stage).toEqual({
      id: "st-closed",
      name: "🎉Closed",
      synthetic: false,
    });
  });

  test("a pipeline with no won stage: the Signed column", () => {
    const b = pipelineBoardFake({ pipeline_id: "pipe-ls" }) as {
      closed_stage: { synthetic: boolean };
    };
    expect(b.closed_stage.synthetic).toBe(true);
  });

  test("moving a client is refused as the server refuses it", () => {
    let err: { message: string; status: number; code: string | null } | null =
      null;
    try {
      pipelineMoveFake({ contact_id: "lead-13", stage_id: "st-new" });
    } catch (e) {
      err = e as typeof err;
    }
    expect(err?.status).toBe(409);
    expect(err?.code).toBe("client");
    expect(err?.message).toBe(
      "This client is signed, so they stay in Closed. Client success looks after them.",
    );
    expect(
      (
        pipelineMoveFake({ contact_id: "lead-1", stage_id: "st-intro" })
          .move as { state: string }
      ).state,
    ).toBe("done");
  });
});
