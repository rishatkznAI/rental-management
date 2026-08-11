const RENTAL_SERVER_OWNED_AUDIT_FIELDS = new Set([
  'risk',
  'riskSnapshot',
  'financialRiskSnapshot',
  'creditRiskSnapshot',
  'creditRiskAcknowledged',
  'creditRiskAcknowledgedAt',
  'creditRiskAcknowledgedBy',
  'creditRiskAcknowledgedByUserId',
  'creditRiskApprovedAt',
  'creditRiskApprovedBy',
  'creditRiskApprovedByUserId',
  'approvedBy',
  'approvedById',
  'approvedByName',
  'approvedByUserId',
  'approvedByUserName',
  'approvedAt',
  'createdBy',
  'createdById',
  'createdByName',
  'createdByUserId',
  'createdByUserName',
  'createdAt',
  'updatedBy',
  'updatedById',
  'updatedByName',
  'updatedByUserId',
  'updatedByUserName',
  'updatedAt',
  'audit',
  'auditLog',
  'history',
]);

const RENTAL_CREATE_VALIDATION_CODE = 'RENTAL_PAYLOAD_VALIDATION_FAILED';
const RENTAL_MONEY_SCALE = 100;
const RENTAL_DAILY_PRICING_MODE = 'daily_rate';
const RENTAL_GROSS_AMOUNT_FIELDS = ['price', 'amount', 'totalAmount', 'rentalAmount'];
const RENTAL_MUTATION_PROTECTED_FIELDS = new Set([
  'startDate',
  'plannedReturnDate',
  'endDate',
  'pricingMode',
  'rate',
  'dailyRate',
  ...RENTAL_GROSS_AMOUNT_FIELDS,
  'discount',
  'deposit',
]);

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function rentalCreateValidationError(field, message, fieldErrors = null) {
  const error = new Error(message);
  error.status = 400;
  error.code = RENTAL_CREATE_VALIDATION_CODE;
  error.field = field;
  error.fieldErrors = fieldErrors || { [field]: message };
  return error;
}

function isEmptyRentalInput(value) {
  return value === undefined
    || value === null
    || (typeof value === 'string' && value.trim() === '');
}

function canonicalRentalMoney(value, options = {}) {
  const field = options.field || 'price';
  const label = options.label || field;
  if (isEmptyRentalInput(value)) {
    if (options.required) {
      throw rentalCreateValidationError(field, `${label} обязательно для аренды.`);
    }
    return options.defaultValue;
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw rentalCreateValidationError(field, `${label} должно быть корректным числом.`);
  }

  const raw = typeof value === 'string' ? value.trim() : value;
  if (typeof raw === 'string' && !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) {
    throw rentalCreateValidationError(field, `${label} должно быть корректным числом.`);
  }
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(numeric)) {
    throw rentalCreateValidationError(field, `${label} должно быть конечным числом.`);
  }
  if (numeric < 0) {
    throw rentalCreateValidationError(field, `${label} не может быть меньше 0.`);
  }

  const rounded = Math.round(numeric * RENTAL_MONEY_SCALE) / RENTAL_MONEY_SCALE;
  if (!Number.isSafeInteger(Math.round(numeric * RENTAL_MONEY_SCALE))) {
    throw rentalCreateValidationError(
      field,
      `${label} слишком велико для точного хранения с двумя знаками после запятой.`,
    );
  }
  if (Math.abs(numeric - rounded) > 1e-9) {
    throw rentalCreateValidationError(
      field,
      `${label} может содержать не более двух знаков после запятой.`,
    );
  }
  return Object.is(rounded, -0) ? 0 : rounded;
}

