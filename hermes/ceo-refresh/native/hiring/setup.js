import {runtime} from "../../runtime.ts";
const ghlOk=(method,resource)=>runtime().tools.hiring(resource);
export async function readWorkflows(location) {
    const body = await ghlOk("GET", `/workflows/?locationId=${location}`);
    return (body?.workflows ?? []).map((w) => ({
        id: String(w.id),
        name: String(w.name ?? ""),
        status: String(w.status ?? ""),
    }));
}
