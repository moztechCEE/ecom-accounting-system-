import {
  moduleGrants,
  hasSourceAdministrationPermissions,
} from '../integration/after-sales/erp-module.contract';
import {
  connectionInput,
  fieldNames,
  interactionInput,
  logRange,
} from './operations-admin.contract';
const connection = {
  category: 'LINE',
  provider: 'LINE',
  brand: 'MOZTECH',
  accountId: '1234',
  displayName: '墨子客服',
  environment: 'DEV',
  metadata: { loginChannelId: '5678' },
};
const interaction = {
  id: 'e187ba12-9733-4d4c-a512-90e773f4d837',
  actionId: 'after_sales.create',
  workbench: 'AFTER_SALES',
  outcome: 'INTENT',
  occurredAt: '2026-10-13T00:00:00.000Z',
};
describe('operations metadata boundaries', () => {
  it('keeps LINE Login and Messaging identifiers independent', () => {
    expect(
      connectionInput({
        ...connection,
        metadata: { loginChannelId: '5678', messagingChannelId: '1234' },
      }).metadata,
    ).toEqual({ loginChannelId: '5678', messagingChannelId: '1234' });
  });
  it.each(['token', 'password', 'secret', 'authorization'])(
    'rejects raw %s configuration',
    (key) => {
      expect(() =>
        connectionInput({ ...connection, [key]: 'private' }),
      ).toThrow();
      expect(() =>
        connectionInput({ ...connection, metadata: { [key]: 'private' } }),
      ).toThrow();
    },
  );
  it('accepts a Secret Manager reference but rejects raw key values', () => {
    expect(
      connectionInput({
        ...connection,
        credentialRef: 'projects/test-project/secrets/line-oa/versions/2',
      }).credentialRef,
    ).toContain('/secrets/');
    expect(() =>
      connectionInput({ ...connection, credentialRef: 'secret-value' }),
    ).toThrow();
  });
  it('rejects provider/category mismatch', () =>
    expect(() =>
      connectionInput({ ...connection, provider: 'META' }),
    ).toThrow());
  it('rejects unsupported brand', () =>
    expect(() =>
      connectionInput({ ...connection, brand: 'foreign' }),
    ).toThrow());
  it('never accepts client assertions of a business commit', () => {
    expect(() =>
      interactionInput(
        { ...interaction, outcome: 'COMMITTED' },
        Date.parse(interaction.occurredAt),
      ),
    ).toThrow();
  });
  it.each(['actorId', 'entityId', 'name', 'phone', 'query', 'token'])(
    'does not record raw interaction %s',
    (key) =>
      expect(() =>
        interactionInput(
          { ...interaction, [key]: 'private' },
          Date.parse(interaction.occurredAt),
        ),
      ).toThrow(),
  );
  it('is stable across retries and captures time separately', () => {
    const a = interactionInput(interaction, Date.parse(interaction.occurredAt));
    expect(a.requestHash).toBe(
      interactionInput(interaction, Date.parse(interaction.occurredAt))
        .requestHash,
    );
  });
  it('bounds offline timestamps', () =>
    expect(() =>
      interactionInput(
        interaction,
        Date.parse(interaction.occurredAt) + 86400001,
      ),
    ).toThrow());
  it('bounds range and rejects malformed dates', () => {
    expect(() => logRange('2026-01-01', '2026-10-13')).toThrow();
    expect(() => logRange('invalid', '2026-10-13')).toThrow();
  });
  it('returns changed names without secret fields or contents', () =>
    expect(
      fieldNames({
        name: 'private',
        password: 'private',
        token: 'private',
        status: 'READY',
      }),
    ).toEqual(['name', 'status']));
});

describe('shared purpose grants do not widen Source authority', () => {
  it('maps integration settings only to the settings module', () =>
    expect(
      moduleGrants(
        ['integration_settings:read', 'integration_settings:update'],
        false,
      ),
    ).toEqual({ read: ['settings'], write: ['settings'] }));
  it('maps global operation logs only to Source audit read', () =>
    expect(
      moduleGrants(['operation_logs:read', 'operation_logs:export'], false),
    ).toEqual({ read: ['audit_logs'], write: [] }));
  it('shared settings and log grants never create a Source administrator', () =>
    expect(
      hasSourceAdministrationPermissions([
        'integration_settings:read',
        'integration_settings:update',
        'operation_logs:read',
      ]),
    ).toBe(false));
});

it('does not allow one unbranded LINE identity to serve both brands', () =>
  expect(() => connectionInput({ ...connection, brand: '' })).toThrow('品牌'));
