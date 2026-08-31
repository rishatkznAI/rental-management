import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { validatePublicSiteCms } = require('../server/lib/public-site-cms');
const { registerPublicSiteRoutes } = require('../server/routes/public-site');

const content = {
  company: { name: 'СКАЙТЕХ', descriptor: 'Аренда', phone: '+7', phoneHref: '+7', email: 'a@b.ru', hours: '9–18', whatsapp: '', telegram: '', address: 'Казань', legal: 'ООО', cities: ['Казань'] },
  demoNotice: '', footerText: 'Техника',
  home: { eyebrow: '', title: 'Главная', description: '', categoriesTitle: '', categoriesDescription: '', popularTitle: '', selectionTitle: '', selectionDescription: '', requestTitle: '', requestDescription: '' },
  catalog: { eyebrow: '', title: 'Каталог', description: '', helperTitle: '', helperDescription: '' },
  servicesPage: { eyebrow: '', title: 'Услуги', description: '', requestTitle: '', requestDescription: '' },
  about: { eyebrow: '', title: 'О компании', description: '', storyTitle: '', storyText: '' },
  contacts: { eyebrow: '', title: 'Контакты', description: '', mapTitle: '', mapDescription: '' },
  services: [{ title: 'Аренда', text: 'Подбор техники' }],
};

const equipment = [{
  slug: 'mantall-test', name: 'Mantall Test', category: 'Ножничные подъёмники', categoryShort: 'Ножничный',
  workingHeight: 10, platformHeight: 8, capacity: 230, platformSize: 'Платформа', weight: 2000,
  engine: 'Электрический', drive: '2WD', use: 'Помещение', surface: 'Ровный пол', manufacturer: 'Mantall',
  availability: 'available', price: 5000, popularity: 50, image: '/images/test.jpg', gallery: [], purpose: 'Работы', limits: [], benefits: [], published: true,
}];

test('CMS validation accepts the public site contract and rejects duplicate slugs', () => {
  assert.deepEqual(validatePublicSiteCms({ content, equipment }), { ok: true });
  const duplicate = [...equipment, { ...equipment[0] }];
  assert.equal(validatePublicSiteCms({ content, equipment: duplicate }).ok, false);
});

test('public site routes keep reads public and writes admin-only', async () => {
  const values = new Map();
  const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'public-site-cms-'));
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', registerPublicSiteRoutes({
    readData: name => values.get(name) || null,
    writeData: (name, value) => values.set(name, value),
    requireAuth: (req, res, next) => req.get('authorization') === 'Bearer admin' ? (req.user = { userRole: 'Администратор', email: 'admin@example.com' }, next()) : res.status(401).json({ error: 'Unauthorized' }),
    requireAdmin: (req, res, next) => req.user?.userRole === 'Администратор' ? next() : res.status(403).json({ error: 'Forbidden' }),
    uploadRoot,
    nowIso: () => '2026-08-31T12:00:00.000Z',
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const initial = await fetch(`${base}/api/public-site/cms`).then(response => response.json());
    assert.deepEqual(initial, { content: null, equipment: null, updatedAt: null });
    assert.equal((await fetch(`${base}/api/public-site/cms`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, equipment }) })).status, 401);
    const savedResponse = await fetch(`${base}/api/public-site/cms`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin' }, body: JSON.stringify({ content, equipment }) });
    assert.equal(savedResponse.status, 200);
    const saved = await fetch(`${base}/api/public-site/cms`).then(response => response.json());
    assert.equal(saved.updatedAt, '2026-08-31T12:00:00.000Z');
    assert.equal(saved.equipment[0].slug, 'mantall-test');

    const imageResponse = await fetch(`${base}/api/public-site/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin' },
      body: JSON.stringify({ contentType: 'image/png', base64: Buffer.from('image-bytes').toString('base64') }),
    });
    assert.equal(imageResponse.status, 201);
    const uploaded = await imageResponse.json();
    assert.match(uploaded.path, /^\/api\/public-site\/media\/site-[0-9]+-[a-f0-9]{12}\.png$/);
    assert.equal(Object.hasOwn(uploaded, 'url'), false);
  } finally {
    server.close();
    fs.rmSync(uploadRoot, { recursive: true, force: true });
  }
});
