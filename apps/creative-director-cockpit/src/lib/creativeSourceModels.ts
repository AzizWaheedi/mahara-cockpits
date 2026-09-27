/** Original verified read calculations from convex/{clients,creative,funnels,scripts,winners}.
 * Reads only the RPC-filtered snapshot, never network or mutation state. */
type SnapshotQuery={collect():Promise<any[]>;first():Promise<any|null>;unique():Promise<any|null>;withIndex(name:string,filter:(query:any)=>any):SnapshotQuery};
type QueryCtx={db:{query(name:string):SnapshotQuery}};
export function snapshotContext(tables:Record<string,any[]>):QueryCtx {
 const query=(rows:any[]):SnapshotQuery=>({async collect(){return [...rows];},async first(){return rows[0]??null;},async unique(){if(rows.length>1)throw new Error('The source contains conflicting unique rows');return rows[0]??null;},withIndex(_name,filter){let kept=rows;const q={eq(field:string,value:unknown){kept=kept.filter(r=>r[field]===value);return q;}};filter(q);return query(kept);}});
 return {db:{query(name){if(!Array.isArray(tables[name]))throw new Error('Verified source unavailable: '+name);return query(tables[name]);}}};
}
function inScope(scope: Set<string> | null, name?: string): boolean { return !scope || scope.has((name ?? '').trim().toLowerCase()); }
function rowInScope(scope: Set<string> | null, row: any): boolean { return !scope || (row.clients ?? [row.client]).some((n: any) => inScope(scope, n)); }
const LIVE_STATUSES = new Set([
    "active",
    "launch booked",
    "ready for launch🚀",
    "ready for launch",
    "onboarding booked",
]);
const PRELAUNCH_STATUSES = new Set([
    "launch booked",
    "ready for launch🚀",
    "ready for launch",
    "onboarding booked",
]);
const DONE = new Set(["complete", "cancelled", "closed", "done", "live 🚀"]);
function isOpen(status: string): boolean {
    return !DONE.has((status || "").toLowerCase());
}
export function isLive(status?: string): boolean {
    return LIVE_STATUSES.has((status || "").toLowerCase());
}
export function isPrelaunch(status?: string): boolean {
    return PRELAUNCH_STATUSES.has((status || "").toLowerCase());
}
function norm(x?: string): string {
    return (x || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}
export async function buildRoster(ctx: QueryCtx, scope: Set<string> | null): Promise<any> {
    // Client access set in the portal: an empty list means every client.
    const clients = (await ctx.db.query("clients").collect()).filter((c: any) => inScope(scope, c.name));
    const tasks = (await ctx.db.query("creativeTasks").collect()).filter((t: any) => rowInScope(scope, t));
    const videos = (await ctx.db.query("videoJobs").collect()).filter((t: any) => rowInScope(scope, t));
    const campaigns = (await ctx.db.query("campaigns").collect()).filter((k: any) => inScope(scope, k.clientName));
    const openTasks = tasks.filter((t: any) => isOpen(t.status));
    const openVideos = videos.filter((t: any) => isOpen(t.status));
    const rows = clients
        .filter((c: any) => isLive(c.clientStatus))
        .map((c: any) => {
        const mine = (t: {
            clients?: string[];
            client?: string;
        }) => (t.clients ?? (t.client ? [t.client] : [])).includes(c.name);
        const scripts = openTasks.filter((t: any) => t.kind === "script" && mine(t));
        const vids = openVideos.filter(mine);
        const camps = campaigns.filter((k: any) => norm(k.clientName) === norm(c.name) ||
            c.aliases.some((a: any) => a.length > 2 && norm(k.campaignName).includes(a)));
        return {
            taskId: c.taskId,
            name: c.name,
            url: c.url,
            clientStatus: c.clientStatus,
            happiness: c.happiness,
            service: c.service,
            launchDate: c.launchDate,
            prelaunch: isPrelaunch(c.clientStatus),
            docs: {
                brandDna: c.brandDnaDoc,
                offerCheatSheet: c.offerCheatSheet,
                blueprintForm: c.blueprintFormLink,
                drive: c.driveLink ?? c.driveFolder,
                history: c.clientHistoryDoc,
                research: c.marketResearchDoc,
            },
            docsReady: Boolean(c.brandDnaDoc && c.offerCheatSheet),
            openScripts: scripts.length,
            openVideos: vids.length,
            /** Stages where the ball is his, not an editor's. */
            hisMove: vids.filter((x: any) => ["client review", "internal review", "update required"].includes((x.status || "").toLowerCase())).length,
            liveCampaigns: camps.length,
        };
    })
        .sort((a: any, b: any) => {
        if (a.prelaunch !== b.prelaunch)
            return a.prelaunch ? -1 : 1;
        return b.openScripts + b.hisMove - (a.openScripts + a.hisMove);
    });
    const toContact = rows.filter((r: any) => r.prelaunch);
    return {
        clients: rows,
        counts: {
            live: rows.length,
            toContact: toContact.length,
            docsMissing: rows.filter((r: any) => !r.docsReady).length,
        },
        toContact: toContact.map((r: any) => r.name),
        syncedAt: clients[0]?.syncedAt ?? null,
    };
}
const DAY = 86400000;
function touchpoint(client: {
    name: string;
    clientStatus?: string;
    launchDate?: number | null;
}, 
// biome-ignore lint/suspicious/noExplicitAny: table rows
tasks: any[], 
// biome-ignore lint/suspicious/noExplicitAny: table rows
videos: any[], 
// biome-ignore lint/suspicious/noExplicitAny: table rows
touches: any[]) {
    const now = Date.now();
    const last = touches[0]?.at ?? null;
    const daysSince = last ? Math.floor((now - last) / DAY) : null;
    const thisWeek = touches.filter((t: any) => now - t.at < 7 * DAY).length;
    const waiting = videos.filter((v2: any) => ["client review", "update required"].includes((v2.status || "").toLowerCase()));
    const inProduction = videos.filter((v2: any) => ["planning", "in progress", "internal review"].includes((v2.status || "").toLowerCase()));
    const openScripts = tasks.filter((t: any) => t.kind === "script" && isOpen(t.status));
    const reasons: string[] = [];
    if (waiting.length) {
        reasons.push(`${waiting.length} video${waiting.length > 1 ? "s" : ""} sitting in client review, their approval is the blocker`);
    }
    if (isPrelaunch(client.clientStatus)) {
        reasons.push(`Pre-launch (${client.clientStatus}), they need to know what is being built this week`);
    }
    if (inProduction.length) {
        reasons.push(`${inProduction.length} in production, worth a progress note`);
    }
    if (thisWeek < TOUCHPOINTS_PER_WEEK) {
        reasons.push(`${thisWeek} of ${TOUCHPOINTS_PER_WEEK} touchpoints this week, the creative floor is 1 to 2`);
    }
    const first = client.name.split(" ")[0];
    const drafts: {
        label: string;
        en: string;
        ar: string;
    }[] = [];
    if (waiting.length) {
        const names = waiting.map((v2: any) => v2.name).join(", ");
        drafts.push({
            label: "Chase an approval",
            en: `Hi ${first}, the cut is with you for review (${names}). Have a look when you get a minute and tell me what you want changed, no detail is too small. Once you approve it we can get it live.`,
            ar: `هلا ${first}، النسخة عندك للمراجعة (${names}). شوفها لما يناسبك وقول لي شنو تبي نعدل، ولا تستحي بأي تفصيلة صغيرة. أول ما توافق عليها ننزلها ونشغلها.`,
        });
    }
    if (inProduction.length) {
        drafts.push({
            label: "Progress note (a cookie)",
            en: `Hi ${first}, quick update from our side. We are ${inProduction.length > 1 ? "working on" : "working on"} ${inProduction.length} new piece${inProduction.length > 1 ? "s" : ""} for you this week, built off the offer and the angles we agreed in your brand session. I will send the first one over for your eyes before anything goes live.`,
            ar: `هلا ${first}، تحديث سريع من عندنا. نشتغل هالأسبوع على ${inProduction.length} مادة جديدة لك، مبنية على العرض والزوايا اللي اتفقنا عليها في جلسة الهوية. أول ما تخلص أول واحدة أرسلها لك تشوفها قبل ما ننزل أي شي.`,
        });
    }
    if (isPrelaunch(client.clientStatus)) {
        drafts.push({
            label: "Pre-launch check-in",
            en: `Hi ${first}, your brand direction and offer are locked in on our side. We are producing the first set of ads now. If you have any recent project photos or site videos, send them into the group, real footage from your own projects always outperforms anything else.`,
            ar: `هلا ${first}، اتجاه الهوية والعرض مثبتين عندنا. الحين نجهز أول مجموعة إعلانات. إذا عندك صور أو فيديوهات حديثة من مشاريعك، أرسلها في القروب، المواد الحقيقية من مشاريعك دايم تجيب نتيجة أقوى من أي شي غيرها.`,
        });
    }
    if (openScripts.length) {
        drafts.push({
            label: "Ask for the input a script needs",
            en: `Hi ${first}, I am writing the next script for you. One question so it lands right: which project are you most proud of finishing recently, and what did the client say when you handed it over? I want to build the ad around that.`,
            ar: `هلا ${first}، أكتب لك السكربت الجاي. سؤال واحد بس عشان يطلع صح: شنو أكثر مشروع تفتخر فيه خلصتوه مؤخراً، وشنو قال العميل يوم استلمه؟ أبي أبني الإعلان على هالشي.`,
        });
    }
    return {
        lastTouchAt: last,
        daysSince,
        thisWeek,
        owed: reasons.length > 0 &&
            (thisWeek < TOUCHPOINTS_PER_WEEK || waiting.length > 0),
        reasons,
        drafts,
    };
}
export async function buildDetail(ctx: QueryCtx, name: string, scope: Set<string> | null): Promise<any> {
    const client = (await ctx.db.query("clients").collect()).find((c: any) => c.name === name || norm(c.name) === norm(name));
    // Outside the person's client list reads the same as not on the board.
    if (!client || !inScope(scope, client.name))
        return null;
    const mine = (t: {
        clients?: string[];
        client?: string;
    }) => (t.clients ?? (t.client ? [t.client] : [])).some((n: any) => norm(n) === norm(client.name));
    const tasks = (await ctx.db.query("creativeTasks").collect()).filter(mine);
    const videos = (await ctx.db.query("videoJobs").collect()).filter(mine);
    const posts = (await ctx.db.query("contentPosts").collect()).filter(mine);
    const touches = (await ctx.db.query("touchLog").collect())
        .filter((t: any) => norm(t.client) === norm(client.name))
        .sort((a: any, b: any) => b.at - a.at);
    const campaigns = (await ctx.db.query("campaigns").collect()).filter((k: any) => norm(k.clientName) === norm(client.name) ||
        client.aliases.some((a: any) => a.length > 2 && norm(k.campaignName).includes(a)));
    const campaignNames = new Set(campaigns.map((k: any) => k.campaignName));
    const tree = (await ctx.db.query("metaTree").collect()).filter((n: any) => campaignNames.has(n.campaignName));
    const ads = (await ctx.db.query("ads").collect()).filter((a: any) => campaignNames.has(a.campaignName));
    const liveAds = tree.filter((n: any) => n.kind === "ad" &&
        (n.effectiveStatus || n.status || "").toUpperCase() === "ACTIVE");
    const accountOf = new Map(campaigns.map((k: any) => [k.campaignName, k.metaAccountId]));
    return {
        /**
         * This month off their own stat sheet. Aziz, 2026-09-08: cost per lead is
         * not enough, the writing has to be judged against what happens after the
         * lead. Rates are computed here so there is one definition of each:
         * booking rate is appointments against leads Meta reported in 30 days,
         * show rate is shows against the appointments that came due (their time
         * passed and someone marked the Show column; Aziz, 2026-09-18), quotation
         * rate is quotations against shows, close rate is closes against quotations.
         */
        stats: (() => {
            const s2 = client.stats;
            if (!s2)
                return null;
            const leads30 = ads.reduce((n: any, a: any) => n + a.leads, 0);
            const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 100) : null;
            const due = s2.due ?? s2.booked;
            return {
                month: s2.tab,
                booked: s2.booked,
                due,
                shows: s2.shows,
                quotes: s2.quotes,
                closes: s2.closes,
                leads30,
                bookingRate: pct(s2.booked, leads30),
                showRate: pct(s2.shows, due),
                quotationRate: pct(s2.quotes, s2.shows),
                closeRate: pct(s2.closes, s2.quotes),
                scannedAt: client.statsScannedAt ?? null,
            };
        })(),
        client: {
            name: client.name,
            url: client.url,
            clientStatus: client.clientStatus,
            happiness: client.happiness,
            service: client.service,
            launchDate: client.launchDate,
            phone: client.phone,
            dosDonts: client.dosDonts,
            updates: client.updates,
            docs: {
                brandDna: client.brandDnaDoc,
                offerCheatSheet: client.offerCheatSheet,
                blueprintForm: client.blueprintFormLink,
                drive: client.driveLink ?? client.driveFolder,
                sheet: client.sheetLink,
                history: client.clientHistoryDoc,
                research: client.marketResearchDoc,
            },
        },
        // Raw ClickUp status on every row. No derived stages. Newest first, so
        // "comment on their newest task" really is the newest.
        tasks: tasks
            .filter((t: any) => isOpen(t.status))
            .map((t: any) => ({
            taskId: t.taskId,
            name: t.name,
            kind: t.kind,
            status: t.status,
            url: t.url,
            createdAt: t.createdAt,
            dueDate: t.dueDate,
            assignees: t.assignees,
            otherClients: (t.clients ?? []).filter((n: any) => norm(n) !== norm(client.name)),
        }))
            .sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
        videos: videos.map((v2: any) => ({
            taskId: v2.taskId,
            name: v2.name,
            status: v2.status,
            url: v2.url,
            editors: v2.editors,
            dueDate: v2.dueDate,
            editedLink: v2.editedLink,
            rawLink: v2.rawLink,
            open: isOpen(v2.status),
        })),
        posts: posts.filter((p: any) => isOpen(p.status)).length,
        /** Everything we have ever made for them, closed rows included. */
        allTasks: tasks
            .map((t: any) => ({
            taskId: t.taskId,
            name: t.name,
            kind: t.kind,
            status: t.status,
            url: t.url,
            createdAt: t.createdAt,
            dueDate: t.dueDate,
            assignees: t.assignees,
            open: isOpen(t.status),
        }))
            .sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
        touch: touchpoint(client, tasks, videos, touches),
        /**
         * The service line to read winning ads from. The client board's Service
         * field is a package name ("DFY") on most records, so take the service
         * their own campaigns are tagged with and fall back to the field.
         */
        serviceLine: campaigns.map((k: any) => k.serviceType).find(Boolean) ?? client.service ?? null,
        campaigns: campaigns.map((k: any) => ({
            campaignName: k.campaignName,
            serviceType: k.serviceType,
            spend7d: k.spend7d,
            leads7d: k.leads7d,
            bookings7d: k.bookings7d,
            costPerBooking: k.costPerBooking,
            boardAdStatus: k.boardAdStatus,
        })),
        /**
         * What is running right now, and what has run before. No preview links:
         * the page shows the saved still and fetches a live preview on open.
         */
        liveNow: liveAds.map((n: any) => ({
            metaId: n.metaId,
            name: n.name,
            campaignName: n.campaignName,
            accountId: n.accountId ?? accountOf.get(n.campaignName),
            thumbUrl: n.thumbUrl,
            stillKey: n.stillKey,
            stillUrl: n.stillUrl,
            stillTinyUrl: n.stillTinyUrl,
        })),
        history: ads
            .map((a: any) => ({
            adName: a.adName,
            campaignName: a.campaignName,
            spend: a.spend,
            leads: a.leads,
            cpl: a.cpl,
            ctr: a.ctr,
            thumbnailUrl: a.thumbnailUrl,
            metaAdId: a.metaAdId,
            accountId: accountOf.get(a.campaignName),
            stillKey: a.stillKey,
            stillUrl: a.stillUrl,
            stillTinyUrl: a.stillTinyUrl,
        }))
            .sort((a: any, b: any) => b.spend - a.spend),
    };
}
function money(n?: number | null): string {
    return n === null || n === undefined
        ? "n/a"
        : `$${Math.round(n).toLocaleString()}`;
}
function dt(ts?: number | null): string {
    return ts ? new Date(ts).toISOString().slice(0, 10) : "no date";
}
const FATIGUE_FREQUENCY = 2.5;
const KUWAIT_OFFSET = 3 * 3600000;
export const TOUCHPOINTS_PER_WEEK = 2;
function dKey(ts: number): string {
    return new Date(ts + KUWAIT_OFFSET).toISOString().slice(0, 10);
}
const CAL_BACK = 7;
const CAL_FORWARD = 20;
export async function buildCalendar(ctx: QueryCtx, scope: Set<string> | null): Promise<any> {
    const now = Date.now();
    const today = dKey(now);
    const tasks = (await ctx.db.query("creativeTasks").collect()).filter((t: any) => rowInScope(scope, t));
    const videos = (await ctx.db.query("videoJobs").collect()).filter((j: any) => rowInScope(scope, j));
    const posts = (await ctx.db.query("contentPosts").collect()).filter((p: any) => inScope(scope, p.client));
    const clientRows = (await ctx.db.query("clients").collect()).filter((c: any) => inScope(scope, c.name));
    type Item = {
        id: string;
        day: string | null;
        client: string | null;
        kind: "script" | "video" | "post" | "brandDNA" | "onboarding";
        title: string;
        status: string;
        open: boolean;
        overdue: boolean;
        url?: string;
        taskId?: string;
        canSchedule: boolean;
        canComplete: boolean;
    };
    const items: Item[] = [];
    for (const t of tasks) {
        const kind = t.kind === "brandDNA"
            ? "brandDNA"
            : t.kind === "script"
                ? "script"
                : t.kind === "onboarding"
                    ? "onboarding"
                    : null;
        // Aziz, 2026-09-10: onboarding shows as the one parent task, never the
        // checklist of subtasks under it.
        if (!kind)
            continue;
        const open = isOpen(t.status);
        // Closed work with no date is history, not a plan. Keep it out.
        if (!open && !t.dueDate)
            continue;
        const day = t.dueDate ? dKey(t.dueDate) : null;
        items.push({
            id: `t-${t.taskId}`,
            day,
            client: t.client ?? null,
            kind: kind as Item["kind"],
            title: t.name,
            status: t.status,
            open,
            overdue: open && !!day && day < today,
            url: t.url,
            taskId: t.taskId,
            canSchedule: true,
            canComplete: open,
        });
    }
    for (const v2 of videos) {
        const open = isOpen(v2.status);
        if (!open && !v2.dueDate)
            continue;
        const day = v2.dueDate ? dKey(v2.dueDate) : null;
        items.push({
            id: `v-${v2.taskId}`,
            day,
            client: v2.client ?? null,
            kind: "video",
            title: v2.name,
            status: v2.status,
            open,
            overdue: open && !!day && day < today,
            url: v2.url,
            taskId: v2.taskId,
            canSchedule: true,
            canComplete: open,
        });
    }
    for (const p of posts) {
        if (!p.publishDate)
            continue;
        const day = dKey(p.publishDate);
        const open = isOpen(p.status);
        items.push({
            id: `p-${p.taskId}`,
            day,
            client: p.client ?? null,
            kind: "post",
            title: p.name,
            status: p.status,
            open,
            overdue: open && day < today,
            url: p.url,
            taskId: p.taskId,
            canSchedule: true,
            canComplete: false,
        });
    }
    // --- The grid -----------------------------------------------------------
    const start = new Date(now + KUWAIT_OFFSET);
    start.setUTCDate(start.getUTCDate() - CAL_BACK);
    const days: {
        day: string;
        label: string;
        weekday: string;
        isToday: boolean;
        isPast: boolean;
        isFriday: boolean;
        items: Item[];
    }[] = [];
    for (let i = 0; i <= CAL_BACK + CAL_FORWARD; i++) {
        const d = new Date(start);
        d.setUTCDate(d.getUTCDate() + i);
        const key = d.toISOString().slice(0, 10);
        days.push({
            day: key,
            label: d.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                timeZone: "UTC",
            }),
            weekday: d.toLocaleDateString("en-GB", {
                weekday: "short",
                timeZone: "UTC",
            }),
            isToday: key === today,
            isPast: key < today,
            // Friday is off in Kuwait, so nothing should be planned into it.
            isFriday: d.getUTCDay() === 5,
            items: items
                .filter((it: any) => it.day === key)
                .sort((a: any, b: any) => a.kind.localeCompare(b.kind)),
        });
    }
    // Anything overdue from before the window still has to be seen.
    const olderOverdue = items.filter((it: any) => it.overdue && it.day! < days[0].day);
    // --- Undated work -------------------------------------------------------
    const unplanned = items
        .filter((it: any) => it.open && !it.day)
        .sort((a: any, b: any) => (a.client ?? "").localeCompare(b.client ?? ""));
    // --- Proactive suggestions ---------------------------------------------
    // A live client with no open script work, or with creative burning out, is
    // a client nobody is writing for right now.
    const openScriptClients = new Set(items
        .filter((it: any) => it.open && (it.kind === "script" || it.kind === "video"))
        .map((it: any) => (it.client ?? "").toLowerCase()));
    // Ads carry no client of their own: the campaign is what maps an ad back
    // to a client, same join the rest of the cockpit uses.
    const campaigns = (await ctx.db.query("campaigns").collect()).filter((c: any) => inScope(scope, c.clientName ?? c.clientTag));
    const scopedCampaigns = new Set(campaigns.map((c: any) => c.campaignName));
    const ads = (await ctx.db.query("ads").collect()).filter((a: any) => !scope || scopedCampaigns.has(a.campaignName));
    const clientByCampaign = new Map(campaigns.map((c: any) => [c.campaignName, c.clientName ?? c.clientTag ?? null]));
    const burning = new Map<string, number>();
    for (const a of ads) {
        const owner = clientByCampaign.get(a.campaignName);
        if (!owner)
            continue;
        if ((a.frequency ?? 0) >= FATIGUE_FREQUENCY) {
            burning.set(owner, (burning.get(owner) ?? 0) + 1);
        }
    }
    const suggestions = clientRows
        .filter((c: any) => (c.clientStatus ?? "").toLowerCase() !== "cancelled")
        .map((c: any) => {
        const nothingPlanned = !openScriptClients.has(c.name.toLowerCase());
        const burn = burning.get(c.name) ?? 0;
        const why = burn
            ? `${burn} live creative past ${FATIGUE_FREQUENCY} frequency, they need a replacement`
            : nothingPlanned
                ? "nothing being written for them right now"
                : null;
        return why
            ? {
                client: c.name,
                why,
                priority: burn ? 1 : 2,
                driveScripts: c.driveScripts ?? null,
                driveFootage: c.driveFootage ?? null,
            }
            : null;
    })
        .filter(Boolean)
        .sort((a: any, b: any) => a!.priority - b!.priority)
        .slice(0, 12);
    return {
        today,
        days,
        olderOverdue,
        unplanned,
        suggestions,
        clients: clientRows
            .map((c: any) => ({
            name: c.name,
            driveFolder: c.driveLink ?? c.driveFolder ?? null,
            driveScripts: c.driveScripts ?? null,
            driveFootage: c.driveFootage ?? null,
            driveSubfolders: c.driveSubfolders ?? [],
        }))
            .sort((a: any, b: any) => a.name.localeCompare(b.name)),
        counts: {
            planned: items.filter((it: any) => it.open && it.day).length,
            unplanned: unplanned.length,
            overdue: items.filter((it: any) => it.overdue).length,
        },
    };
}
export async function buildScriptQueue(ctx: QueryCtx, scope: Set<string> | null): Promise<any> {
    // Only clients who are actually paying or actually about to launch belong
    // in a writing queue. Stopped, paused and "sales team to contact" rows are
    // not the creative director's problem, and putting them here would bury the
    // real work under 40 rows of noise. Statuses are verbatim ClickUp values.
    const LIVE = new Set(["active"]);
    const PRE_LAUNCH = new Set([
        "launch booked",
        "ready for launch",
        "onboarding booked",
    ]);
    const statusKey = (s2?: string | null) => (s2 ?? "")
        .toLowerCase()
        .replace(/[^a-z ]/g, "")
        .trim();
    const clientRows = (await ctx.db.query("clients").collect()).filter((c: any) => {
        const k = statusKey(c.clientStatus);
        return inScope(scope, c.name) && (LIVE.has(k) || PRE_LAUNCH.has(k));
    });
    const campaigns = await ctx.db.query("campaigns").collect();
    const ads = await ctx.db.query("ads").collect();
    const tree = await ctx.db.query("metaTree").collect();
    const funnels = await ctx.db.query("funnels").collect();
    const tasks = await ctx.db.query("creativeTasks").collect();
    const videos = await ctx.db.query("videoJobs").collect();
    const key = (s?: string | null) => (s ?? "").trim().toLowerCase();
    type Row = {
        client: string;
        type: "Ad creative" | "Landing page" | "Funnel questions" | "Follow up page" | "Launch scripts";
        why: string;
        evidence: string;
        priority: number;
        /**
         * Aziz, 2026-09-08: funnel questions, landing pages, follow up pages and
         * VSLs are not routine writing. We only switch a client onto them when
         * the funnel needs it. They stay out of the main list and sit behind
         * "only when it is needed" so the day stays about ads and launches.
         */
        optional?: boolean;
        href?: string;
        suggestedTitle: string;
    };
    const out: Row[] = [];
    for (const c of clientRows) {
        const mine = (t: {
            clients?: string[];
            client?: string;
        }) => (t.clients ?? (t.client ? [t.client] : [])).some((n: any) => key(n) === key(c.name));
        const myCampaigns = campaigns.filter((k: any) => key(k.clientName) === key(c.name) ||
            c.aliases.some((a: any) => a.length > 2 && key(k.campaignName).includes(a)));
        const names = new Set(myCampaigns.map((k: any) => k.campaignName));
        const myAds = ads.filter((a: any) => names.has(a.campaignName));
        const liveAdNames = new Set(tree
            .filter((n: any) => n.kind === "ad" &&
            names.has(n.campaignName) &&
            (n.effectiveStatus || n.status || "").toUpperCase() === "ACTIVE")
            .map((n: any) => n.name));
        const accounts = new Set(myCampaigns.map((k: any) => key(k.accountName)));
        const myFunnels = funnels.filter((f: any) => accounts.has(key(f.account)));
        const openScripts = tasks.filter((t: any) => mine(t) && t.kind === "script" && isOpen(t.status));
        const openVideos = videos.filter((t: any) => mine(t) && isOpen(t.status));
        const live = LIVE.has(statusKey(c.clientStatus));
        // 1. Creative burning out. The highest priority because the money is
        //    already being spent against an audience that has seen it enough.
        const burning = myAds.filter((a: any) => liveAdNames.has(a.adName) && (a.frequency ?? 0) >= FATIGUE_FREQUENCY);
        if (burning.length) {
            out.push({
                client: c.name,
                type: "Ad creative",
                why: "Live creative is burning out and needs a replacement ready",
                evidence: `${burning.length} live ad${burning.length === 1 ? "" : "s"} at or past ${FATIGUE_FREQUENCY} frequency: ${burning.map((a: any) => a.adName).join(", ")}`,
                priority: 1,
                suggestedTitle: "Replacement ad scripts",
            });
        }
        // 2. Paying, spending, and nothing is live.
        if (live && liveAdNames.size === 0 && myCampaigns.length > 0) {
            out.push({
                client: c.name,
                type: "Ad creative",
                why: "They have campaigns but nothing running, so there is nothing to optimise",
                evidence: `${myCampaigns.length} campaign${myCampaigns.length === 1 ? "" : "s"} on the board, 0 ads live right now`,
                priority: 1,
                suggestedTitle: "New ad scripts",
            });
        }
        // 3. The form filters nobody. This is the cheapest lever on lead quality
        //    there is, and it is writing, not media buying.
        for (const f of myFunnels) {
            if (f.kind === "Instant form" && f.gates === 0 && f.spend > 0) {
                out.push({
                    client: c.name,
                    type: "Funnel questions",
                    why: "Their lead form asks nothing that filters, so the setter gets everyone",
                    evidence: `${f.formName || "instant form"}: ${f.questions.length} question${f.questions.length === 1 ? "" : "s"}, none of them filtering, ${money0(f.spend)} spent in 30 days at ${money0(f.cpl)} per lead`,
                    priority: 3,
                    optional: true,
                    href: "/funnels",
                    suggestedTitle: "Qualifying questions for the lead form",
                });
            }
            // 4. The ad lands nowhere it can sell.
            if (f.kind === "Stays on the post" && f.spend > 0) {
                out.push({
                    client: c.name,
                    type: "Landing page",
                    why: "Money is going to an ad that sends people nowhere",
                    evidence: `${money0(f.spend)} in 30 days on ads with no destination to script`,
                    priority: 3,
                    optional: true,
                    href: "/funnels",
                    suggestedTitle: "Landing page copy",
                });
            }
            // 5. Opt in, then silence. Only ever a suggestion: Aziz, 2026-09-08, a
            //    client is switched onto a follow up page or a VSL when the funnel
            //    actually needs it, not as routine work.
            if (f.kind === "Instant form" && !f.followUpUrl && f.leads > 0) {
                out.push({
                    client: c.name,
                    type: "Follow up page",
                    why: "People opt in and get no follow up page or video, which is where show rate is won",
                    evidence: `${f.leads} leads in 30 days through ${f.formName || "the form"} with nothing after the opt in`,
                    priority: 4,
                    optional: true,
                    href: "/funnels",
                    suggestedTitle: "Thank you page and VSL script",
                });
            }
        }
        // 6. Onboarding clients with nothing written yet.
        const onboarding = PRE_LAUNCH.has(statusKey(c.clientStatus));
        if (onboarding && openScripts.length === 0 && myAds.length === 0) {
            out.push({
                client: c.name,
                type: "Launch scripts",
                why: "Not launched yet and no scripts written, so launch waits on writing",
                evidence: `Client status is ${c.clientStatus}, 0 script requests open, 0 ads ever run`,
                priority: 2,
                suggestedTitle: "Launch scripts",
            });
        }
        // 7. Live, paying, and nobody is writing anything for them at all.
        if (live && openScripts.length === 0 && openVideos.length === 0) {
            out.push({
                client: c.name,
                type: "Ad creative",
                why: "Active client with nothing being written or edited for them",
                evidence: "0 open script requests, 0 videos in the pipeline",
                priority: 3,
                suggestedTitle: "Fresh angles",
            });
        }
    }
    out.sort((a: any, b: any) => a.priority - b.priority || a.client.localeCompare(b.client));
    const main = out.filter((r: any) => !r.optional);
    const optional = out.filter((r: any) => r.optional);
    const byType: Record<string, number> = {};
    for (const r of main)
        byType[r.type] = (byType[r.type] ?? 0) + 1;
    return {
        rows: main,
        optional,
        byType,
        total: main.length,
        optionalTotal: optional.length,
    };
}
function money0(n?: number | null): string {
    return n === null || n === undefined ? "n/a" : `$${Math.round(n)}`;
}
type SaveFields = {
    origin?: string | null;
    autoFirstAt?: number | null;
    savedAt?: number | null;
    unsavedAt?: number | null;
};
export function isSaved(r: SaveFields): boolean {
    return (typeof r.savedAt === "number" &&
        !(typeof r.unsavedAt === "number" && r.unsavedAt >= r.savedAt));
}
export function isAuto(r: SaveFields): boolean {
    return r.origin !== "manual" || typeof r.autoFirstAt === "number";
}
export type Origin = "all" | "saved" | "auto";
type WinnerRow = SaveFields & {
    [key:string]:any;
    adId: string;
    savedBy?: string | null;
    cpl?: number | null;
    _creationTime?: number;
};
function onePerAd<T extends WinnerRow>(rows: T[]): T[] {
    const byAd = new Map<string, T[]>();
    for (const r of rows) {
        const list = byAd.get(String(r.adId)) ?? [];
        list.push(r);
        byAd.set(String(r.adId), list);
    }
    return [...byAd.values()].map((list: any) => {
        const saved = list
            .filter((r: any) => isSaved(r))
            .sort((a: any, b: any) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
        if (saved[0])
            return saved[0];
        // The primary row: the newest save, even a removed one, else the oldest.
        const marked = list
            .filter((r: any) => typeof r.savedAt === "number")
            .sort((a: any, b: any) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
        return (marked[0] ??
            [...list].sort((a: any, b: any) => (a._creationTime ?? 0) - (b._creationTime ?? 0))[0]);
    });
}
export function orderWinners<T extends WinnerRow>(rows: T[], opts: {
    origin?: Origin;
    savedBy?: string;
    limit?: number;
    keep?: (r: T) => boolean;
}): T[] {
    const origin = opts.origin ?? "all";
    const who = (opts.savedBy ?? "").trim().toLowerCase();
    const shown = onePerAd(rows.filter((r: any) => (isSaved(r) || isAuto(r)) && (!opts.keep || opts.keep(r)))).filter((r: any) => {
        if (origin === "saved" && !isSaved(r))
            return false;
        if (origin === "auto" && !isAuto(r))
            return false;
        if (who && !(isSaved(r) && (r.savedBy ?? "").toLowerCase() === who))
            return false;
        return true;
    });
    const limit = Math.max(0, Math.floor(opts.limit ?? 40));
    const cplOf = (r: T) => typeof r.cpl === "number" ? r.cpl : Number.POSITIVE_INFINITY;
    const byCpl = (a: T, b: T) => cplOf(a) - cplOf(b);
    if (origin === "auto")
        return shown.sort(byCpl).slice(0, limit);
    const saved = shown
        .filter((r: any) => isSaved(r))
        .sort((a: any, b: any) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    const rest = shown
        .filter((r: any) => !isSaved(r))
        .sort(byCpl)
        .slice(0, Math.max(0, limit - saved.length));
    return [...saved, ...rest];
}
type Row = {
    account: string;
    kind: string;
    url?: string;
    formName?: string;
    headline?: string;
    followUpUrl?: string;
    formId?: string;
    formStatus?: string;
    leadsAllTime?: number;
    questions: {
        label: string;
        type: string;
        options: string[];
        isGate: boolean;
    }[];
    gates: number;
    spend: number;
    leads: number;
    cpl?: number;
    ads: {
        adId: string;
        adName: string;
        status: string;
    }[];
};
const GENERIC = new Set([
    "ad",
    "ads",
    "account",
    "acount",
    "company",
    "co",
    "group",
    "llc",
    "wll",
    "est",
    "the",
    "for",
    "and",
    "general",
    "trading",
    "projects",
    "project",
    "construction",
    "constructions",
    "contracting",
    "contractors",
    "engineering",
    "consultant",
    "consultants",
    "consulting",
    "design",
    "designs",
    "interior",
    "interiors",
    "decor",
    "usd",
    "kw",
    "ksa",
    "uae",
    "limited",
    "finishing",
    "buildings",
    "building",
    "industries",
    "industry",
    "mahara",
    "maharamedia",
    "\u0634\u0631\u0643\u0629",
    "\u0644\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a",
    "\u0645\u0642\u0627\u0648\u0644\u0627\u062a",
    "\u0644\u0644\u062a\u0634\u064a\u062f",
]);
function words(x: string): string[] {
    return norm(x)
        .split(" ")
        .filter((w: any) => w.length >= 4 && !GENERIC.has(w));
}
function matches(account: string, aliases: string[]): boolean {
    const a = norm(account);
    if (!a)
        return false;
    if (aliases.some((alias: any) => {
        const b = norm(alias);
        return b.length >= 4 && (a.includes(b) || b.includes(a));
    })) {
        return true;
    }
    const accWords = new Set(words(account));
    return aliases.some((alias: any) => words(alias).some((w: any) => accWords.has(w)));
}
export async function buildFunnels(ctx: QueryCtx, client: string | undefined, scope: Set<string> | null) {
    let all = (await ctx.db.query("funnels").collect()) as unknown as (Row & {
        syncedAt: number;
    })[];
    // Ad accounts carry no client of their own: with a client list from the
    // portal, keep only the accounts that match one of those clients.
    if (scope) {
        const mine = (await ctx.db.query("clients").collect()).filter((c: any) => inScope(scope, c.name));
        all = all.filter((r: any) => mine.some((c: any) => matches(r.account, [c.name, ...c.aliases])));
    }
    let rows = all;
    if (client) {
        const c = await ctx.db
            .query("clients")
            .withIndex("by_name", (q: any) => q.eq("name", client))
            .first();
        const aliases = c ? [c.name, ...c.aliases] : [client];
        rows = all.filter((r: any) => matches(r.account, aliases));
    }
    // Cost by how many filtering questions the form asks. This is the honest
    // version of "does adding questions improve lead quality": we can only see
    // volume and cost per lead here, so the number is labelled as that and not
    // dressed up as a quality score.
    const buckets = new Map<string, {
        spend: number;
        leads: number;
        forms: number;
    }>();
    for (const r of all) {
        if (r.kind !== "Instant form")
            continue;
        const key = r.gates >= 3 ? "3+" : String(r.gates);
        const b = buckets.get(key) || { spend: 0, leads: 0, forms: 0 };
        b.spend += r.spend;
        b.leads += r.leads;
        b.forms += 1;
        buckets.set(key, b);
    }
    const byGates = [...buckets.entries()]
        .map(([gates, b]: any) => ({
        gates,
        forms: b.forms,
        spend: Math.round(b.spend),
        leads: b.leads,
        cpl: b.leads ? Math.round((b.spend / b.leads) * 100) / 100 : null,
    }))
        .sort((a: any, b: any) => a.gates.localeCompare(b.gates));
    // Every filtering question anyone is asking, with where it is used, so a
    // new form starts from what is already live rather than from scratch.
    const bank = new Map<string, {
        label: string;
        options: string[];
        accounts: string[];
        leads: number;
        spend: number;
    }>();
    for (const r of all) {
        for (const q of r.questions) {
            if (!q.isGate)
                continue;
            const key = norm(q.label);
            const e = bank.get(key) || {
                label: q.label,
                options: q.options,
                accounts: [],
                leads: 0,
                spend: 0,
            };
            if (!e.accounts.includes(r.account))
                e.accounts.push(r.account);
            if (q.options.length > e.options.length)
                e.options = q.options;
            e.leads += r.leads;
            e.spend += r.spend;
            bank.set(key, e);
        }
    }
    const questionBank = [...bank.values()]
        .map((e: any) => ({
        ...e,
        cpl: e.leads ? Math.round((e.spend / e.leads) * 100) / 100 : null,
        spend: Math.round(e.spend),
    }))
        .sort((a: any, b: any) => b.accounts.length - a.accounts.length || b.leads - a.leads);
    return {
        rows: [...rows].sort((a: any, b: any) => b.spend - a.spend),
        byGates,
        questionBank,
        counts: {
            destinations: rows.length,
            accounts: new Set(all.map((r: any) => r.account)).size,
            forms: all.filter((r: any) => r.kind === "Instant form").length,
            noGate: all.filter((r: any) => r.kind === "Instant form" && r.gates === 0)
                .length,
        },
        syncedAt: all[0]?.syncedAt,
    };
}
const FINISHED = new Set(["complete", "closed", "done", "live 🚀"]);
export const buildContextPack = async (ctx: any, { name }: any) => {
    const scope: Set<string> | null = null;
    const client = (await ctx.db.query("clients").collect()).find((c: any) => c.name === name || norm(c.name) === norm(name));
    if (!client || !inScope(scope, client.name))
        return null;
    const mine = (t: {
        clients?: string[];
        client?: string;
    }) => (t.clients ?? (t.client ? [t.client] : [])).some((n: any) => norm(n) === norm(client.name));
    const tasks = (await ctx.db.query("creativeTasks").collect()).filter(mine);
    const videos = (await ctx.db.query("videoJobs").collect()).filter(mine);
    const campaigns = (await ctx.db.query("campaigns").collect()).filter((k: any) => norm(k.clientName) === norm(client.name) ||
        client.aliases.some((a: any) => a.length > 2 && norm(k.campaignName).includes(a)));
    const campaignNames = new Set(campaigns.map((k: any) => k.campaignName));
    const ads = (await ctx.db.query("ads").collect())
        .filter((a: any) => campaignNames.has(a.campaignName))
        .sort((a: any, b: any) => b.spend - a.spend);
    const tree = (await ctx.db.query("metaTree").collect()).filter((n: any) => campaignNames.has(n.campaignName));
    // The rows What works shows for them, one per ad: the team's saves
    // first, newest first, then the weekly check's winners by cost per lead.
    const clientWinners = (await ctx.db.query("winnersArchive").collect()).filter((w: any) => norm(w.client) === norm(client.name));
    const winners = orderWinners(clientWinners, {
        limit: clientWinners.length,
    });
    const plays = (await ctx.db.query("marketPlays").collect())
        .filter((p: any) => norm(p.client) === norm(client.name))
        .sort((a: any, b: any) => (a.cpl ?? 1e9) - (b.cpl ?? 1e9));
    const accountNames = new Set(campaigns.map((k: any) => norm(k.accountName)));
    const funnels = (await ctx.db.query("funnels").collect()).filter((f: any) => accountNames.has(norm(f.account)));
    const touches = (await ctx.db.query("touchLog").collect())
        .filter((t: any) => norm(t.client) === norm(client.name))
        .sort((a: any, b: any) => b.at - a.at)
        .slice(0, 15);
    const serviceLine = campaigns.map((k: any) => k.serviceType).find(Boolean) ?? client.service ?? null;
    const city = plays.map((p: any) => p.city).find(Boolean) ??
        winners.map((w: any) => w.city).find(Boolean) ??
        null;
    const country = plays.map((p: any) => p.country).find(Boolean) ?? null;
    const L: string[] = [];
    const h = (t: string) => L.push("", `## ${t}`, "");
    const line = (k: string, v2?: string | number | null) => L.push(`- ${k}: ${v2 === null || v2 === undefined || v2 === "" ? "not on file" : v2}`);
    L.push(`# ${client.name}, full client context`);
    L.push("");
    L.push(`Pulled from the creative cockpit on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Every number here comes from ClickUp and Meta, nothing is estimated.`);
    h("Who they are");
    line("Client status (verbatim from ClickUp)", client.clientStatus);
    line("Service line", serviceLine);
    line("Package on the client board", client.service);
    line("Launch date", client.launchDate ? dt(client.launchDate) : null);
    line("Phone", client.phone);
    line("City", city);
    line("Country", country);
    line("Happiness", client.happiness);
    line("Client board record", client.url);
    h("Their documents");
    L.push("These are links. The text lives in Google Docs and Drive, so open them for the actual content.", "");
    line("Brand DNA", client.brandDnaDoc);
    line("Offer cheat sheet", client.offerCheatSheet);
    line("Brand blueprint form", client.blueprintFormLink);
    line("Market research", client.marketResearchDoc);
    line("Client history", client.clientHistoryDoc);
    line("Drive folder", client.driveLink ?? client.driveFolder);
    line("Scripts folder", client.driveScripts);
    line("Footage folder", client.driveFootage);
    line("Reporting sheet", client.sheetLink);
    h("Their funnel and lead form");
    if (funnels.length === 0) {
        L.push("No funnel or lead form found on their ad account.");
    }
    for (const f of funnels) {
        L.push(`### ${f.formName || f.url || f.kind}`);
        line("Type", f.kind);
        line("Destination", f.url);
        line("Headline", f.headline);
        line("30 day spend", money(f.spend));
        line("30 day leads", f.leads);
        line("Cost per lead", money(f.cpl));
        if (f.questions.length) {
            L.push("", "Questions asked, in order:");
            f.questions.forEach((q: any, i: any) => {
                L.push(`${i + 1}. ${q.label}${q.isGate ? " (filters lead quality)" : ""}${q.options.length ? ` — options: ${q.options.join(" / ")}` : ""}`);
            });
        }
        else {
            L.push("", "This form asks nothing that filters lead quality.");
        }
        L.push("");
    }
    h("Their performance");
    if (campaigns.length === 0)
        L.push("No campaigns matched to them.");
    for (const k of campaigns) {
        L.push(`### ${k.campaignName}`);
        line("Service", k.serviceType);
        line("7 day spend", money(k.spend7d));
        line("7 day leads", k.leads7d);
        line("7 day booked calls", k.bookings7d);
        line("Cost per booked call", money(k.costPerBooking));
        line("Status on the ads board", k.boardAdStatus);
        L.push("");
    }
    h("Every ad they have run");
    L.push("Sorted by spend. Cost per lead is what Meta reports, it says nothing about whether the lead was qualified.", "");
    const liveIds = new Set(tree
        .filter((n: any) => n.kind === "ad" &&
        (n.effectiveStatus || n.status || "").toUpperCase() === "ACTIVE")
        .map((n: any) => n.name));
    for (const a of ads) {
        L.push(`- ${liveIds.has(a.adName) ? "LIVE NOW" : "not live"} · ${a.adName} · ${a.campaignName} · spend ${money(a.spend)} · ${a.leads} leads · CPL ${money(a.cpl)} · CTR ${a.ctr ? `${a.ctr.toFixed(2)}%` : "n/a"}${a.metaAdId ? ` · Meta ad id ${a.metaAdId}` : ""}`);
    }
    if (ads.length === 0)
        L.push("Nothing on file.");
    h("The copy and transcripts we captured");
    if (winners.length === 0) {
        L.push("No ad of theirs has been captured into the winners archive yet, so we hold no transcript for them.");
    }
    for (const w of winners) {
        L.push(`### ${w.adName}`);
        if (isSaved(w)) {
            const who = w.savedByName || w.savedBy || "the team";
            L.push(w.savedNote ? `Saved by ${who}: ${w.savedNote}` : `Saved by ${who}`, "");
            if (w.savedStats) {
                const r = w.savedRange;
                const range = r
                    ? (r.label ?? `${r.start} to ${r.end}`)
                    : "when saved";
                line("Numbers when saved", `${range}: ${money(w.savedStats.spend)} spent, ${w.savedStats.leads} leads, ${money(w.savedStats.cpl)} a lead`);
            }
        }
        line("Format", w.format);
        line("Language", w.language);
        line("Hook", w.hook);
        line("Headline", w.headline);
        line("Call to action", w.cta);
        line("Spend", money(w.spend));
        line("Leads", w.leads);
        line("Cost per lead", money(w.cpl));
        line("Still live", w.stillLive ? "yes" : "no");
        if (w.body)
            L.push("", "Body copy:", "", w.body);
        if (w.transcript)
            L.push("", "Transcript:", "", w.transcript);
        L.push("");
    }
    h("The targeting that worked for them");
    if (plays.length === 0)
        L.push("No ad sets on file.");
    for (const p of plays.slice(0, 20)) {
        L.push(`- ${p.adsetName} · ${p.playType} · ${p.city ?? "no city"} · spend ${money(p.spend)} · ${p.leads} leads · CPL ${money(p.cpl)}${p.interests.length ? ` · interests: ${p.interests.join(", ")}` : ""}`);
    }
    h("Everything we have made for them");
    const all = [...tasks]
        .sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .map((t: any) => `- [${t.kind}] ${t.name} · status ${t.status} · created ${dt(t.createdAt)} · due ${dt(t.dueDate)}${t.url ? ` · ${t.url}` : ""}`);
    L.push(...(all.length ? all : ["Nothing on the creative board."]));
    L.push("", "Videos:", "");
    const vids = videos
        .sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .map((v2: any) => `- ${v2.name} · status ${v2.status} · due ${dt(v2.dueDate)}${v2.editedLink ? ` · edited ${v2.editedLink}` : ""}${v2.rawLink ? ` · raw ${v2.rawLink}` : ""}`);
    L.push(...(vids.length ? vids : ["Nothing in the video pipeline."]));
    h("Recent contact with them");
    if (touches.length === 0)
        L.push("No touchpoints logged yet.");
    for (const t of touches) {
        L.push(`- ${dt(t.at)} · ${t.note ?? "touchpoint logged"}`);
    }
    return {
        client: client.name,
        markdown: L.join("\n"),
        counts: {
            ads: ads.length,
            campaigns: campaigns.length,
            transcripts: winners.filter((w: any) => w.transcript).length,
            tasks: tasks.length,
            videos: videos.length,
            funnels: funnels.length,
            plays: plays.length,
        },
    };
};
export const buildScripts = async (ctx: any, { limit }: any) => {
    const scope: Set<string> | null = null;
    const cap = Math.max(1, Math.min(500, limit ?? 300));
    const tasks = await ctx.db.query("creativeTasks").collect();
    const drive = new Map<string, string | undefined>();
    for (const c of await ctx.db.query("clients").collect()) {
        drive.set(c.name, c.driveLink ?? c.driveFolder ?? undefined);
    }
    const rows = tasks
        .filter((t: any) => t.kind === "script" &&
        !t.parentId &&
        FINISHED.has((t.status ?? "").toLowerCase()) &&
        rowInScope(scope, t))
        .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, cap)
        .map((t: any) => ({
        taskId: t.taskId,
        name: t.name,
        url: t.url,
        status: t.status,
        client: t.client ?? null,
        otherClients: (t.clients ?? []).filter((n: any) => n !== t.client),
        assignees: t.assignees,
        dueDate: t.dueDate ?? null,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        script: t.script ?? "",
        drive: t.client ? (drive.get(t.client) ?? null) : null,
    }));
    const clients = [
        ...new Set(rows.map((r: any) => r.client).filter((c: any): c is string => !!c)),
    ].sort((a: any, b: any) => a.localeCompare(b));
    return { rows, clients };
};

const SCRIPT_STALE_DAYS = 3;
const WINNER_CPL = 15;
const WINNER_MIN_SPEND = 100;
export function dayKey(now: number): string {
    return new Date(now + KUWAIT_OFFSET).toISOString().slice(0, 10);
}
const CHECKLIST: {
    key: string;
    label: string;
    detail?: string;
    phase: "sod" | "mid";
    href?: string;
}[] = [
    {
        key: "clickup_comments",
        label: "Clear ClickUp comments on the creative board",
        detail: "Anything a client or the media buyer asked you yesterday.",
        phase: "sod",
        href: "/tasks",
    },
    {
        key: "whatsapp_sprint",
        label: "WhatsApp sprint",
        detail: "Client groups — answer anything creative-related.",
        phase: "sod",
    },
    {
        key: "slack_sprint",
        label: "Slack sprint",
        detail: "Editors, media buyer, CSM.",
        phase: "sod",
    },
    {
        key: "editors_standup",
        label: "Check where every editor is",
        detail: "Anything overdue gets chased before you start your own work.",
        phase: "sod",
        href: "/editors",
    },
    {
        key: "brand_dna",
        label: "Move the oldest Brand DNA forward",
        detail: "Nothing else can be produced for a client until this is locked.",
        phase: "mid",
        href: "/tasks",
    },
    {
        key: "scripts",
        label: "Write the scripts that are due",
        detail: "Oldest first. Anything past 3 days is blocking a launch.",
        phase: "mid",
        href: "/tasks",
    },
    {
        key: "replace_fatigued",
        label: "Replace the creatives that are burning out",
        detail: "Frequency over the gate means the audience has seen it enough.",
        phase: "mid",
        href: "/what-works",
    },
    {
        key: "social_calendar",
        label: "Plan next week's scripts on the calendar",
        detail: "A paying client with nothing being written for them is a churn risk.",
        phase: "mid",
        href: "/work",
    },
    {
        key: "touchpoints",
        label: "Client touchpoints",
        detail: "Use the client communication SOP.",
        phase: "mid",
        href: "/touchpoints",
    },
];
const VIDEO_STAGES = [
    "new video request",
    "planning",
    "in progress",
    "internal review",
    "client review",
    "update required",
    "on hold",
    "live 🚀",
];
const HIS_MOVE = new Set([
    "client review",
    "internal review",
    "update required",
]);
const BLUEPRINT_FORM_LIVE = Date.UTC(2026, 8, 5);
export async function buildSnapshot(ctx: QueryCtx, scope: Set<string> | null): Promise<any> {
    const now = Date.now();
    const tasks = (await ctx.db.query("creativeTasks").collect()).filter((t: any) => rowInScope(scope, t));
    const videos = (await ctx.db.query("videoJobs").collect()).filter((j: any) => rowInScope(scope, j));
    const posts = (await ctx.db.query("contentPosts").collect()).filter((p: any) => inScope(scope, p.client));
    const openTasks = tasks.filter((t: any) => isOpen(t.status));
    // The client board is the judge of whether a Brand DNA actually exists.
    // Aziz, 2026-09-07: "we already made the brand dna". Most of these ClickUp
    // tasks are stale rows left open after the doc was written, so an open task
    // on its own is not work. A task with no doc on the client record is.
    const clientBoard = (await ctx.db.query("clients").collect()).filter((c: any) => inScope(scope, c.name));
    /**
     * Task titles and board names never match exactly ("Castello industries
     * w.l.l" against "Castello Industries", "Alkhalil Group" against
     * "Alkhalil"), so match on the aliases the sync already computed and fall
     * back to a containment test both ways. Unicode-safe, because half the
     * roster is Arabic.
     */
    const nrm = (x?: string) => (x || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    function docsFor(raw: string): {
        brand?: string;
        offer?: string;
        matchedTo?: string;
        onboardedAt?: number;
        offerStatus?: string;
    } | undefined {
        const key = nrm(raw);
        if (!key)
            return undefined;
        const hit = clientBoard.find((c: any) => nrm(c.name) === key) ??
            clientBoard.find((c: any) => (c.aliases ?? []).some((a: any) => a.length > 2 && key.includes(nrm(a)))) ??
            clientBoard.find((c: any) => {
                const n = nrm(c.name);
                return n.length > 4 && (key.includes(n) || n.includes(key));
            });
        return hit
            ? {
                brand: hit.brandDnaDoc,
                offer: hit.offerCheatSheet,
                matchedTo: hit.name,
                onboardedAt: hit.onboardingCallDate ?? hit.launchDate,
                offerStatus: hit.offerCreationStatus,
            }
            : undefined;
    }
    // --- Client creative journeys -------------------------------------------
    // The six-step onboarding sequence lives as subtasks under a "<Client> -
    // Creative Onboarding" parent. Show where each client actually stands,
    // because "6 tasks to do" tells him nothing about which client is waiting.
    const parents = tasks.filter((t: any) => t.kind === "onboarding" && !t.parentId);
    const journeys = parents.map((p: any) => {
        const steps = tasks
            .filter((t: any) => t.parentId === p.taskId)
            .sort((a: any, b: any) => a.name.localeCompare(b.name));
        const done = steps.filter((s: any) => !isOpen(s.status)).length;
        const current = steps.find((s: any) => isOpen(s.status));
        return {
            taskId: p.taskId,
            url: p.url,
            client: p.client ?? p.name,
            status: p.status,
            done,
            total: steps.length,
            currentStep: current?.name ?? null,
            currentStepUrl: current?.url ?? null,
            ageDays: Math.floor((now - p.createdAt) / DAY),
            steps: steps.map((s: any) => ({
                name: s.name,
                status: s.status,
                open: isOpen(s.status),
                url: s.url,
            })),
        };
    });
    /**
     * The offer sign-off lives on the creative board, not the client board.
     * Aziz, 2026-09-08: "offer cheat sheet finished should also be on the
     * creative board, not as done." That is step 3 of the creative onboarding
     * checklist, "3 · Lock The Brand DNA And The Offer": while that subtask is
     * open the offer is not finished, whatever the cheat sheet link or the
     * client-board dropdown says.
     */
    const offerStepByClient = new Map<string, {
        open: boolean;
        status: string;
        url?: string;
    }>();
    for (const j of journeys) {
        const step = j.steps.find((st: any) => /offer/i.test(st.name));
        if (!step)
            continue;
        offerStepByClient.set(nrm(j.client), {
            open: step.open,
            status: step.status,
            url: step.url,
        });
    }
    // --- Brand DNA queue ----------------------------------------------------
    // Every client needs this locked before anything else can be produced, so
    // it is the true front of the creative queue.
    const brandRaw = openTasks.filter((t: any) => t.kind === "brandDNA" && !t.parentId);
    const seen = new Map<string, number>();
    for (const t of brandRaw) {
        const key = (t.client ?? t.name).toLowerCase().trim();
        seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const brandDNA = brandRaw
        .map((t: any) => {
        const key = (t.client ?? t.name).toLowerCase().trim();
        const docs = docsFor(t.client ?? t.name);
        return {
            taskId: t.taskId,
            url: t.url,
            client: t.client ?? t.name,
            status: t.status,
            ageDays: Math.floor((now - t.createdAt) / DAY),
            duplicate: (seen.get(key) ?? 0) > 1,
            /**
             * A link on the client row only means the template was generated,
             * usually automatically, with whatever the AI could find. It is not
             * a finished Brand DNA. The open task is the truth, so this is shown
             * as a starting point to open, never as proof of completion.
             * [aziz, 2026-09-08]
             */
            docOnFile: Boolean(docs?.brand),
            matchedTo: docs?.matchedTo ?? null,
            docUrl: docs?.brand ?? null,
            offerOnFile: Boolean(docs?.offer),
            offerStatus: docs?.offerStatus ?? null,
        };
    })
        // Oldest first. Every open row is real work, whether or not a draft doc
        // already exists.
        .sort((a: any, b: any) => b.ageDays - a.ageDays);
    const brandDnaReal = brandDNA.length;
    // --- Script requests ----------------------------------------------------
    // These come in with no client on them at all, which is the single biggest
    // reason work sits here: nobody can tell whose it is or what it blocks.
    const scripts = openTasks
        .filter((t: any) => t.kind === "script")
        .map((t: any) => ({
        taskId: t.taskId,
        url: t.url,
        status: t.status,
        client: t.client,
        notes: t.notes,
        dueDate: t.dueDate,
        ageDays: Math.floor((now - t.createdAt) / DAY),
        unidentified: !t.client && !t.notes,
    }))
        .sort((a: any, b: any) => b.ageDays - a.ageDays);
    // --- Editors / video pipeline -------------------------------------------
    const openVideos = videos.filter((v2: any) => isOpen(v2.status));
    const byEditor = new Map<string, {
        editor: string;
        open: number;
        overdue: number;
        nextDue: number | null;
    }>();
    for (const job of openVideos) {
        const names = job.editors.length ? job.editors : ["Unassigned"];
        for (const name of names) {
            const row = byEditor.get(name) ?? {
                editor: name,
                open: 0,
                overdue: 0,
                nextDue: null,
            };
            row.open += 1;
            if (job.dueDate && job.dueDate < now)
                row.overdue += 1;
            if (job.dueDate && (row.nextDue === null || job.dueDate < row.nextDue)) {
                row.nextDue = job.dueDate;
            }
            byEditor.set(name, row);
        }
    }
    const editors = [...byEditor.values()].sort((a: any, b: any) => b.overdue - a.overdue);
    const videoJobs = openVideos
        .map((j: any) => ({
        taskId: j.taskId,
        url: j.url,
        name: j.name,
        client: j.client,
        status: j.status,
        editors: j.editors,
        dueDate: j.dueDate,
        overdueDays: j.dueDate && j.dueDate < now ? Math.floor((now - j.dueDate) / DAY) : 0,
        editedLink: j.editedLink,
        /** Unnamed jobs cannot be chased: nobody knows which client they serve. */
        unidentified: /^(new|edit) video request/i.test(j.name.trim()),
        stage: j.status.toLowerCase(),
        stageIndex: VIDEO_STAGES.indexOf(j.status.toLowerCase()),
        /** True when he is the blocker, not an editor and not the client. */
        hisMove: HIS_MOVE.has(j.status.toLowerCase()),
    }))
        .sort((a: any, b: any) => b.overdueDays - a.overdueDays);
    // --- Social calendar ----------------------------------------------------
    // Coverage is the question that matters: which clients have nothing
    // scheduled from here on. A client paying for social with an empty
    // calendar is a churn risk long before they complain.
    const upcoming = posts.filter((p: any) => isOpen(p.status) && p.publishDate && p.publishDate >= now - DAY);
    const clientsWithPlan = new Set(upcoming.map((p: any) => (p.client ?? "").toLowerCase()).filter(Boolean));
    const allSocialClients = new Set(posts.map((p: any) => (p.client ?? "").toLowerCase()).filter(Boolean));
    const uncovered = [...allSocialClients]
        .filter((c: any) => !clientsWithPlan.has(c))
        .map((c: any) => {
        const any = posts.find((p: any) => (p.client ?? "").toLowerCase() === c);
        const dates = posts
            .filter((p: any) => (p.client ?? "").toLowerCase() === c && p.publishDate)
            .map((p: any) => p.publishDate as number);
        return {
            client: any?.client ?? c,
            lastPlanned: dates.length ? Math.max(...dates) : null,
        };
    });
    const overduePosts = posts
        .filter((p: any) => isOpen(p.status) && p.publishDate && p.publishDate < now)
        .map((p: any) => ({
        taskId: p.taskId,
        url: p.url,
        name: p.name,
        client: p.client,
        status: p.status,
        publishDate: p.publishDate,
        lateDays: Math.floor((now - (p.publishDate as number)) / DAY),
    }))
        .sort((a: any, b: any) => b.lateDays - a.lateDays);
    // --- Creative performance ----------------------------------------------
    // What he actually needs from the ad account: what to replace, and what to
    // make more of. Joined from the media buyer's synced ad rows.
    const campaigns = (await ctx.db.query("campaigns").collect()).filter((c: any) => inScope(scope, c.clientName ?? c.accountName));
    const scopedCampaigns = new Set(campaigns.map((c: any) => c.campaignName));
    // Ads carry no client of their own: the campaign is the join.
    const ads = (await ctx.db.query("ads").collect()).filter((a: any) => !scope || scopedCampaigns.has(a.campaignName));
    const clientOf = new Map(campaigns.map((c: any) => [c.campaignName, c.clientName ?? c.accountName]));
    // Frequency watch. Showing an empty "fatiguing" box would be useless, so
    // this is the leaderboard with the gate marked: he can see what is
    // trending towards burnout before it crosses.
    const withFreq = ads.filter((a: any) => a.frequency !== undefined && a.spend > 0);
    const fatiguing = withFreq
        .map((a: any) => ({
        adName: a.adName,
        client: clientOf.get(a.campaignName) ?? a.campaignName,
        frequency: a.frequency ?? 0,
        cpl: a.cpl,
        spend: a.spend,
        burning: (a.frequency ?? 0) >= FATIGUE_FREQUENCY,
    }))
        .sort((a: any, b: any) => b.frequency - a.frequency)
        .slice(0, 8);
    const winners = ads
        .filter((a: any) => a.spend >= WINNER_MIN_SPEND &&
        a.cpl !== undefined &&
        a.cpl <= WINNER_CPL &&
        a.leads > 0)
        .map((a: any) => ({
        adName: a.adName,
        client: clientOf.get(a.campaignName) ?? a.campaignName,
        cpl: a.cpl ?? 0,
        leads: a.leads,
        spend: a.spend,
    }))
        .sort((a: any, b: any) => a.cpl - b.cpl)
        .slice(0, 12);
    // --- Client profiles ----------------------------------------------------
    // The creative view of one client, the way the CSM screen does it: where
    // their branding stands, what is written, what is being edited, what is
    // late, and how their creative is actually performing. Built from every
    // source at once so he never has to open four boards to answer "how is
    // this client doing".
    const clientKeys = new Map<string, string>();
    const remember = (raw?: string | null) => {
        const name = (raw ?? "").trim();
        if (!name)
            return;
        const k = name.toLowerCase();
        if (!clientKeys.has(k))
            clientKeys.set(k, name);
    };
    for (const t of tasks)
        remember(t.client);
    for (const j of videos)
        remember(j.client);
    for (const pp of posts)
        remember(pp.client);
    for (const c of campaigns)
        remember(c.clientName ?? c.accountName);
    const blueprintRows = (await ctx.db.query("blueprints").collect()).filter((b: any) => inScope(scope, b.client));
    // The Typeform read is not ported yet (HOSTING.md, "still pending"), so an
    // empty table means "not tracked", not "nobody submitted". Only score the
    // form once rows exist; until then it is neither open nor done.
    const blueprintsTracked = blueprintRows.length > 0;
    const blueprintByClient = new Map<string, (typeof blueprintRows)[number]>();
    for (const b of blueprintRows) {
        if (!b.client)
            continue;
        const k = b.client.toLowerCase().trim();
        const prev = blueprintByClient.get(k);
        if (!prev || b.submittedAt > prev.submittedAt)
            blueprintByClient.set(k, b);
    }
    const tree = await ctx.db.query("metaTree").collect();
    // Show data comes from the client reporting sheets, not GHL, and that pipe
    // is not connected yet: every campaign reports 0 shows against 42 bookings.
    // Rendering "0% show rate" would read as "nobody turns up" when the truth is
    // "we do not know". Flag it as missing instead of printing a false zero.
    // [meta+ghl, 2026-09-06]
    const showDataAvailable = campaigns.some((c: any) => (c.showed7d ?? 0) > 0);
    const touchRows = (await ctx.db.query("touchLog").collect()).filter((r: any) => inScope(scope, r.client));
    const lastTouchByClient = new Map<string, number>();
    for (const r of touchRows) {
        const k = r.client.toLowerCase();
        const prev = lastTouchByClient.get(k);
        if (prev === undefined || r.at > prev)
            lastTouchByClient.set(k, r.at);
    }
    const clients = [...clientKeys.entries()]
        .map(([key, name]: any) => {
        const mine = (c?: string | null) => (c ?? "").toLowerCase() === key;
        const brand = brandDNA.filter((b: any) => mine(b.client));
        const myScripts = scripts.filter((sc: any) => mine(sc.client));
        const myVideos = videoJobs.filter((j: any) => mine(j.client));
        const myPosts = posts.filter((pp: any) => mine(pp.client));
        const late = overduePosts.filter((pp: any) => mine(pp.client));
        const myAds = ads.filter((a: any) => (clientOf.get(a.campaignName) ?? "").toLowerCase() === key);
        const spend = myAds.reduce((n: any, a: any) => n + a.spend, 0);
        const leads = myAds.reduce((n: any, a: any) => n + a.leads, 0);
        const burning = myAds.filter((a: any) => (a.frequency ?? 0) >= FATIGUE_FREQUENCY).length;
        const journey = journeys.find((j: any) => mine(j.client));
        const myCampaigns = campaigns.filter((c: any) => (c.clientName ?? c.accountName ?? "").toLowerCase() === key);
        const campaignNames = new Set(myCampaigns.map((c: any) => c.campaignName));
        const liveAds = tree.filter((t: any) => t.kind === "ad" &&
            campaignNames.has(t.campaignName) &&
            (t.effectiveStatus ?? t.status) === "ACTIVE");
        const blueprint = blueprintByClient.get(key);
        /**
         * The Brand Blueprint Typeform went live on 2026-09-05, so a client
         * onboarded before that date was never asked to fill it and an empty
         * form is not a gap. Only expect one from clients who joined on or
         * after the cutoff. [aziz, 2026-09-07]
         */
        const boardDocs = docsFor(name);
        const onboardedAt = boardDocs?.onboardedAt;
        const blueprintExpected = blueprintsTracked &&
            onboardedAt !== undefined &&
            onboardedAt >= BLUEPRINT_FORM_LIVE;
        /**
         * Creative onboarding is finished when the work is finished, not when
         * a field holds a link. Aziz, 2026-09-08: the Brand DNA and Offer
         * Cheat Sheet docs get generated from the template with whatever the
         * AI could find, so the link fills itself. Three human sign-offs
         * decide it instead:
         *   1. the Brand DNA task on the creative board is closed,
         *   2. the Offer Creation dropdown on the client board reads "Done",
         *   3. the Brand Blueprint form has been submitted.
         * Anything short of all three is unfinished, however full the fields
         * look.
         */
        const offerStep = offerStepByClient.get(nrm(name));
        const offerStatus = boardDocs?.offerStatus ?? null;
        const brandDnaSteps = {
            brandDna: {
                done: brand.length === 0,
                label: "Brand DNA finished and the task closed",
                note: brand.length === 0
                    ? "no open Brand DNA task"
                    : boardDocs?.brand
                        ? "a draft doc exists, finish it and close the task"
                        : "no doc started yet",
                doc: boardDocs?.brand ?? null,
            },
            offer: {
                // The creative board decides this. The client-board dropdown is
                // only quoted underneath when it happens to be set.
                done: offerStep !== undefined && !offerStep.open,
                label: "Offer cheat sheet finished",
                note: offerStep
                    ? offerStep.open
                        ? `"Lock The Brand DNA And The Offer" is ${offerStep.status} on the creative board`
                        : `signed off on the creative board (${offerStep.status})`
                    : "no creative onboarding checklist on the board for them yet",
                doc: offerStep?.url ?? boardDocs?.offer ?? null,
            },
            blueprint: {
                done: Boolean(blueprint),
                tracked: blueprintsTracked,
                label: "Brand Blueprint form submitted",
                note: blueprint
                    ? "submitted"
                    : !blueprintsTracked
                        ? "not tracked in the cockpit yet, check Typeform"
                        : blueprintExpected
                            ? "still waiting on the form"
                            : "onboarded before the form existed, so nothing is expected",
                doc: null as string | null,
            },
        };
        const onboardingSteps = [
            brandDnaSteps.brandDna,
            brandDnaSteps.offer,
            brandDnaSteps.blueprint,
        ];
        const onboardingOpen = onboardingSteps.filter((st: any) => !st.done && st !== brandDnaSteps.blueprint)
            .length + (blueprintExpected && !blueprint ? 1 : 0);
        const touchesThisWeek = touchRows.filter((r: any) => r.client.toLowerCase() === key && r.at >= now - 7 * DAY).length;
        const sum = (f: (c: (typeof myCampaigns)[number]) => number | undefined) => myCampaigns.reduce((n: any, c: any) => n + (f(c) ?? 0), 0);
        const bookings = sum((c: any) => c.bookings7d);
        const showed = sum((c: any) => c.showed7d);
        return {
            client: name,
            // Creative onboarding is "done" only when the Brand Blueprint form
            // exists for them. A closed ClickUp task proves nothing.
            blueprintDone: Boolean(blueprint),
            blueprintExpected,
            offerStatus,
            onboardingSteps,
            onboardingOpen,
            onboardingComplete: onboardingOpen === 0,
            blueprintAt: blueprint?.submittedAt ?? null,
            brandDnaStatus: blueprint?.brandDnaStatus ?? null,
            brandDnaDoc: blueprint?.brandDnaDoc ?? null,
            offerSheet: blueprint?.offerSheet ?? null,
            stillMissing: blueprint?.stillMissing ?? null,
            approvalNeeded: blueprint?.approvalNeeded ?? null,
            campaigns: myCampaigns.map((c: any) => ({
                campaignName: c.campaignName,
                spend7d: c.spend7d,
                leads7d: c.leads7d,
                cpl: c.cpl,
                boardAdStatus: c.boardAdStatus,
                metaAccountId: c.metaAccountId,
                metaCampaignId: c.metaCampaignId,
            })),
            // No preview links: the page shows the saved still and fetches a
            // live preview when an ad is opened.
            liveAds: liveAds.map((a: any) => ({
                metaId: a.metaId,
                name: a.name,
                thumbUrl: a.thumbUrl,
                campaignName: a.campaignName,
                accountId: a.accountId ??
                    myCampaigns.find((c: any) => c.campaignName === a.campaignName)
                        ?.metaAccountId,
                stillKey: a.stillKey,
                stillUrl: a.stillUrl,
                stillTinyUrl: a.stillTinyUrl,
            })),
            bookings7d: bookings,
            showed7d: showDataAvailable ? showed : null,
            showRate: showDataAvailable && bookings > 0 ? showed / bookings : null,
            costPerBooking: bookings > 0 ? sum((c: any) => c.spend7d) / bookings : undefined,
            touchesThisWeek,
            touchesOwed: Math.max(0, TOUCHPOINTS_PER_WEEK - touchesThisWeek),
            videos: myVideos.map((v2: any) => ({
                taskId: v2.taskId,
                url: v2.url,
                name: v2.name,
                stage: v2.stage,
                hisMove: v2.hisMove,
                editors: v2.editors,
                overdueDays: v2.overdueDays,
            })),
            scripts: myScripts.map((sc: any) => ({
                taskId: sc.taskId,
                url: sc.url,
                status: sc.status,
                ageDays: sc.ageDays,
            })),
            brandDnaOpen: brand.length,
            brandDnaOldestDays: brand.length
                ? Math.max(...brand.map((b: any) => b.ageDays))
                : 0,
            journeyDone: journey?.done ?? null,
            journeyTotal: journey?.total ?? null,
            journeyStep: journey?.currentStep ?? null,
            scriptsOpen: myScripts.length,
            scriptsStale: myScripts.filter((sc: any) => sc.ageDays >= SCRIPT_STALE_DAYS)
                .length,
            videosOpen: myVideos.length,
            videosOverdue: myVideos.filter((j: any) => j.overdueDays > 0).length,
            videosWithEditor: myVideos.filter((j: any) => j.editors.length > 0).length,
            videosDelivered: myVideos.filter((j: any) => Boolean(j.editedLink)).length,
            postsPlannedAhead: myPosts.filter((pp: any) => isOpen(pp.status) && pp.publishDate && pp.publishDate >= now).length,
            postsLate: late.length,
            ads: myAds.length,
            spend,
            leads,
            cpl: leads > 0 ? spend / leads : undefined,
            burningAds: burning,
            lastTouch: lastTouchByClient.get(key) ?? null,
        };
    })
        // Rank by how much is wrong, so the worst client is the first thing he sees.
        .map((c: any) => ({
        ...c,
        heat: c.brandDnaOldestDays +
            c.scriptsStale * 5 +
            c.videosOverdue * 5 +
            c.postsLate * 2 +
            c.burningAds * 3,
    }))
        .sort((a: any, b: any) => b.heat - a.heat);
    // --- Touchpoints owed ---------------------------------------------------
    // A touchpoint is owed when something on the creative side changed for that
    // client, or went wrong, and they have not heard from him today. Each one
    // carries the reason, so the message writes itself from the SOP.
    const today = dayKey(now);
    const touchedToday = new Set(touchRows.filter((r: any) => r.day === today).map((r: any) => r.client.toLowerCase()));
    const touchpoints = clients
        .flatMap((c: any) => {
        const reasons: string[] = [];
        if (c.burningAds > 0) {
            reasons.push(`${c.burningAds} creative${c.burningAds > 1 ? "s are" : " is"} burning out — tell them new creative is coming and when.`);
        }
        if (c.postsLate > 0) {
            reasons.push(`${c.postsLate} post${c.postsLate > 1 ? "s are" : " is"} past its publish date.`);
        }
        if (c.brandDnaOpen > 0 && c.brandDnaOldestDays >= 7) {
            reasons.push(`Brand DNA has been open ${c.brandDnaOldestDays} days — they are probably waiting on you, or you on them.`);
        }
        if (c.touchesOwed > 0 && c.touchesThisWeek === 0) {
            reasons.push(`No touchpoint this week — your floor is 1 to 2 per active client.`);
        }
        const inClientReview = c.videos.filter((v2: {
            stage: string;
        }) => v2.stage === "client review").length;
        if (inClientReview > 0) {
            reasons.push(`${inClientReview} video${inClientReview > 1 ? "s are" : " is"} in client review — send it to them, then move the stage and tell the media buyer.`);
        }
        if (!c.onboardingComplete && c.campaigns.length > 0) {
            const missing = c.onboardingSteps
                .filter((st: {
                done: boolean;
                label: string;
            }) => !st.done)
                .filter((st: {
                label: string;
            }) => c.blueprintExpected ||
                st.label !== "Brand Blueprint form submitted")
                .map((st: {
                label: string;
            }) => st.label.toLowerCase());
            if (missing.length > 0) {
                reasons.push(`Running ads before the branding is signed off, still open: ${missing.join(", ")}.`);
            }
        }
        if (c.journeyStep) {
            reasons.push(`Creative onboarding is at "${c.journeyStep}" (${c.journeyDone}/${c.journeyTotal}).`);
        }
        if (c.postsPlannedAhead === 0 && c.postsLate === 0 && c.ads === 0) {
            return [];
        }
        if (!reasons.length)
            return [];
        /**
         * The template that fits why they are owed a message, so the
         * recommended wording sits on the row itself instead of on a separate
         * page. He can still switch to any other template in the drawer.
         * [aziz, 2026-09-08]
         */
        const templateId = inClientReview > 0
            ? "ads-approval"
            : c.burningAds > 0
                ? "scripts-ready"
                : c.postsLate > 0
                    ? "content-folder"
                    : c.brandDnaOpen > 0
                        ? "filming-guidance"
                        : "idea-you-saw";
        return [
            {
                client: c.client,
                reasons,
                templateId,
                done: touchedToday.has(c.client.toLowerCase()),
                lastTouch: c.lastTouch,
            },
        ];
    })
        .slice(0, 12);
    // --- The day ------------------------------------------------------------
    const storedChecks = await ctx.db
        .query("checks")
        .withIndex("by_day", (q: any) => q.eq("day", today))
        .collect();
    const doneKeys = new Map(storedChecks.map((c: any) => [c.key, c]));
    const checks = CHECKLIST.map((c: any, i: any) => ({
        ...c,
        order: i,
        done: doneKeys.get(c.key)?.done ?? false,
        doneAt: doneKeys.get(c.key)?.doneAt ?? null,
    }));
    const plan = await ctx.db
        .query("planItems")
        .withIndex("by_day", (q: any) => q.eq("day", today))
        .collect();
    const eod = await ctx.db
        .query("eodReports")
        .withIndex("by_day", (q: any) => q.eq("day", today))
        .unique();
    return {
        day: today,
        checks,
        plan,
        eod,
        clients,
        touchpoints,
        syncedAt: tasks[0]?.syncedAt ?? null,
        journeys: journeys.sort((a: any, b: any) => b.ageDays - a.ageDays),
        brandDNA,
        scripts,
        staleScripts: scripts.filter((s: any) => s.ageDays >= SCRIPT_STALE_DAYS).length,
        editors,
        videoJobs,
        uncovered,
        overduePosts,
        plannedAhead: upcoming.length,
        fatiguing,
        fatigueGate: FATIGUE_FREQUENCY,
        anyBurning: fatiguing.some((a: any) => a.burning),
        winners,
        videoStages: VIDEO_STAGES.map((st: any) => ({
            stage: st,
            count: videoJobs.filter((j: any) => j.stage === st).length,
        })),
        awaitingHisMove: videoJobs.filter((j: any) => j.hisMove).length,
        blueprintsOnFile: blueprintRows.length,
        blueprintsTracked,
        showDataAvailable,
        touchpointsPerWeek: TOUCHPOINTS_PER_WEEK,
        counts: {
            openTasks: openTasks.length,
            brandDNA: brandDnaReal,
            brandDnaStaleTasks: brandDNA.length - brandDnaReal,
            scripts: scripts.length,
            videos: videoJobs.length,
            overdueVideos: videoJobs.filter((j: any) => j.overdueDays > 0).length,
        },
    };
}
