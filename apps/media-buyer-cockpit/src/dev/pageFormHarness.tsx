/**
 * The Lead page section and question editor against the real page, without
 * signing in. Serve the page's build on :5191 (the "mergestudio-form" launch
 * entry), `bun run harness`, then open /page-form-harness.html
 * (light: ?theme=light; a failed read: ?fail=read).
 *
 * The fixture is the page's own dist/form.json, copied to
 * tmp/harness/mergestudio-form.json (ignored by git and Vercel). The server
 * is stood in for in memory, with the same rules (pageForm.ts) it uses.
 */
import "@/components/ceo/ceo.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LeadPageSection } from "@/components/pageform/LeadPageSection";
import { Toaster } from "@/components/ui/sonner";
import {
  clean,
  describeChange,
  type PageFormSpec,
  problems,
} from "@/lib/pageForm";
import { usePageForms } from "@/lib/pageFormClient";
import { supabase } from "@/lib/supabase";
import { ThemeProvider } from "@/lib/theme";
import "@/index.css";

const SITE = "http://localhost:5191";
const PHOTOS = [
  "type-villa",
  "type-apartment",
  "type-renovation",
  "type-construction",
  "type-other",
  "help-interior",
  "help-design-build",
  "help-execution",
  "help-unsure",
  "stage-plans",
  "stage-construction",
  "stage-ready",
  "stage-renovation",
  "band-dining",
  "band-stairs",
  "band-living",
  "hero-living",
];

type Version = {
  version: number;
  spec: PageFormSpec;
  summary: string;
  source: "build" | "cockpit";
  at: string;
};

function fakeServer(built: PageFormSpec & { version: string }) {
  const bindings = Object.fromEntries(
    built.questions.flatMap(q => (q.param ? [[q.key, q.param]] : [])),
  );
  const versions: Version[] = [];
  let live = 0;
  const fail = new URLSearchParams(window.location.search).get("fail");
  const spec = () =>
    live ? (versions.find(v => v.version === live) as Version).spec : built;
  const retired = () => {
    const now = new Set(spec().questions.map(q => q.key));
    return [
      ...new Set(
        [built, ...versions.map(v => v.spec)].flatMap(s =>
          s.questions.map(q => q.key).filter(k => !now.has(k)),
        ),
      ),
    ];
  };
  const page = () => ({
    slug: "mergestudio",
    title: "Merge Studio project form",
    siteUrl: SITE,
    publicUrl: `${SITE}/live.json`,
    photos: PHOTOS,
    bindings,
    liveVersion: live,
    current: { ...spec(), version: `v${live || 1}` },
    retired: retired(),
    versions: [...versions].reverse().map(v => ({
      version: v.version,
      label: `v${v.version}`,
      summary: v.summary,
      source: v.source,
      by: v.source === "cockpit" ? "buyer@maharamedia.com" : null,
      at: v.at,
      wentLive: v.at,
      live: v.version === live,
    })),
  });

  return async (body: {
    operation: string;
    args: Record<string, unknown>;
    apply: boolean;
  }) => {
    await new Promise(r => setTimeout(r, 300));
    if (body.operation === "pageForms.read") {
      if (fail === "read") throw new Error("Edge function returned 500");
      return { pages: [page()] };
    }
    if (body.operation === "pageForms.funnel") {
      // Made-up visits, falling screen by screen (?funnel=empty for none).
      if (fail === "funnel") throw new Error("Edge function returned 500");
      const wanted = String(body.args.version ?? `v${live || 1}`);
      const days = Number(body.args.days) || 30;
      // From ads: about two thirds of all visits (?funnel=noads for none from ads).
      const source = body.args.source === "all" ? "all" : "ads";
      const noAds =
        new URLSearchParams(window.location.search).get("funnel") === "noads";
      const chosen =
        versions.find(v => `v${v.version}` === wanted)?.spec ?? built;
      const empty =
        new URLSearchParams(window.location.search).get("funnel") === "empty";
      const all = empty ? 0 : Math.round(8 * days);
      const ads = noAds ? 0 : Math.round(all * 0.68);
      let n = source === "ads" ? ads : all;
      const step = (screen: string, label: string, keep: number) => {
        n = Math.round(n * keep);
        return { screen, label, visits: n };
      };
      const steps = [
        step("intro", "Opened the page", 1),
        ...chosen.questions.map((q, i) =>
          step(`q:${q.key}`, q.label, i === 0 ? 0.52 : i === 2 ? 0.71 : 0.9),
        ),
        step("contact", "Reached the contact step", 0.93),
        step("send", "Pressed send", 0.55),
        step("thanks", "Saw the thank-you page", 0.92),
      ];
      return {
        slug: "mergestudio",
        version: wanted,
        liveVersion: `v${live || 1}`,
        days,
        source,
        counts: { all, ads },
        since: new Date(Date.now() - days * 86_400_000).toISOString(),
        steps,
        versions: !steps[0].visits
          ? []
          : [
              { version: wanted, visits: steps[0].visits },
              { version: "v1", visits: 90 },
            ],
        lastAt: !steps[0].visits
          ? null
          : new Date(Date.now() - 600_000).toISOString(),
        hosts: ["mergestudio-form.vercel.app"],
      };
    }
    if (Number(body.args.base) !== live)
      throw new Error("Someone published a newer version. Reload, then edit.");
    if (body.operation === "pageForms.publish") {
      const draft = body.args.spec as PageFormSpec;
      const wrong = problems(draft, { photos: PHOTOS, retired: retired() });
      if (wrong.length) throw new Error(wrong[0]);
      const next = clean(draft, bindings);
      const summary = describeChange(clean(spec(), bindings), next);
      if (!body.apply)
        return { ok: false, dryRun: true, summary, problems: [] };
      const at = new Date().toISOString();
      if (!versions.length)
        versions.push({
          version: 1,
          spec: built,
          summary: "The questions the page was built with",
          source: "build",
          at,
        });
      const version = versions.length + 1;
      versions.push({ version, spec: next, summary, source: "cockpit", at });
      live = version;
      return { ok: true, receiptId: "harness", version, label: `v${version}` };
    }
    if (body.operation === "pageForms.switch") {
      live = Number(body.args.version);
      return {
        ok: true,
        receiptId: "harness",
        version: live,
        label: `v${live}`,
      };
    }
    throw new Error(`Unknown operation ${body.operation}`);
  };
}

function Demo() {
  const read = usePageForms("mergestudio.kw");
  return (
    <div className="ceo-root mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight">mergestudio.kw</h2>
      <LeadPageSection read={read} />
    </div>
  );
}

async function main() {
  const built = (await fetch("/tmp/harness/mergestudio-form.json").then(r =>
    r.json(),
  )) as PageFormSpec & { version: string };
  const serve = fakeServer(built);
  // The section's calls go through mediaAction: a signed-in user, and the
  // edge function answered here.
  Object.assign(supabase.auth, {
    getUser: async () => ({ data: { user: { id: "harness" } }, error: null }),
  });
  // `functions` is a getter that builds a new client each time: patch its class.
  Object.assign(Object.getPrototypeOf(supabase.functions), {
    invoke: async (_name: string, { body }: { body: never }) => ({
      data: await serve(body),
      error: null,
    }),
  });
  const light =
    new URLSearchParams(window.location.search).get("theme") === "light";
  window.localStorage.setItem("mahara-cockpit-theme", light ? "light" : "dark");
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <ThemeProvider>
        <Toaster />
        <Demo />
      </ThemeProvider>
    </StrictMode>,
  );
}

void main();
