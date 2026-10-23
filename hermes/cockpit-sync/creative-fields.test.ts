import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CLIENT_FIELDS} from './creativeProducer';

// The Brand Blueprint's presses write four dropdowns on the client card
// (docs/brand-blueprint SPEC.md 4.5). The sync reads them back by these
// names, so the creative cockpit and cockpit_blueprint_sources see what the
// outbox wrote.
test('the client rows carry the four Blueprint card fields by name', () => {
  assert.equal(CLIENT_FIELDS.offerCreationStatus, 'Offer Creation');
  assert.equal(CLIENT_FIELDS.templatedAdsStatus, 'Templated Ads Status');
  assert.equal(CLIENT_FIELDS.canSelfRecord, 'Can Self-Record?');
  assert.equal(CLIENT_FIELDS.adApprovalNeeded, 'Ad Approval Needed?');
});

test('the docs and links the cockpits already read are still there', () => {
  for (const key of ['brandDnaDoc', 'offerCheatSheet', 'driveFolder', 'driveLink', 'marketResearchDoc', 'dosDonts'])
    assert.ok(CLIENT_FIELDS[key], key);
});
