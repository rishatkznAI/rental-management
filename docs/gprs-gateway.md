# GSM/GPRS Gateway: локальная проверка

GPRS-шлюз запускается вместе с backend и слушает TCP-порт из `GPRS_PORT`.
Если переменная не задана, используется порт `5023`.

## Переменные окружения

- `GSM_ENABLED=false` — глобально отключить GSM/GPRS ingest на время conservation: HTTP `/api/gsm/ingest` не пишет пакеты, TCP-шлюзы не слушают после рестарта.
- `GSM_DISABLED=true` — явный глобальный флаг отключения GSM/GPRS ingest, эквивалентный conservation-блокировке.
- `GPRS_ENABLED=true` — явно включить legacy TCP-шлюз; backend startup оставляет его выключенным при любом другом значении.
- `GSM_INGEST_TOKEN` или `GSM_GATEWAY_SECRET` — обязательный секрет для HTTP ingest `/api/gsm/ingest`.
- `GSM_HTTP_MAX_PAYLOAD_BYTES=16384` — максимальный размер нормализованного HTTP ingest payload.
- `GSM_MAX_PACKET_AGE_SECONDS=604800` — допустимое отклонение timestamp входящего HTTP пакета, по умолчанию 7 дней.
- `GSM_DEDUPE_WINDOW_MS=300000` — окно дедупликации одинаковых пакетов.
- `GPRS_PORT=5023` — TCP-порт шлюза, по умолчанию `5023`.
- `GPRS_HOST=0.0.0.0` — адрес прослушивания, по умолчанию `0.0.0.0`.
- `GPRS_MAX_PACKET_BYTES=16384` — максимальный размер одного пакета.
- `GPRS_MAX_PACKETS_PER_MINUTE=120` — базовый rate limit на одно TCP-соединение.
- `GPRS_CONNECTION_TIMEOUT_MS=120000` — таймаут неактивного соединения.
- `GSM_TCP_MAX_CONNECTIONS=200` — общий предел одновременных соединений для обоих публичных TCP-шлюзов.
- `GSM_TCP_MAX_CONNECTIONS_PER_IP=40` — предел соединений с одного source IP.
- `GSM_TCP_MAX_AUTH_ATTEMPTS_PER_MINUTE=120` и `GSM_TCP_MAX_AUTH_ATTEMPTS_PER_IP_PER_MINUTE=30` — общие лимиты дорогих проверок device credential.
- `GSM_TCP_PREAUTH_TIMEOUT_MS=15000` — срок, за который TCP-клиент обязан аутентифицироваться.
- `GSM_TCP_MAX_PACKETS_PER_MINUTE_GLOBAL=10000` и `GSM_TCP_MAX_PACKETS_PER_IP_PER_MINUTE=1000` — общий и per-IP бюджеты пакетов до parsing/persistence.
- `GSM_TCP_MAX_BYTES_PER_MINUTE_GLOBAL=67108864` и `GSM_TCP_MAX_BYTES_PER_IP_PER_MINUTE=8388608` — общий и per-IP бюджеты входящего TCP-трафика.

Если порт занят, основной backend продолжит работать, а в `/api/gsm/status` будет видно ошибку запуска шлюза.

## Локальная проверка

1. Запустить backend:

   ```bash
   cd server
   GPRS_ENABLED=true GPRS_PORT=5023 npm start
   ```

2. Убедиться, что backend работает, а шлюз доступен в разделе **GSM** или через API:

   ```bash
   curl -H "Authorization: Bearer <token>" http://localhost:3000/api/gsm/status
   ```

3. Найти точный стабильный `equipmentId` нужной техники, например через поиск привязок:

   ```bash
   curl -H "Authorization: Bearer <admin-token>" \
     "http://localhost:3000/api/gsm/bindings?search=<inventory-or-serial>"
   ```