function canonicalRentalRate(value, options = {}) {
  const field = options.field || 'rate';
  const label = options.label || 'Ставка аренды';
  if (isEmptyRentalInput(value)) {
    const amount = canonicalRentalMoney(options.defaultValue, {
      field,
      label,
      defaultValue: 0,
    });
    return { amount, unit: 'day', text: `${amount} ₽/день` };
  }

  if (typeof value === 'number') {
    const amount = canonicalRentalMoney(value, { field, label });
    return { amount, unit: 'day', text: `${amount} ₽/день` };
  }
  if (typeof value !== 'string') {
    throw rentalCreateValidationError(field, `${label} должно быть корректным числом.`);
  }

  const match = value.trim().match(
    /^(-?(?:\d+(?:[.,]\d+)?|\.\d+))\s*(?:(?:₽|руб(?:\.|лей)?|rub)\s*)?(?:\/?\s*(день|дн(?:\.|ей)?|сутки|day|месяц|мес(?:\.|яц)?|month))?$/iu,
  );
  if (!match) {
    throw rentalCreateValidationError(
      field,
      `${label} должно быть числом с необязательной единицей «день» или «месяц».`,
    );
  }
  const amount = canonicalRentalMoney(match[1].replace(',', '.'), { field, label });
  const unit = /^(?:месяц|мес|month)/iu.test(String(match[2] || '')) ? 'month' : 'day';
  return {
    amount,
    unit,
    text: `${amount} ₽/${unit === 'month' ? 'месяц' : 'день'}`,
  };
}

