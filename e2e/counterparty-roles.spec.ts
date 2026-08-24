import { expect, test } from '@playwright/test';
import { createClient, withAdminApi } from './helpers/api';

type CounterpartyRole = 'customer' | 'supplier' | 'contractor';

type Counterparty = {
  id: string;
  legalName: string;
  inn: string;
  roles: CounterpartyRole[];
  companyId: string;
  tenantId: string;
  status: 'active' | 'archived';
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
    expect(created.companyId).toBe('e2e-company');
    expect(created.tenantId).toBe('e2e-company');

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
      assignments: Array<{
        counterpartyId: string;
        roleCode: CounterpartyRole;
        status: string;
        companyId: string;
        tenantId: string;
      }>;
      profiles: {
        contractor: {
          counterpartyId: string;
          status: string;
          companyId: string;
          tenantId: string;
        } | null;
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
      companyId: 'e2e-company',
      tenantId: 'e2e-company',
    });
    expect(roles.assignments.every(item => (
      item.companyId === 'e2e-company' && item.tenantId === 'e2e-company'
    ))).toBe(true);

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

    const reloadedResponse = await api.get(`/api/counterparties/${created.id}`);
    expect(reloadedResponse.ok(), await reloadedResponse.text()).toBeTruthy();
    const reloaded = await reloadedResponse.json() as Counterparty;
    expect(reloaded.status).toBe('archived');
    expect(reloaded.companyId).toBe('e2e-company');
    expect(reloaded.tenantId).toBe('e2e-company');
  });
});

test('Client and Client Object keep trusted scope through object archive, reload, and delete', async () => {
  await withAdminApi(async api => {
    const suffix = `trusted-scope-${Date.now()}`;
    const client = await createClient(api, suffix) as Awaited<ReturnType<typeof createClient>> & {
      companyId: string;
      tenantId: string;
    };
    expect(client.companyId).toBe('e2e-company');
    expect(client.tenantId).toBe('e2e-company');

    const createObject = await api.post('/api/client_objects', {
      data: {
        clientId: client.id,
        name: `E2E trusted object ${suffix}`,
        address: 'Казань',
        status: 'active',
      },
    });
    expect(createObject.ok(), await createObject.text()).toBeTruthy();
    const object = await createObject.json() as {
      id: string;
      companyId: string;
      tenantId: string;
      status: string;
    };
    expect(object.companyId).toBe('e2e-company');
    expect(object.tenantId).toBe('e2e-company');

    const archive = await api.post(`/api/client_objects/${object.id}/archive`, { data: {} });
    expect(archive.ok(), await archive.text()).toBeTruthy();

    const reload = await api.get(`/api/client_objects/${object.id}`);
    expect(reload.ok(), await reload.text()).toBeTruthy();
    const reloaded = await reload.json() as typeof object;
    expect(reloaded.status).toBe('archived');
    expect(reloaded.companyId).toBe('e2e-company');
    expect(reloaded.tenantId).toBe('e2e-company');

    const remove = await api.delete(`/api/client_objects/${object.id}`);
    expect(remove.ok(), await remove.text()).toBeTruthy();
    const missing = await api.get(`/api/client_objects/${object.id}`);
    expect(missing.status()).toBe(404);
  });
});