4. До отправки телеметрии зарегистрировать устройство и привязать его к технике через канонический lifecycle endpoint. `imei` и `deviceId` независимы: можно передать один из них или оба, не подставляя Device ID в поле IMEI.

   ```bash
   curl -X POST http://localhost:3000/api/gsm/devices/link \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{
       "equipmentId":"<stable-equipment-id>",
       "imei":"<tracker-imei>",
       "deviceId":"<tracker-device-id>",
       "protocol":"fallback-text",
       "ingressMode":"tcp_device_credential",
       "ingressSecret":"<unique-device-secret>",
       "sim1":"<sim-number-if-needed>"
     }'
   ```

   Сохраните `device.id` из ответа: это идентификатор записи реестра GSM, используемый для lifecycle-операций.

5. Отправить тестовый пакет через `netcat`:

   ```bash
   echo "IMEI:<tracker-imei> ingressSecret=<same-unique-device-secret> LAT:55.796 LNG:49.108 SPEED:0" | nc localhost 5023
   ```

   Если трекер или отдельный gateway умеет отправлять HTTPS, используйте HTTP ingest вместо прямого TCP:

   ```bash
   GSM_PACKET_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
   curl -X POST http://localhost:3000/api/gsm/ingest \
     -H "Content-Type: application/json" \
     -H "X-GSM-Ingest-Token: $GSM_INGEST_TOKEN" \
     -d "{\"imei\":\"<http-provisioned-tracker-imei>\",\"lat\":55.796,\"lng\":49.108,\"speed\":0,\"timestamp\":\"$GSM_PACKET_TIMESTAMP\"}"
   ```

6. Открыть раздел **GSM** и проверить вкладку **Последние пакеты**.

7. Проверить, что пакет связан с техникой, а в карточке техники обновились:
   - последняя связь;
   - координаты;
   - скорость;
   - GSM-статус.

Карточка техники показывает GSM-поля только как read-only проекцию реестра `gsm_devices`. Не создавайте и не меняйте GSM-идентификаторы через общий `POST/PATCH /api/equipment`: привязку и перепривязку выполняет только `POST /api/gsm/devices/link`.

## Вывод устройства из эксплуатации

Для снятия GSM-устройства с активной привязки используйте `device.id`, полученный при регистрации или из `GET /api/gsm/devices`:

```bash
curl -X POST http://localhost:3000/api/gsm/devices/<gsm-device-record-id>/retire \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Замена трекера"}'
```

Операция помечает запись как `retired` и очищает GSM-проекцию техники, если у неё не осталось другого активного устройства. Повторная команда для уже выведенного устройства идемпотентна.

Реактивация выполняется повторным `POST /api/gsm/devices/link` с тем же физическим идентификатором и точным `equipmentId`. Смена IMEI/Device ID активного устройства выполняется по стабильному ID записи, а не созданием второй записи:

```bash
curl -X PATCH http://localhost:3000/api/gsm/devices/<gsm-device-record-id>/identity \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"imei":"<new-tracker-imei>","deviceId":"<new-tracker-device-id>"}'
```

Rebind, реактивация и ротация увеличивают `bindingRevision`. Пакеты и команды сохраняют эту ревизию, поэтому историческая телеметрия остаётся связана с прежней техникой, а открытое TCP-соединение после изменения привязки обязано переподключиться.

На первом этапе шлюз не реализует конкретный протокол производителя. Сырые данные сохраняются в `gsm_packets`, а fallback-парсер аккуратно извлекает только простые текстовые поля вроде IMEI, LAT, LNG, SPEED, VOLTAGE и моточасов.
Для следующего этапа нужна документация производителя трекера: формат пакетов, handshake, checksum, подтверждения ACK и команды устройства.

## Production notes

- `/api/gsm/ingest` подходит для схемы `tracker/gateway -> HTTPS -> Railway backend`. Endpoint не использует пользовательскую сессию, но требует `GSM_INGEST_TOKEN` или `GSM_GATEWAY_SECRET`.
- Direct TCP работает только если инфраструктура даёт внешний TCP endpoint. Для Railway это отдельный TCP Proxy, обычный HTTPS домен `*.railway.app` не принимает WIALON IPS TCP.
- Если реальные трекеры отправляют TCP/UDP без HTTPS и Railway TCP Proxy не подходит, используйте отдельный VPS/gateway: `GSM tracker -> VPS TCP/UDP gateway -> HTTPS /api/gsm/ingest -> Railway backend`.
- Diagnostics доступны администратору через `GET /api/gsm/diagnostics`; ответ не содержит env и секреты.
