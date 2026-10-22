/**
 * A client can own several ad accounts. Keep those accounts separate at the
 * source, then combine their counts once under the exact ClickUp identity.
 * Ratios are calculated by the adapter after this merge, never averaged.
 */
export function deliveryClientGroups(clients, spendBy = new Map(), bookBy = new Map(), countsBy = new Map(), noOutcomeBy = new Map()) {
    const groups = new Map();
    const owners = new Map();
    const add = (target, source) => {
        for (const [key, value] of Object.entries(source ?? {})) {
            if (typeof value !== "number" || !Number.isFinite(value))
                throw new Error("Client delivery contains an invalid source count.");
            target[key] = (target[key] ?? 0) + value;
        }
    };
    for (const client of clients) {
        if (!client.clientId) throw new Error("Client delivery has no account identity.");
        const key = client.clickupTaskId ? `task:${client.clickupTaskId}` : `account:${client.clientId}`;
        const owner = owners.get(client.clientId);
        if (owner && owner !== key)
            throw new Error("An ad account points to more than one client. Review its source mapping.");
        // A repeated identical join row must not double spend or appointments.
        if (owner) continue;
        owners.set(client.clientId, key);
        let group = groups.get(key);
        if (!group) {
            group = { ...client, campaigns: 0, accountIds: [], spend: {}, booked: {provisional: 0, confirmed: 0},
                counts: {leads: 0, bookings: 0, provisional: 0, confirmed: 0, showed: 0, noshow: 0, closes: 0, noOutcome: 0},
                noOutcome: [], modes: new Set() };
            groups.set(key, group);
        }
        group.accountIds.push(client.clientId);
        group.campaigns += client.campaigns ?? 0;
        if (client.serviceMode) group.modes.add(client.serviceMode.trim().toLowerCase());
        add(group.spend, spendBy.get(client.clientId));
        add(group.booked, bookBy.get(client.clientId));
        add(group.counts, countsBy.get(client.clientId));
        group.noOutcome.push(...(noOutcomeBy.get(client.clientId) ?? []));
    }
    return [...groups.values()].map(({modes, ...group}) => ({
        ...group,
        serviceMode: modes.size === 1 ? [...modes][0] : null,
        noOutcome: group.noOutcome.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20),
    }));
}
