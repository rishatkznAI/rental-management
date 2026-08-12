import { expect, test } from '@playwright/test';
import { withAdminApi } from './helpers/api';

type CounterpartyRole = 'customer' | 'supplier' | 'contractor';

type Counterparty = {
  id: string;
  legalName: string;
  inn: string;
  roles: CounterpartyRole[];
};

test('Counterparty role API keeps one identity multi-role without creating Client', async () => {
  await withAdminApi(async api => {
    const suffix = Date.now();
    const inn = String(8_000_000_000 + (suffix % 1_000_000_000));
    const createResponse = await api.post('/api/counterparties', {
      data: {
        type: 'legal_entity',
        legalName: `ООО E2E Roles ${suffix}`,
        shortName: `E2E Roles ${suffix}`,
        inn,
        roles: ['supplier'],
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBeTruthy();
    const created = await createResponse.json() as Counterparty;
    expect(created.roles).toEqual(['supplier']);

    for (const role of ['customer', 'contractor'] as const) {
      const addResponse = await api.post(`/api/counterparties/${created.id}/roles`, {
        data: { role },
      });
      expect(addResponse.ok(), await addResponse.text()).toBeTruthy();
      const result = await addResponse.json() as { changed: boolean; counterparty: Counterparty };
      expect(result.changed).toBe(true);
      expect(result.counterparty.id).toBe(created.id);
      expect(result.counterparty.legalName).toBe(created.legalName);
      expect(result.counterparty.inn).toBe(created.inn);
    }

    const duplicateResponse = await api.post(`/api/counterparties/${created.id}/roles`, {
      data: { role: 'contractor' },
    });
    expect(duplicateResponse.ok(), await duplicateResponse.text()).toBeTruthy();
    const duplicate = await duplicateResponse.json() as { changed: boolean };
    expect(duplicate.changed).toBe(false);

    const rolesResponse = await api.get(`/api/counterparties/${created.id}/roles`);
    expect(rolesResponse.ok(), await rolesResponse.text()).toBeTruthy();
    const roles = await rolesResponse.json() as {
      counterpartyId: string;
      roles: CounterpartyRole[];
      assignments: Array<{ counterpartyId: string; roleCode: CounterpartyRole; status: string }>;
      profiles: {
        contractor: { counterpartyId: string; status: string } | null;
      };
    };
    expect(roles.counterpartyId).toBe(created.id);
    expect(roles.roles).toEqual(['customer', 'supplier', 'contractor']);
    expect(roles.assignments.map(item => ({
      counterpartyId: item.counterpartyId,
      roleCode: item.roleCode,
      status: item.status,
    })).sort((left, right) => left.roleCode.localeCompare(right.roleCode))).toEqual([
      { counterpartyId: created.id, roleCode: 'contractor', status: 'active' },
      { counterpartyId: created.id, roleCode: 'customer', status: 'active' },
      { counterpartyId: created.id, roleCode: 'supplier', status: 'active' },
    ]);
    expect(roles.profiles.contractor).toMatchObject({
      counterpartyId: created.id,
      status: 'active',
    });

    const clientsResponse = await api.get('/api/clients');
    expect(clientsResponse.ok(), await clientsResponse.text()).toBeTruthy();
    const clients = await clientsResponse.json() as Array<{ counterpartyId?: string }>;
    expect(clients.some(client => client.counterpartyId === created.id)).toBe(false);

    const removeResponse = await api.delete(`/api/counterparties/${created.id}/roles/supplier`);
    expect(removeResponse.ok(), await removeResponse.text()).toBeTruthy();
    const removed = await removeResponse.json() as { changed: boolean; counterparty: Counterparty };
    expect(removed.changed).toBe(true);
    expect(removed.counterparty.roles).toEqual(['customer', 'contractor']);

    const archiveResponse = await api.delete(`/api/counterparties/${created.id}`);
    expect(archiveResponse.ok(), await archiveResponse.text()).toBeTruthy();
  });
});
