import type {
  Document,
  Equipment,
  RepairPartItem,
  RepairWorkItem,
  ServicePartUsage,
  ServiceTicket,
  ServiceWorkPerformed,
} from '../types';
import { getEquipmentTypeLabel } from './equipmentClassification';
import { getServiceScenarioLabel } from './serviceScenarios';
import { formatCurrency, formatDate, formatDateTime } from './utils';

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function workItemsToRows(items: RepairWorkItem[]): ServiceWorkPerformed[] {
  return items.map((item) => {
    const normHours = Number(item.normHoursSnapshot || 0);
    const ratePerHour = Number(item.ratePerHourSnapshot || 0);
    const qty = Number(item.quantity || 0);
    const totalNormHours = Number((normHours * qty).toFixed(2));

    return {
      catalogId: item.workId,
      name: item.nameSnapshot,
      normHours,
      qty,
      totalNormHours,
      ratePerHour,
      totalCost: Number((totalNormHours * ratePerHour).toFixed(2)),
    };
  });
}

function partItemsToRows(items: RepairPartItem[]): ServicePartUsage[] {
  return items.map((item) => ({
    catalogId: item.partId,
    name: item.nameSnapshot,
    sku: item.articleSnapshot,
    qty: Number(item.quantity || 0),
    cost: Number(item.priceSnapshot || 0),
  }));
}

function getWorkRows(ticket: ServiceTicket, workItems: RepairWorkItem[]): ServiceWorkPerformed[] {
  if (workItems.length > 0) return workItemsToRows(workItems);
  return Array.isArray(ticket.resultData?.worksPerformed) ? ticket.resultData.worksPerformed : [];
}

function getPartRows(ticket: ServiceTicket, partItems: RepairPartItem[]): ServicePartUsage[] {
  if (partItems.length > 0) return partItemsToRows(partItems);
  if (Array.isArray(ticket.resultData?.partsUsed)) return ticket.resultData.partsUsed;
  return Array.isArray(ticket.parts) ? ticket.parts : [];
}

export function getServiceWorkOrderTotals(ticket: ServiceTicket, workItems: RepairWorkItem[], partItems: RepairPartItem[]) {
  const workRows = getWorkRows(ticket, workItems);
  const partRows = getPartRows(ticket, partItems);

  const worksTotal = workRows.reduce((sum, item) => sum + Number(item.totalCost || 0), 0);
  const partsTotal = partRows.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.cost || 0), 0);

  return {
    workRows,
    partRows,
    worksTotal,
    partsTotal,
    grandTotal: worksTotal + partsTotal,
  };
}

export function nextServiceWorkOrderNumber(ticketId: string, existingCount: number) {
  const suffix = String(existingCount + 1).padStart(2, '0');
  return `ZN-${ticketId}-${suffix}`;
}

export function buildServiceWorkOrderDocumentData(ticket: ServiceTicket, equipment: Equipment | undefined, workItems: RepairWorkItem[], partItems: RepairPartItem[], existingCount: number): Omit<Document, 'id'> {
  const { grandTotal } = getServiceWorkOrderTotals(ticket, workItems, partItems);
  return {
    type: 'work_order',
    number: nextServiceWorkOrderNumber(ticket.id, existingCount),
    client: ticket.reporterContact || equipment?.currentClient || 'Внутренний сервис',
    date: new Date().toISOString().slice(0, 10),
    amount: grandTotal,
    status: 'draft',
    manager: ticket.createdByUserName || ticket.createdBy || ticket.assignedMechanicName || ticket.assignedTo,
    serviceTicket: ticket.id,
  };
}

