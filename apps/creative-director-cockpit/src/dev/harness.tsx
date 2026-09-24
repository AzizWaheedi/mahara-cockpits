/**
 * The social calendar harness: the real page and sheets, fed by an
 * in-memory backend instead of Convex, so they can be checked at phone
 * and laptop widths without signing in. Started with `bun run harness`;
 * open /harness.html.
 *
 * Fixtures live in tmp/harness/ (ignored by git and Vercel):
 *   posts.json - rows of social_posts for the demo client
 * Work the real backend hands to Salma (captions, pictures, covers) is
 * faked here: it finishes a few seconds after it is asked for, with
 * stand-in results, so the in-flight states can be seen.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SocialCalendarPage } from "@/pages/SocialCalendarPage";
import "@/index.css";
import { setHandlers } from "./convexStub";

type Row = Record<string, any>;

async function main() {
  const posts: Row[] = await fetch("/tmp/harness/posts.json")
    .then(r => (r.ok ? r.json() : []))
    .catch(() => []);
  // The Pages our Meta account manages, as Salma last saw them.
  const metaPages: Row[] = await fetch("/tmp/harness/pages.json")
    .then(r => (r.ok ? r.json() : []))
    .catch(() => []);
  let refreshingUntil = 0;
  const drawn = posts.flatMap(p =>
    ((p.media ?? []) as Row[]).map(m => String(m.url)),
  );
  const sample = (i: number) => drawn[i % Math.max(1, drawn.length)] ?? "";
  let n = 0;

  const client = {
    taskId: "demo-social",
    name: "Sample Client (demo)",
    active: true,
    pillars: ["portfolio", "craft", "education"],
    postsPerMonth: 3,
    dialect: "Gulf Arabic (Qatari)",
    ghlLocationId: null,
    platforms: ["instagram", "facebook"],
    look: "showcase" as string,
    autoApprove: false,
    publishing: false,
    publishingSince: null as string | null,
    page: null as Row | null,
  };
  // One post shown as already out, with its numbers, so that state is seen.
  const shown = posts.find(p => String(p.id).endsWith(":2"));
  if (shown) {
    shown.status = "published";
    shown.published = {
      instagram: {
        id: "179000",
        permalink: "https://www.instagram.com/p/harness/",
        at: "2026-10-15T07:02:00Z",
      },
    };
    shown.results = {
      instagram: { reach: 1840, likes: 96, comments: 11, saved: 14, shares: 6 },
    };
    shown.publish_error =
      "Facebook: Meta gave no Page token. Add pages_manage_posts to the Claude system user in Business Manager, then it posts to Facebook too.";
  }
  const jobs: Row[] = [];
  const library: Row[] = drawn.slice(0, 3).map((url, i) => ({
    id: `lib${i}`,
    url,
    caption: null,
  }));
  const post = (id: unknown) => {
    const p = posts.find(x => x.id === id);
    if (!p) throw new Error("That post is gone.");
    return p;
  };
  const sync = (p: Row) => {
    p.images = (p.media as Row[])
      .filter(m => m.kind === "image")
      .map(m => m.url);
  };
  // Salma, faked: the job finishes after `ms` with a stand-in result.
  const later = (job: Row, ms: number, finish: () => void) => {
    jobs.push(job);
    setTimeout(() => {
      finish();
      jobs.splice(jobs.indexOf(job), 1);
    }, ms);
  };
  const caption = (p: Row) =>
    later(
      { id: `caption:${p.id}`, kind: "caption", post_id: p.id, params: {} },
      3000,
      () => {
        p.caption = `Instagram caption for "${p.topic}".\n\n#harness`;
        p.caption_facebook = `Facebook caption for "${p.topic}", a little longer and without hashtags.`;
      },
    );

  setHandlers({
    "social:roster": () => ({
      month: "2026-09",
      clients: [
        client,
        { ...client, taskId: "other", name: "Another client", active: false },
      ],
    }),
    "social:batch": a => {
      const id = `${a.clientTaskId}:${a.month}`;
      const here = posts.filter(p => p.batch_id === id);
      return {
        month: a.month,
        batch: null,
        posts: structuredClone(here),
        jobs: structuredClone(
          jobs.filter(j => here.some(p => p.id === j.post_id)),
        ),
        health: [
          {
            check: "higgsfield",
            detail:
              "Pictures and covers are paused: Higgsfield is signed out on the server. Sign it in again.",
            at: new Date().toISOString(),
          },
        ],
      };
    },
    "social:setMedia": a => {
      const p = post(a.postId);
      p.media = a.media;
      p.slides = Math.max(1, (a.media as Row[]).length);
      sync(p);
      return null;
    },
    "social:setRefs": a => {
      post(a.postId).refs = a.refs;
      return null;
    },
    "social:updatePost": a => {
      const p = post(a.postId);
      if (a.caption !== undefined) p.caption = a.caption;
      if (a.captionFacebook !== undefined)
        p.caption_facebook = a.captionFacebook;
      if (a.platforms !== undefined) p.platforms = a.platforms;
      if (a.aspect !== undefined) p.aspect = a.aspect;
      return null;
    },
    "social:writeCaption": a => {
      caption(post(a.postId));
      return null;
    },
    "social:generatePost": a => {
      const p = post(a.postId);
      const params =
        a.index !== undefined ? { index: a.index } : a.add ? { add: true } : {};
      later(
        {
          id: `generate:${p.id}:${n++}`,
          kind: "generate",
          post_id: p.id,
          params,
        },
        6000,
        () => {
          const media = (p.media ?? []) as Row[];
          if (a.index !== undefined)
            media[a.index as number] = {
              ...media[a.index as number],
              url: sample(n++),
            };
          else if (a.add)
            media.push({ kind: "image", url: sample(n++), source: "ai" });
          else if (media.some(m => m.source === "ai"))
            media.forEach((m, i) => {
              if (m.source === "ai") media[i] = { ...m, url: sample(n++) };
            });
          else
            for (let i = 0; i < p.slides; i++)
              media.push({ kind: "image", url: sample(n++), source: "ai" });
          p.media = media;
          sync(p);
        },
      );
      return { queued: true };
    },
    "social:makeCover": a => {
      const p = post(a.postId);
      later(
        {
          id: `cover:${p.id}:${a.index}`,
          kind: "cover",
          post_id: p.id,
          params: { index: a.index },
        },
        6000,
        () => {
          const m = (p.media as Row[])[a.index as number];
          if (m) m.cover = sample(n++);
        },
      );
      return null;
    },
    "social:addPost": a => {
      const month = String(a.month);
      const batch = `${a.clientTaskId}:${month}`;
      const id = `${batch}:${100 + n++}`;
      const media = (a.media as Row[] | undefined) ?? [];
      const p: Row = {
        id,
        batch_id: batch,
        client_task_id: a.clientTaskId,
        n: 100 + n,
        pillar: a.pillar,
        topic: a.topic,
        slides: media.length || (a.slides as number) || 1,
        caption: null,
        caption_facebook: null,
        images: [],
        media,
        refs: a.refs ?? [],
        platforms: null,
        aspect: a.aspect ?? "4:5",
        scheduled_at: a.when,
        status: "approved",
        error: null,
      };
      sync(p);
      posts.push(p);
      caption(p);
      if (a.generate && !media.length)
        later(
          { id: `generate:${id}`, kind: "generate", post_id: id, params: {} },
          6000,
          () => {
            p.media = Array.from({ length: p.slides }, () => ({
              kind: "image",
              url: sample(n++),
              source: "ai",
            }));
            sync(p);
          },
        );
      if (media.length === 1 && media[0].kind === "video")
        later(
          {
            id: `cover:${id}:0`,
            kind: "cover",
            post_id: id,
            params: { index: 0 },
          },
          7000,
          () => {
            (p.media as Row[])[0].cover = sample(n++);
          },
        );
      return { id, n: p.n, generating: Boolean(a.generate) };
    },
    "social:removePost": a => {
      posts.splice(posts.indexOf(post(a.postId)), 1);
      return { removed: true };
    },
    "social:schedulePost": a => {
      post(a.postId).scheduled_at = a.when;
      return { at: a.when, pushedToGhl: false };
    },
    "social:configure": a => {
      if (a.platforms) client.platforms = a.platforms as string[];
      if (a.autoApprove !== undefined)
        client.autoApprove = Boolean(a.autoApprove);
      if (a.look !== undefined) client.look = String(a.look);
      if (a.publishing !== undefined) {
        client.publishing = Boolean(a.publishing);
        client.publishingSince = a.publishing ? new Date().toISOString() : null;
      }
      if (a.pillars) client.pillars = a.pillars as string[];
      if (a.dialect !== undefined) client.dialect = String(a.dialect);
      if (a.postsPerMonth !== undefined)
        client.postsPerMonth = Number(a.postsPerMonth);
      return { ok: true };
    },
    "social:setWords": a => {
      const p = post(a.postId);
      const m = (p.media as Row[])[a.index as number];
      if (!m) throw new Error("There is no picture at that place on the post.");
      m.words = a.words;
      later(
        {
          id: `words:${p.id}:${a.index}`,
          kind: "words",
          post_id: p.id,
          params: { index: a.index },
        },
        1500,
        () => {
          delete m.readback;
        },
      );
      return null;
    },
    "social:addWords": a => {
      const p = post(a.postId);
      const m = (p.media as Row[])[a.index as number];
      later(
        {
          id: `words:${p.id}:${a.index}`,
          kind: "words",
          post_id: p.id,
          params: { index: a.index, write: true },
        },
        2500,
        () => {
          m.words = {
            title: "فيلا السدرة",
            line: "VILLA AL SIDRA · DOHA",
            cta: "احجز استشارتك المجانية",
            handle: "@sampleclient",
          };
          m.look = "showcase";
        },
      );
      return null;
    },
    "social:makeItMove": a => {
      const p = post(a.postId);
      const media = p.media as Row[];
      const m = media[a.index as number];
      if (m?.look === "bold" && m.words)
        throw new Error(
          "The words on this picture are drawn into it, so it cannot move without bending them. Move a picture from the project look, or one without words.",
        );
      const video = posts
        .flatMap(x => (x.media ?? []) as Row[])
        .find(x => x.kind === "video")?.url;
      later(
        {
          id: `motion:${p.id}:${a.index}`,
          kind: "motion",
          post_id: p.id,
          params: { index: a.index },
        },
        6000,
        () => {
          media[a.index as number] = {
            kind: "video",
            url: video ?? m.url,
            source: "ai",
            cover: m.url,
            from: m.url,
            words: m.words,
            look: m.look,
            motion: {
              camera: "A slow, smooth dolly-in toward the villa",
              person: "a man in a white thobe walks along the pool's edge",
              motion: "palm fronds sway",
            },
          };
          sync(p);
        },
      );
      return null;
    },
    "social:setActive": () => ({ active: true }),
    "social:pages": () => {
      // The harness has no client with ads, so the first Page that has a
      // client stands in for "their ads run here".
      const adsPage = metaPages.find(p => (p.ad_clients ?? []).length)?.page_id;
      return {
        pages: metaPages.map(p => ({
          pageId: p.page_id,
          name: p.name,
          picture: p.picture_url,
          igUserId: p.ig_user_id,
          igUsername: p.ig_username,
          igPicture: p.ig_picture_url,
          suggested: p.page_id === adsPage ? "ads" : null,
        })),
        current: client.page
          ? {
              pageId: client.page.id,
              name: client.page.name,
              igUserId: client.page.igUserId,
              igUsername: client.page.igUsername,
              linkedAt: null,
              linkedBy: null,
            }
          : null,
        refreshedAt: new Date().toISOString(),
        refreshing: Date.now() < refreshingUntil,
        refreshError: null,
      };
    },
    "social:linkAccounts": a => {
      const p = metaPages.find(x => x.page_id === a.pageId);
      client.page = p
        ? {
            id: p.page_id,
            name: p.name,
            igUserId: p.ig_user_id,
            igUsername: p.ig_username,
          }
        : null;
      return { linked: Boolean(p) };
    },
    "social:refreshPages": () => {
      refreshingUntil = Date.now() + 6000;
      return null;
    },
    "social:sendForSignoff": a => {
      const ids = a.postIds as string[];
      const ready = posts.filter(
        p =>
          ids.includes(p.id) &&
          (p.media ?? []).length &&
          String(p.caption ?? "").trim(),
      );
      for (const p of ready) {
        p.client_status = "sent";
        p.client_sent_at = new Date().toISOString();
        p.review_token = "harness-token";
      }
      return {
        url: "https://cockpit.maharamedia.com/editor/review/harness-token",
        sent: ready.length,
        skipped: ids.length - ready.length,
      };
    },
    "social:fillMonth": () => ({ filling: 0, days: [] }),
    "social:library": () => structuredClone(library),
    "social:addToLibrary": a => {
      library.unshift({ id: `lib${n++}`, url: a.url, caption: null });
      return null;
    },
    "social:removeFromLibrary": a => {
      library.splice(
        library.findIndex(l => l.id === a.id),
        1,
      );
      return null;
    },
    "social:uploadUrl": async a => {
      const r = await fetch("/__harness/sign", {
        method: "POST",
        body: JSON.stringify(a),
      });
      if (!r.ok) throw new Error("The harness could not sign that upload.");
      return r.json();
    },
  });
  Object.assign(window, { __harness: { posts, jobs, client, library } });

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider defaultTheme="light" switchable>
        <Toaster />
        <SocialCalendarPage />
      </ThemeProvider>
    </StrictMode>,
  );
}

void main();
