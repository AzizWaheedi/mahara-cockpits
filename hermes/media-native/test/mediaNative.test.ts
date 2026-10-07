import { describe, expect, test } from 'bun:test';
import { generateAssistDraft, postSlackQuestion, fetchSlackThreadReplies, sanitizePayload } from '../tools';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const variants = ['Outcome', 'Objection', 'Proof', 'Question', 'Offer'].map(angle => ({ headline: `${angle} for offices`, message: 'Plan your next office.\nTalk with our design team.', angle, description: '' }));

describe('real provider transport boundaries', () => {
  test('only a Slack receipt with a channel and timestamp confirms a send', async () => {
    await expect(postSlackQuestion({ text: 'Question' }, { botToken: 'fixture', fetchImpl: async () => json({ ok: true }) })).rejects.toThrow();
    const sent = await postSlackQuestion({ text: 'Question' }, { botToken: 'fixture', fetchImpl: async (_url, init) => {
      expect(JSON.parse(String(init?.body)).channel).toBe('U09305KE2KS');
      return json({ ok: true, ts: '1728000000.000001', channel: 'D123' });
    } });
    expect(sent).toEqual({ messageTs: '1728000000.000001', channel: 'D123' });
  });
  test('reply pagination preserves cursor and excludes parent and bots', async () => {
    const page = await fetchSlackThreadReplies('D123', '1728000000.000001', { botToken: 'fixture', cursor: 'next', fetchImpl: async url => {
      expect(String(url)).toContain('cursor=next');
      return json({ ok: true, messages: [
        { ts: '1728000000.000001', user: 'U1', text: 'parent' },
        { ts: '1728000001.000001', bot_id: 'B1', text: 'bot' },
        { ts: '1728000002.000001', user: 'U2', text: 'Human answer' },
      ], response_metadata: { next_cursor: 'more' } });
    } });
    expect(page.replies).toEqual([{ ts: '1728000002.000001', text: 'Human answer', author: 'U2' }]);
    expect(page.cursor).toBe('more');
  });
  test('Anthropic response is parsed and grounded in scoped source context', async () => {
    const result = await generateAssistDraft({ kind: 'copy', client: 'Alpha', brief: 'Office design', language: 'English' }, {
      campaign: { raw_data: { city: 'Kuwait', serviceType: 'Office design' } },
      sources: { clientPrefs: [{ language: 'English' }], onboardings: [], boardCards: [{ dosDonts: 'No guarantees' }], winnersArchive: [] },
    }, { apiKey: 'fixture', fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.messages[0].content).toContain('No guarantees');
      expect(body.output_config.format.type).toBe('json_schema');
      return json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ variants, note: 'Draft only.' }) }] });
    } });
    expect(result.variants).toEqual(variants);
    expect(result.note).toContain('Nothing has been published');
  });
  test('model refusal and unsafe house-rule output fail rather than becoming ready', async () => {
    const options = { apiKey: 'fixture', fetchImpl: async () => json({ stop_reason: 'refusal', content: [] }) };
    const context = { sources: { clientPrefs: [], onboardings: [], boardCards: [], winnersArchive: [] }, campaign: null };
    await expect(generateAssistDraft({ kind: 'copy', client: 'Alpha' }, context, options)).rejects.toThrow('did not complete');
    await expect(generateAssistDraft({ kind: 'copy', client: 'Alpha' }, context, { apiKey: 'fixture', fetchImpl: async () => json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ variants: variants.map(v => ({ ...v, headline: 'Contractors save dinar' })) }) }] }) })).rejects.toThrow('house rules');
  });
  test('health payloads never retain free text or credentials', () => {
    expect(sanitizePayload({ token: 'secret', text: 'private conversation', count: 2, nested: { password: 'pw' } })).toEqual({ count: 2 });
  });
});