export function buildServiceWorkOrderHtml(params: {
  document: Pick<Document, 'number' | 'date' | 'client' | 'amount'>;
  ticket: ServiceTicket;
  equipment?: Equipment;
  workItems: RepairWorkItem[];
  partItems: RepairPartItem[];
}) {
  const { document, ticket, equipment, workItems, partItems } = params;
  const { workRows, partRows, worksTotal, partsTotal, grandTotal } = getServiceWorkOrderTotals(ticket, workItems, partItems);
  const scenario = getServiceScenarioLabel(ticket);
  const summary = ticket.resultData?.summary ?? ticket.result ?? '';
  const issueText = ticket.description || ticket.reason || 'Описание не заполнено';
  const workRowsHtml = workRows.length > 0
    ? workRows.map((item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.qty)}</td>
          <td>${escapeHtml(item.normHours.toFixed(2))}</td>
          <td>${escapeHtml(formatCurrency(item.ratePerHour))}</td>
          <td>${escapeHtml(formatCurrency(item.totalCost))}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="6" class="muted-cell">Работы ещё не зафиксированы</td></tr>';
  const partRowsHtml = partRows.length > 0
    ? partRows.map((item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.sku || '—')}</td>
          <td>${escapeHtml(item.qty)}</td>
          <td>${escapeHtml(formatCurrency(item.cost))}</td>
          <td>${escapeHtml(formatCurrency(Number(item.qty || 0) * Number(item.cost || 0)))}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="6" class="muted-cell">Запчасти не использовались</td></tr>';

  return `
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(`Заказ-наряд ${document.number}`)}</title>
        <style>
          :root {
            color-scheme: light;
          }
          * { box-sizing: border-box; }
          body {
            margin: 24px;
            font-family: Arial, sans-serif;
            color: #111827;
            background: #ffffff;
          }
          h1, h2, h3, p { margin: 0; }
          .actions {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
          }
          .action-btn {
            border: 1px solid #d1d5db;
            background: #ffffff;
            color: #111827;
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 12px;
            cursor: pointer;
          }
          .action-btn:hover {
            background: #f9fafb;
          }
          .sheet {
            border: 1px solid #d1d5db;
            border-radius: 16px;
            padding: 24px;
          }
          .header {
            display: flex;
            justify-content: space-between;
            gap: 24px;
            align-items: flex-start;
            margin-bottom: 20px;
          }
          .eyebrow {
            color: #6b7280;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            margin-bottom: 8px;
          }
          .meta-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
            margin-top: 16px;
          }
          .meta-card,
          .section {
            border: 1px solid #d1d5db;
            border-radius: 12px;
            padding: 14px 16px;
            background: #fff;
          }
          .section + .section {
            margin-top: 16px;
          }
          .meta-label {
            color: #6b7280;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-bottom: 4px;
          }
          .meta-value {
            font-size: 14px;
            font-weight: 700;
          }
          .meta-muted {
            font-size: 13px;
            color: #4b5563;
            margin-top: 4px;
            line-height: 1.45;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
          }
          th, td {
            border: 1px solid #d1d5db;
            padding: 8px 10px;
            font-size: 12px;
            text-align: left;
            vertical-align: top;
          }
          th {
            background: #f3f4f6;
            font-weight: 700;
          }
          .muted-cell {
            color: #6b7280;
            text-align: center;
            padding: 12px;
          }
          .totals {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
            margin-top: 16px;
          }
          .total-card {
            border: 1px solid #d1d5db;
            border-radius: 12px;
            padding: 12px 14px;
            background: #f9fafb;
          }
          .total-card strong {
            display: block;
            margin-top: 4px;
            font-size: 16px;
          }
          .signatures {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
            margin-top: 18px;
          }
          .signature {
            min-height: 96px;
            border: 1px solid #d1d5db;
            border-radius: 12px;
            padding: 12px 14px;
          }
          .signature-line {
            margin-top: 36px;
            border-top: 1px solid #9ca3af;
            padding-top: 6px;
            font-size: 12px;
            color: #6b7280;
          }
          .summary-box {
            min-height: 76px;
            white-space: pre-wrap;
            line-height: 1.5;
          }
          @media print {
            body {
              margin: 10mm;
            }
            .actions {
              display: none;
            }
            .sheet {
              border: none;
              padding: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="actions">
          <button class="action-btn" onclick="window.print()">Печать</button>
        </div>
        <div class="sheet">
          <div class="header">
            <div>
              <div class="eyebrow">Бухгалтерия / сервис</div>
              <h1>Заказ-наряд</h1>
              <p style="margin-top:8px;color:#4b5563;font-size:14px;">Основание: сервисная заявка ${escapeHtml(ticket.id)}</p>
            </div>
            <div class="meta-card" style="min-width:260px;">
              <div class="meta-label">Номер документа</div>
              <div class="meta-value">${escapeHtml(document.number)}</div>
              <div class="meta-muted">Дата: ${escapeHtml(formatDate(document.date))}</div>
              <div class="meta-muted">Сумма: ${escapeHtml(formatCurrency(document.amount || grandTotal))}</div>
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-card">
              <div class="meta-label">Техника</div>
              <div class="meta-value">${escapeHtml(ticket.equipment)}</div>
              <div class="meta-muted">
                INV: ${escapeHtml(ticket.inventoryNumber || equipment?.inventoryNumber || '—')}<br />
                SN: ${escapeHtml(ticket.serialNumber || equipment?.serialNumber || '—')}<br />
                Тип: ${escapeHtml(equipment ? getEquipmentTypeLabel(equipment) : (ticket.equipmentTypeLabel || ticket.equipmentType || '—'))}
              </div>
            </div>
            <div class="meta-card">
              <div class="meta-label">Ответственные</div>
              <div class="meta-muted">
                Сценарий: ${escapeHtml(scenario)}<br />
                Механик: ${escapeHtml(ticket.assignedMechanicName || ticket.assignedTo || 'Не назначен')}<br />
                Создал: ${escapeHtml(ticket.createdByUserName || ticket.createdBy || '—')}<br />
                Контакт: ${escapeHtml(ticket.reporterContact || document.client || '—')}
              </div>
            </div>
          </div>

          <section class="section">
            <h2 style="font-size:16px;">Описание неисправности / задачи</h2>
            <p class="summary-box" style="margin-top:10px;">${escapeHtml(issueText)}</p>
          </section>

          <section class="section">
            <h2 style="font-size:16px;">Выполненные работы</h2>
            <table>
              <thead>
                <tr>
                  <th style="width:40px;">№</th>
                  <th>Работа</th>
                  <th style="width:70px;">Кол-во</th>
                  <th style="width:90px;">Нормо-часы</th>
                  <th style="width:120px;">Ставка</th>
                  <th style="width:140px;">Сумма</th>
                </tr>
              </thead>
              <tbody>${workRowsHtml}</tbody>
            </table>
          </section>

          <section class="section">
            <h2 style="font-size:16px;">Запчасти и материалы</h2>
            <table>
              <thead>
                <tr>
                  <th style="width:40px;">№</th>
                  <th>Наименование</th>
                  <th style="width:120px;">Артикул</th>
                  <th style="width:70px;">Кол-во</th>
                  <th style="width:120px;">Цена</th>
                  <th style="width:140px;">Сумма</th>
                </tr>
              </thead>
              <tbody>${partRowsHtml}</tbody>
            </table>
          </section>

          <section class="section">
            <h2 style="font-size:16px;">Итог ремонта</h2>
            <p class="summary-box" style="margin-top:10px;">${escapeHtml(summary || 'Итог ремонта ещё не заполнен.')}</p>
            <div class="totals">
              <div class="total-card">
                <span class="meta-label">Работы</span>
                <strong>${escapeHtml(formatCurrency(worksTotal))}</strong>
              </div>
              <div class="total-card">
                <span class="meta-label">Запчасти</span>
                <strong>${escapeHtml(formatCurrency(partsTotal))}</strong>
              </div>
              <div class="total-card">
                <span class="meta-label">Итого по заказ-наряду</span>
                <strong>${escapeHtml(formatCurrency(grandTotal))}</strong>
              </div>
            </div>
          </section>

          <section class="section">
            <h2 style="font-size:16px;">Подписи</h2>
            <div class="signatures">
              <div class="signature">
                <div class="meta-label">Исполнитель</div>
                <div>${escapeHtml(ticket.assignedMechanicName || ticket.assignedTo || '________________')}</div>
                <div class="signature-line">Подпись / дата</div>
              </div>
              <div class="signature">
                <div class="meta-label">Руководитель сервиса</div>
                <div>${escapeHtml(ticket.createdByUserName || ticket.createdBy || '________________')}</div>
                <div class="signature-line">Подпись / дата</div>
              </div>
              <div class="signature">
                <div class="meta-label">Бухгалтерия</div>
                <div>${escapeHtml(document.client || '________________')}</div>
                <div class="signature-line">Принято / подпись / дата</div>
              </div>
            </div>
            <p style="margin-top:16px;color:#6b7280;font-size:12px;">
              Документ сформирован ${escapeHtml(formatDateTime(new Date().toISOString()))} на основании сервисной заявки ${escapeHtml(ticket.id)}.
            </p>
          </section>
        </div>
      </body>
    </html>
  `;
}

export function openPrintableHtml(html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, '_blank', 'width=1100,height=900');

  if (!popup) {
    URL.revokeObjectURL(url);
    return;
  }

  popup.addEventListener('load', () => {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, { once: true });
}

export function downloadPrintableHtml(html: string, fileName: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
