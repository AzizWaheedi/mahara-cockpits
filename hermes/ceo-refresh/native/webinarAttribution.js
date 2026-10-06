import { num } from "./numbers.js";
export function withoutWebinar(m, wb) {
    if (!Object.values(wb).some(x => x !== 0))
        return m;
    const less = (k) => num(m[k]) - (wb[k] ?? 0);
    const div = (a, b, times, places) => b > 0 ? Math.round(((times * a) / b) * 10 ** places) / 10 ** places : null;
    const r2 = (x) => Math.round(x * 100) / 100;
    const leads = less("leads");
    const spend = less("spend");
    const impressions = less("impressions");
    const clicks = less("clicks");
    const linkClicks = less("link_clicks");
    const c = {
        ib: less("intros_booked"),
        is: less("intros_shown"),
        iq: less("intros_qualified"),
        idq: less("intros_disqualified"),
        ic: less("intros_cancelled"),
        idue: less("intros_due"),
        isch: less("intros_scheduled"),
        db: less("demos_booked"),
        ds: less("demos_shown"),
        dq: less("demos_qualified"),
        ddq: less("demos_disqualified"),
        dc: less("demos_cancelled"),
        ddue: less("demos_due"),
        dsch: less("demos_scheduled"),
    };
    const advanced = less("intros_advanced");
    const shownIntros = num(m.intros_shown) - (wb.shown_intros ?? 0);
    const signed = less("signed");
    const revenue = less("revenue");
    const leadgen = num(m.spend_leadgen) - (wb.spend ?? 0);
    const retargeting = num(m.spend_retargeting) - (wb.spend_retargeting ?? 0);
    return {
        ...m,
        leads,
        spend: r2(spend),
        spend_leadgen: r2(leadgen),
        spend_retargeting: r2(retargeting),
        retargeting_share: div(retargeting, leadgen + retargeting, 100, 1),
        impressions,
        clicks,
        link_clicks: linkClicks,
        ctr: div(clicks, impressions, 100, 2),
        ctr_link: div(linkClicks, impressions, 100, 2),
        cost_per_lead: div(spend, leads, 1, 2),
        intros_booked: c.ib,
        intros_shown: c.is,
        intros_qualified: c.iq,
        intros_disqualified: c.idq,
        intros_cancelled: c.ic,
        intros_due: c.idue,
        intros_scheduled: c.isch,
        intros_advanced: advanced,
        demos_booked: c.db,
        demos_shown: c.ds,
        demos_qualified: c.dq,
        demos_disqualified: c.ddq,
        demos_cancelled: c.dc,
        demos_due: c.ddue,
        demos_scheduled: c.dsch,
        calls_booked: c.ib + c.db,
        calls_shown: c.is + c.ds,
        calls_qualified: c.iq + c.dq,
        calls_disqualified: c.idq + c.ddq,
        calls_cancelled: c.ic + c.dc,
        calls_due: c.idue + c.ddue,
        calls_scheduled: c.isch + c.dsch,
        signed,
        revenue: r2(revenue),
        cash_collected: r2(less("cash_collected")),
        new_mrr: r2(less("new_mrr")),
        roas: div(revenue, spend, 1, 2),
        cac: div(spend, signed, 1, 2),
        cost_per_demo: div(spend, c.ds, 1, 2),
        cost_per_demo_booked: div(spend, c.db, 1, 2),
        close_rate: div(signed, c.dq, 100, 1),
        close_rate_all: div(signed, c.ds, 100, 1),
        lead_to_client: div(signed, leads, 100, 1),
        lead_to_demo: div(c.dsch, leads, 100, 1),
        demo_show_rate: div(c.ds, c.ddue, 100, 1),
        intro_show_rate: div(c.is, c.idue, 100, 1),
        intro_disqualified_rate: div(c.idq, c.idue, 100, 1),
        demo_disqualified_rate: div(c.ddq, c.ddue, 100, 1),
        disqualified_rate: div(c.idq + c.ddq, c.idue + c.ddue, 100, 1),
        intro_cancel_rate: div(c.ic, c.isch, 100, 1),
        demo_cancel_rate: div(c.dc, c.dsch, 100, 1),
        cancel_rate: div(c.ic + c.dc, c.isch + c.dsch, 100, 1),
        intro_to_demo: div(advanced, shownIntros, 100, 1),
    };
}
