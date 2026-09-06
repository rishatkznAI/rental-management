import { PRODUCTION_SMOKE_FIXTURE_PROTECTED_MESSAGE } from './productionSmokeFixture';

const BUSINESS_ERROR_MESSAGES: Record<string, string> = {
  USER_TENANT_PROFILE_SCOPE_REQUIRED: 'Не удалось подтвердить доступ к данным компании. Обратитесь к администратору.',
  CLIENT_INN_INVALID: 'Укажите корректный ИНН: 10 цифр для юрлица или 12 цифр для ИП.',
  CLIENT_INN_DUPLICATE: 'Клиент с таким ИНН уже существует. Проверьте ИНН или откройте существующего клиента.',
  EQUIPMENT_IDENTIFIER_DUPLICATE: 'Техника с таким инвентарным или серийным номером уже существует. Проверьте номера.',
  SYSTEM_FIXTURE_PROTECTED: PRODUCTION_SMOKE_FIXTURE_PROTECTED_MESSAGE,
};

// Only known business codes become display text; arbitrary server messages can contain diagnostics.
export function businessWriteErrorMessage(error: unknown, entity: 'client' | 'equipment'): string {
  const failure = error && typeof error === 'object'
    ? error as { status?: number; message?: unknown; body?: { code?: unknown; error?: unknown } }
    : {};
  const code = [failure.body?.code, failure.body?.error, failure.message]
    .find(value => typeof value === 'string' && Object.hasOwn(BUSINESS_ERROR_MESSAGES, value));
  let reason = typeof code === 'string' ? BUSINESS_ERROR_MESSAGES[code] : '';
  if (!reason) {
    switch (failure.status) {
      case 400:
      case 422:
        reason = 'Проверьте заполненные поля и повторите попытку.';
        break;
      case 401:
      case 403:
        reason = 'Недостаточно прав для сохранения. Обратитесь к администратору.';
        break;
      case 404:
        reason = 'Карточка больше недоступна. Обратитесь к администратору.';
        break;
      case 409:
        reason = 'Сохранение отклонено из-за конфликта данных. Проверьте данные или обратитесь к администратору.';
        break;
      default:
        reason = 'Сервер недоступен или не смог обработать запрос. Повторите попытку позже.';
    }
  }
  return `Не удалось сохранить ${entity === 'client' ? 'клиента' : 'технику'}. ${reason} Введённые данные остались в форме.`;
}