function strictRentalDate(value, field, label) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw rentalCreateValidationError(field, `${label} должна быть указана в формате YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw rentalCreateValidationError(field, `${label} содержит несуществующую календарную дату.`);
  }
  return { key: raw, time: date.getTime() };
}

function inclusiveRentalDays(startTime, endTime) {
  return Math.floor((endTime - startTime) / 86_400_000) + 1;
}

function canonicalizeGrossRentalAmount(input) {
  const supplied = RENTAL_GROSS_AMOUNT_FIELDS
    .filter(field => hasOwn(input, field) && !isEmptyRentalInput(input[field]))
    .map(field => ({
      field,
      amount: canonicalRentalMoney(input[field], {
        field,
        label: field === 'price' ? 'Цена аренды' : 'Сумма аренды',
      }),
    }));
  const canonical = supplied[0]?.amount ?? 0;
  const mismatched = supplied.filter(entry => entry.amount !== canonical);
  if (mismatched.length > 0) {
    const fields = Object.fromEntries(
      supplied.map(entry => [entry.field, 'Все поля общей суммы аренды должны совпадать.']),
    );
    throw rentalCreateValidationError('price', 'Поля общей суммы аренды противоречат друг другу.', fields);
  }
  return { amount: canonical, suppliedFields: supplied.map(entry => entry.field) };
}

function canonicalizeRentalCreatePayload(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const start = strictRentalDate(source.startDate, 'startDate', 'Дата начала аренды');
  const end = strictRentalDate(source.plannedReturnDate ?? source.endDate, 'plannedReturnDate', 'Дата окончания аренды');
  if (end.time < start.time) {
    throw rentalCreateValidationError(
      'plannedReturnDate',
      'Дата окончания аренды не может быть раньше даты начала.',
    );
  }

  const pricingMode = String(source.pricingMode ?? '').trim();
  if (pricingMode && pricingMode !== RENTAL_DAILY_PRICING_MODE && pricingMode !== 'manual_total') {
    throw rentalCreateValidationError('pricingMode', 'Неизвестный режим расчёта цены аренды.');
  }

  const rate = canonicalRentalRate(source.rate ?? source.dailyRate ?? 0);
  let dailyRate;
  if (hasOwn(source, 'dailyRate') && !isEmptyRentalInput(source.dailyRate)) {
    dailyRate = canonicalRentalMoney(source.dailyRate, {
      field: 'dailyRate',
      label: 'Дневная ставка',
    });
    if (rate.unit !== 'day' || rate.amount !== dailyRate) {
      throw rentalCreateValidationError(
        'dailyRate',
        'Дневная ставка и текстовое поле ставки должны совпадать.',
        {
          dailyRate: 'Дневная ставка не совпадает с полем rate.',
          rate: 'Ставка не совпадает с полем dailyRate.',
        },
      );
    }
  }

  const gross = canonicalizeGrossRentalAmount(source);
  let price = gross.amount;
  if (pricingMode === RENTAL_DAILY_PRICING_MODE) {
    if (rate.unit !== 'day') {
      throw rentalCreateValidationError('rate', 'Для посуточного расчёта ставка должна быть указана за день.');
    }
    dailyRate = dailyRate ?? rate.amount;
    price = canonicalRentalMoney(dailyRate * inclusiveRentalDays(start.time, end.time), {
      field: 'price',
      label: 'Цена аренды',
    });
  }

  const discount = canonicalRentalMoney(source.discount, {
    field: 'discount',
    label: 'Скидка',
    defaultValue: 0,
  });
  if (discount > price) {
    throw rentalCreateValidationError('discount', 'Скидка не может превышать общую цену аренды.');
  }
  const deposit = canonicalRentalMoney(source.deposit, {
    field: 'deposit',
    label: 'Залог',
    defaultValue: 0,
  });

  const canonical = {
    ...source,
    startDate: start.key,
    plannedReturnDate: end.key,
    rate: pricingMode === RENTAL_DAILY_PRICING_MODE
      ? `${dailyRate} ₽/день`
      : rate.text,
    price,
    discount,
    deposit,
    ...(pricingMode ? { pricingMode } : {}),
    ...(dailyRate !== undefined ? { dailyRate } : {}),
  };
  delete canonical.endDate;
  if (!pricingMode) delete canonical.pricingMode;
  if (dailyRate === undefined) delete canonical.dailyRate;
  for (const field of RENTAL_GROSS_AMOUNT_FIELDS) {
    if (field === 'price' || !hasOwn(source, field)) continue;
    if (gross.suppliedFields.includes(field)) canonical[field] = price;
    else delete canonical[field];
  }
  return canonical;
}

function rentalMutationProtectedFields(input) {
  return Object.keys(input || {}).filter(field => RENTAL_MUTATION_PROTECTED_FIELDS.has(field));
}

function canonicalizeRentalPatch(existing, requestedPatch) {
  const previous = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const patch = requestedPatch && typeof requestedPatch === 'object' && !Array.isArray(requestedPatch)
    ? requestedPatch
    : {};
  const protectedFields = rentalMutationProtectedFields(patch);
  if (protectedFields.length === 0) {
    return {
      rental: { ...previous, ...patch, id: previous.id },
      patch: { ...patch },
      protectedFields,
    };
  }

  if (
    hasOwn(patch, 'plannedReturnDate')
    && hasOwn(patch, 'endDate')
    && !isEmptyRentalInput(patch.plannedReturnDate)
    && !isEmptyRentalInput(patch.endDate)
    && String(patch.plannedReturnDate).trim() !== String(patch.endDate).trim()
  ) {
    throw rentalCreateValidationError(
      'plannedReturnDate',
      'Поля даты окончания аренды противоречат друг другу.',
      {
        plannedReturnDate: 'Дата окончания не совпадает с полем endDate.',
        endDate: 'Дата окончания не совпадает с полем plannedReturnDate.',
      },
    );
  }

  const normalizedPatch = { ...patch };
  const keepEndDateAlias = hasOwn(previous, 'endDate') || hasOwn(patch, 'endDate');
  if (hasOwn(patch, 'endDate') && !hasOwn(patch, 'plannedReturnDate')) {
    normalizedPatch.plannedReturnDate = patch.endDate;
  }
  delete normalizedPatch.endDate;

  const candidate = { ...previous, ...normalizedPatch, id: previous.id };
  const canonicalSource = { ...candidate };
  delete canonicalSource.endDate;

  const requestedGrossFields = RENTAL_GROSS_AMOUNT_FIELDS.filter(field => hasOwn(patch, field));
  let requestedGrossAmount;
  if (requestedGrossFields.length > 0) {
    const requestedGross = canonicalizeGrossRentalAmount(
      Object.fromEntries(requestedGrossFields.map(field => [field, patch[field]])),
    );
    requestedGrossAmount = requestedGross.amount;
  }
  const currentGrossField = RENTAL_GROSS_AMOUNT_FIELDS.find(field => !isEmptyRentalInput(previous[field]));
  const grossSeed = requestedGrossFields.length > 0
    ? requestedGrossAmount
    : currentGrossField
      ? previous[currentGrossField]
      : 0;
  for (const field of RENTAL_GROSS_AMOUNT_FIELDS) delete canonicalSource[field];
  canonicalSource.price = grossSeed;

  const nextPricingMode = String(canonicalSource.pricingMode ?? '').trim();
  if (nextPricingMode === RENTAL_DAILY_PRICING_MODE) {
    if (hasOwn(patch, 'dailyRate') && !hasOwn(patch, 'rate')) {
      canonicalSource.rate = patch.dailyRate;
    } else if (hasOwn(patch, 'rate') && !hasOwn(patch, 'dailyRate')) {
      const parsedRate = canonicalRentalRate(patch.rate);
      if (parsedRate.unit !== 'day') {
        throw rentalCreateValidationError('rate', 'Для посуточного расчёта ставка должна быть указана за день.');
      }
      canonicalSource.dailyRate = parsedRate.amount;
    }
  }

  const canonical = canonicalizeRentalCreatePayload(canonicalSource);
  const nextRental = { ...candidate, ...canonical, id: previous.id };
  if (keepEndDateAlias) nextRental.endDate = canonical.plannedReturnDate;
  else delete nextRental.endDate;
  for (const field of RENTAL_GROSS_AMOUNT_FIELDS) {
    if (field === 'price') continue;
    if (hasOwn(previous, field) || hasOwn(patch, field)) nextRental[field] = canonical.price;
    else delete nextRental[field];
  }

  const canonicalPatch = { ...patch };
  delete canonicalPatch.endDate;
  for (const field of RENTAL_MUTATION_PROTECTED_FIELDS) {
    if (field === 'endDate') continue;
    const changed = JSON.stringify(previous[field] ?? null) !== JSON.stringify(nextRental[field] ?? null);
    if ((hasOwn(patch, field) || changed) && hasOwn(nextRental, field)) canonicalPatch[field] = nextRental[field];
    else delete canonicalPatch[field];
  }
  for (const field of RENTAL_GROSS_AMOUNT_FIELDS) {
    if (field !== 'price' && !hasOwn(nextRental, field)) delete canonicalPatch[field];
  }

  return { rental: nextRental, patch: canonicalPatch, protectedFields };
}

function rentalServerOwnedAuditFields(input) {
  return Object.keys(input || {}).filter(field =>
    RENTAL_SERVER_OWNED_AUDIT_FIELDS.has(field) ||
    /audit/i.test(field) ||
    /^(?:credit|financial)?risk/i.test(field) ||
    /^(?:approved|created|updated)(?:At|By(?:Id|Name|UserId|UserName)?)$/i.test(field)
  );
}

function stripRentalServerOwnedAuditFields(input) {
  const blocked = new Set(rentalServerOwnedAuditFields(input));
  return Object.fromEntries(Object.entries(input || {}).filter(([field]) => !blocked.has(field)));
}

module.exports = {
  RENTAL_SERVER_OWNED_AUDIT_FIELDS,
  RENTAL_CREATE_VALIDATION_CODE,
  RENTAL_DAILY_PRICING_MODE,
  RENTAL_MUTATION_PROTECTED_FIELDS,
  canonicalRentalMoney,
  canonicalRentalRate,
  canonicalizeRentalCreatePayload,
  canonicalizeRentalPatch,
  rentalCreateValidationError,
  rentalMutationProtectedFields,
  strictRentalDate,
  rentalServerOwnedAuditFields,
  stripRentalServerOwnedAuditFields,
};
