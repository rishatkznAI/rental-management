import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const listSource = readFileSync(new URL('../src/app/pages/Service.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../src/app/pages/ServiceDetail.tsx', import.meta.url), 'utf8');
const formSource = readFileSync(new URL('../src/app/components/service/ServiceTicketForm.tsx', import.meta.url), 'utf8');

test('service list keeps desktop table/grid patterns while exposing mobile cards', () => {
  assert.match(listSource, /data-service-desktop-table="tickets"[\s\S]*xl:grid/);
  assert.match(listSource, /data-service-mobile-card="ticket"/);
  assert.match(listSource, /data-service-responsive-list="tickets"[\s\S]*xl:space-y-0/);
  assert.match(listSource, /data-service-responsive-root="service"[\s\S]*overflow-x-clip/);
});

test('service queue and archive have responsive list containers instead of table-only mobile rows', () => {
  assert.match(listSource, /data-service-desktop-table="queue"[\s\S]*2xl:grid/);
  assert.match(listSource, /data-service-mobile-card="queue"/);
  assert.match(listSource, /data-service-desktop-table="archive"[\s\S]*lg:grid/);
  assert.match(listSource, /data-service-mobile-card="archive-ticket"/);
  assert.doesNotMatch(listSource, /<table[\s\S]*data-service-responsive-list/);
});

test('service tabs wrap on mobile and scroll only from larger breakpoints', () => {
  assert.match(listSource, /data-service-responsive-tabs="top"[\s\S]*flex-wrap[\s\S]*sm:flex-nowrap[\s\S]*sm:overflow-x-auto/);
  assert.match(listSource, /data-service-responsive-tabs="request"[\s\S]*flex-wrap[\s\S]*sm:flex-nowrap[\s\S]*sm:overflow-x-auto/);
  assert.match(detailSource, /data-service-responsive-tabs="detail"[\s\S]*flex-wrap[\s\S]*sm:flex-nowrap[\s\S]*sm:overflow-x-auto/);
});

test('service detail has responsive safe containers and stacked mobile form actions', () => {
  assert.match(detailSource, /data-service-detail-responsive="true"[\s\S]*overflow-x-clip/);
  assert.match(detailSource, /data-service-detail-form-row="add-work"[\s\S]*grid min-w-0/);
  assert.match(detailSource, /data-service-detail-form-row="add-part"[\s\S]*grid min-w-0/);
  assert.match(detailSource, /data-service-detail-form-row="comment"[\s\S]*flex flex-col/);
  assert.match(detailSource, /className="w-full md:w-auto"[\s\S]*Добавить запчасть/);
});

test('service ticket form is mobile-safe for create/edit flows', () => {
  assert.match(formSource, /data-service-form-responsive="true"[\s\S]*overflow-x-clip/);
  assert.match(formSource, /: 'flex flex-col-reverse gap-2 sm:flex-row sm:gap-3'/);
  assert.match(formSource, /className="w-full sm:w-auto" disabled=\{isSubmitting\}/);
  assert.match(formSource, /grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5/);
});
