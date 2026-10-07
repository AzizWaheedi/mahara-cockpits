import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';
import { BUCKET, PictureError, imageType, publicImageUrl, readImageBody, validateMetadata, validatePicturePath } from './pictures.ts';
import { pictureTools, type ImportedPicture } from './tools.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
const meetingId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/);
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('teamPictures.upload'), requestId: z.string().uuid(), args: z.object({ meetingId, contentType: z.enum(['image/png','image/jpeg','image/gif','image/webp']), bytes: z.number().int().positive().max(10485760) }) }),
  z.object({ operation: z.literal('teamPictures.ready'), requestId: z.string().uuid(), args: z.object({ meetingId, path: z.string().max(200) }) }),
  z.object({ operation: z.literal('teamPictures.fromUrl'), requestId: z.string().uuid(), args: z.object({ meetingId, url: z.string().max(8192) }) }),
]);
const pictureSchema = z.object({
  request_id: z.string().uuid(), actor_id: z.string().uuid(), meeting_id: z.string(), path: z.string(),
  kind: z.enum(['upload','fromUrl']), content_type: z.string(), bytes: z.number().int().positive(),
  source_hash: z.string().nullable(), source_host: z.string().nullable(), accepted_at: z.string().nullable(),
});
const contextSchema = z.object({ actorId: z.string().uuid(), picture: pictureSchema.nullable() });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: cors });
  const headers = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) throw new PictureError('Sign in first.', 401);
    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anon || !service) throw new PictureError('Picture storage is not configured. Contact an administrator.', 503);
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
    const raw = await readImageBody(req.body, 16384);
    let input: z.infer<typeof requestSchema>;
    try { input = requestSchema.parse(JSON.parse(new TextDecoder().decode(raw))); }
    catch { throw new PictureError('Choose a valid picture operation, meeting, size and request ID.'); }
    if (input.operation === 'teamPictures.ready') validatePicturePath(input.args.meetingId, input.args.path);
    const scope = async () => {
      const { data, error } = await client.rpc('cockpit_team_picture_context', {
        p_meeting_id: input.args.meetingId,
        p_path: input.operation === 'teamPictures.ready' ? input.args.path : null,
        p_request_id: input.operation === 'teamPictures.ready' ? null : input.requestId,
      });
      if (error) throw new PictureError('This picture or meeting is not available to your active seat.', 403);
      const parsed = contextSchema.safeParse(data);
      if (!parsed.success) throw new PictureError('The server did not confirm meeting access.', 503);
      return parsed.data;
    };
    const context = await scope();
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const tools = pictureTools(async row => {
      const { error } = await admin.from('cockpit_team_picture_health').insert({ ...row, actor_id: context.actorId, request_id: input.requestId });
      if (error) throw new PictureError('Could not save the picture storage health receipt.', 503);
    });
    let picture = context.picture;
    let sourceHash: string | null = null;
    if (input.operation === 'teamPictures.fromUrl') {
      const source = publicImageUrl(input.args.url);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source.toString()));
      sourceHash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
      if (picture && (picture.kind !== 'fromUrl' || picture.source_hash !== sourceHash)) throw new PictureError('This request ID belongs to a different picture.', 409);
    } else if (input.operation === 'teamPictures.upload' && picture &&
      (picture.kind !== 'upload' || picture.content_type !== input.args.contentType || picture.bytes !== input.args.bytes)) {
      throw new PictureError('This request ID belongs to a different picture.', 409);
    }
    let imported: ImportedPicture | undefined;
    if (!picture) {
      if (input.operation === 'teamPictures.ready') throw new PictureError('That picture has no upload reservation.', 403);
      if (input.operation === 'teamPictures.fromUrl') imported = await tools.download(input.args.url);
      const contentType = input.operation === 'teamPictures.upload' ? input.args.contentType : imported!.contentType;
      const bytes = input.operation === 'teamPictures.upload' ? input.args.bytes : imported!.bytes.length;
      imageType(contentType, bytes);
      const { data, error } = await client.rpc('cockpit_team_picture_reserve', {
        p_request_id: input.requestId, p_meeting_id: input.args.meetingId,
        p_kind: input.operation === 'teamPictures.upload' ? 'upload' : 'fromUrl',
        p_content_type: contentType, p_bytes: bytes, p_source_hash: sourceHash, p_source_host: imported?.host ?? null,
      });
      if (error) throw new PictureError('The picture reservation was not confirmed. Retry with the same request ID.', 409);
      picture = pictureSchema.parse(data);
    }
    const path = validatePicturePath(input.args.meetingId, picture.path);
    if (input.operation === 'teamPictures.upload') {
      await scope();
      const result = await tools.storage('sign-upload', async () => {
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
        if (error || !data?.signedUrl) throw new PictureError('The picture upload link was not confirmed. Retry with the same request ID.');
        return { path, uploadUrl: data.signedUrl };
      });
      return new Response(JSON.stringify(result), { headers });
    }
    if (input.operation === 'teamPictures.fromUrl' && !picture.accepted_at) {
      // A prior PUT can have succeeded before its response was lost. Inspect the
      // immutable path first; never overwrite it or create another copy on retry.
      const present = await tools.storage('inspect-import', async () => {
        const { data, error } = await admin.storage.from(BUCKET).info(path);
        if (!error) return data;
        if ('statusCode' in error && String(error.statusCode) === '404') return null;
        throw new PictureError('Could not inspect the imported picture. Retry with the same request ID.');
      });
      if (!present) {
        imported ??= await tools.download(input.args.url);
        if (imported.contentType !== picture.content_type || imported.bytes.length !== picture.bytes) throw new PictureError('The source picture changed. Start a new import.', 409);
        await scope();
        await tools.storage('import-upload', async () => {
          const { error } = await admin.storage.from(BUCKET).upload(path, imported!.bytes, { contentType: imported!.contentType, upsert: false });
          // Concurrent retry: a conflict is safe only if the metadata read below confirms it.
          if (error && !('statusCode' in error && ['409','400'].includes(String(error.statusCode)) && /already exists|duplicate/i.test(error.message))) throw new PictureError('The picture upload was not confirmed. Retry with the same request ID.');
        });
      }
    }
    await tools.storage('verify-object', async () => {
      const { data, error } = await admin.storage.from(BUCKET).info(path);
      if (error || !data) throw new PictureError('The picture did not arrive. Upload it again.');
      const info = z.object({ size: z.number(), contentType: z.string() }).safeParse(data);
      if (!info.success) throw new PictureError('Storage did not return the picture’s size and type.');
      validateMetadata({ size: info.data.size, contentType: info.data.contentType }, picture.content_type, picture.bytes);
    });
    // This user-JWT RPC rechecks seat/meeting/owner and reads storage.objects
    // itself. Acceptance + both audits commit atomically and only once per path.
    const { error: acceptError } = await client.rpc('cockpit_team_picture_accept', { p_meeting_id: input.args.meetingId, p_path: path });
    if (acceptError) throw new PictureError('The picture was not accepted. Check your meeting access and retry the same request.');
    const result = await tools.storage('sign-read', async () => {
      // Signing through the user's RLS policy rechecks access at the read boundary.
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 600);
      if (error || !data?.signedUrl) throw new PictureError('The picture was saved, but its read link was not confirmed. Retry the same request.');
      return { path, url: data.signedUrl };
    });
    return new Response(JSON.stringify(result), { headers });
  } catch (error) {
    const status = error instanceof PictureError ? error.status : 500;
    const message = error instanceof PictureError ? error.message : 'Picture storage could not confirm this operation. Retry with the same request.';
    return new Response(JSON.stringify({ error: message }), { status, headers });
  }
});
