import {z} from 'zod';
import {providerTools} from './tools.ts';
import {
  PORTAL_FORM_URL, PORTAL_LIST_ID, TEAM_SPACE_ID,
  portalTask, sortPortalTasks, tagFor, type PortalTask,
} from '../../../apps/client-success-cockpit/src/lib/portalTasksCore.ts';

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{data: unknown; error: {message: string} | null}>;
};
type Admin = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{error: {message: string} | null}>;
  };
};
const taskId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const inputSchema = z.object({
  operation: z.literal('portalTasks.forClient'),
  args: z.object({taskId}).strict(),
  requestId: z.string().uuid(),
  apply: z.boolean().optional(),
}).strict();
const contextSchema = z.object({
  actorId: z.string().uuid(),
  email: z.string().min(1),
  taskId,
  clientName: z.string().refine(name => name.trim().length > 0),
  sourceSnapshotAt: z.string().min(1),
}).strict();
const tagSchema = z.object({name: z.string().refine(name => name.trim().length > 0)}).passthrough();
const tagsSchema = z.object({tags: z.array(tagSchema)});
const customFieldSchema = z.object({
  id: z.string().min(1),
  type_config: z.object({
    options: z.array(z.object({
      id: z.union([z.string(), z.number()]).optional(),
      name: z.string().optional(),
      orderindex: z.union([z.string(), z.number()]).optional(),
    }).passthrough()).optional(),
  }).passthrough().optional(),
}).passthrough();
const dueDateSchema = z.union([z.string().min(1), z.number()]).nullable().optional().refine(
  value => value == null || (Number.isFinite(Number(value)) && !Number.isNaN(new Date(Number(value)).getTime())),
);
const pageSchema = z.object({
  tasks: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    status: z.object({status: z.string().min(1), type: z.string().optional()}),
    tags: z.array(tagSchema),
    due_date: dueDateSchema,
    custom_fields: z.array(customFieldSchema),
    url: z.string().nullable().optional(),
  }).passthrough()),
  last_page: z.boolean().optional(),
});

export class PortalTasksAccessError extends Error {}

/** Read existing portal tasks only. The ClickUp form owns task creation. */
export async function runPortalTasks(
  client: RpcClient,
  admin: Admin,
  raw: unknown,
  env: (name: string) => string | undefined,
  request: typeof fetch = fetch,
): Promise<{clientName: string; tag: string | null; formUrl: string; tasks: PortalTask[]}> {
  const input = inputSchema.parse(raw);
  const readScope = async () => {
    const gate = await client.rpc('cockpit_csm_client_gate', {p_task_id: input.args.taskId});
    if (gate.error) throw new PortalTasksAccessError(gate.error.message);
    const parsed = contextSchema.safeParse(gate.data);
    if (!parsed.success || parsed.data.taskId !== input.args.taskId) {
      throw new PortalTasksAccessError('The client access context is incomplete or changed. Refresh the client roster.');
    }
    return parsed.data;
  };
  const scope = await readScope();
  const guard = async () => {
    const current = await readScope();
    if (current.actorId !== scope.actorId || current.email !== scope.email ||
        current.taskId !== scope.taskId || current.clientName !== scope.clientName ||
        current.sourceSnapshotAt !== scope.sourceSnapshotAt) {
      throw new PortalTasksAccessError('Client access or source changed during the portal-task read. Refresh the client roster.');
    }
  };
  const clickup = providerTools(env('CLICKUP_API_TOKEN') ?? '', async row => {
    const saved = await admin.from('cockpit_csm_provider_health').insert({...row, provider: 'clickup', action_id: null});
    if (saved.error) throw Error('Provider health could not be saved. Stop the portal-task read.');
  }, request);
  const get = async (path: string) => {
    await guard();
    return clickup.call('GET', path);
  };
  const tags = tagsSchema.safeParse(await get(`space/${TEAM_SPACE_ID}/tag`));
  if (!tags.success) throw Error('ClickUp returned missing or malformed space tags. Portal tasks could not be read.');
  const tag = tagFor(scope.clientName, tags.data.tags);
  const tasks: PortalTask[] = [];
  if (tag) {
    for (let page = 0; page < 5; page++) {
      const query = new URLSearchParams({page: String(page), include_closed: 'true', subtasks: 'true'});
      query.append('tags[]', tag);
      const result = pageSchema.safeParse(await get(`list/${PORTAL_LIST_ID}/task?${query}`));
      if (!result.success) throw Error('ClickUp returned missing or malformed portal tasks. The task list could not be verified.');
      for (const task of result.data.tasks) {
        if (!tagFor(tag, task.tags)) throw Error('ClickUp returned a task outside the selected client tag. Refresh the portal-task list.');
        tasks.push(portalTask(task));
      }
      if (result.data.last_page !== false || result.data.tasks.length === 0) break;
    }
  }
  // Do not release provider data after a revocation or source change during the final read.
  await guard();
  return {clientName: scope.clientName, tag, formUrl: PORTAL_FORM_URL, tasks: sortPortalTasks(tasks)};
}
