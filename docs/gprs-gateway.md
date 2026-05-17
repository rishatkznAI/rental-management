# GSM/GPRS Gateway: локальная проверка

GPRS-шлюз запускается вместе с backend и слушает TCP-порт из `GPRS_PORT`.
Если переменная не задана, используется порт `5023`.

## Переменные окружения

- `GSM_ENABLED=0` — общий алиас для отключения legacy TCP-шлюза, если `GPRS_ENABLED` не задан.
- `GSM_INGEST_TOKEN` или `GSM_GATEWAY_SECRET` — обязательный секрет для HTTP ingest `/api/gsm/ingest`.
- `GSM_HTTP_MAX_PAYLOAD_BYTES=16384` — максимальный размер нормализованного HTTP ingest payload.
- `GSM_MAX_PACKET_AGE_SECONDS=604800` — допустимое отклонение timestamp входящего HTTP пакета, по умолчанию 7 дней.
- `GSM_DEDUPE_WINDOW_MS=300000` — окно дедупликации одинаковых пакетов.
- `GPRS_ENABLED=0` — отключить TCP-шлюз без отключения Express API.
- `GPRS_PORT=5023` — TCP-порт шлюза, по умолчанию `5023`.
- `GPRS_HOST=0.0.0.0` — адрес прослушивания, по умолчанию `0.0.0.0`.
- `GPRS_MAX_PACKET_BYTES=16384` — максимальный размер одного пакета.
- `GPRS_MAX_PACKETS_PER_MINUTE=120` — базовый rate limit на одно TCP-соединение.
- `GPRS_CONNECTION_TIMEOUT_MS=120000` — таймаут неактивного соединения.

Если порт занят, основной backend продолжит работать, а в `/api/gsm/status` будет видно ошибку запуска шлюза.

## Локальная проверка

1. Запустить backend:

   ```bash
   cd server
   GPRS_PORT=5023 npm start
   ```

2. Убедиться, что backend работает, а шлюз доступен в разделе **GSM** или через API:

   ```bash
   curl -H "Authorization: Bearer <token>" http://localhost:3000/api/gsm/status
   ```

3. Отправить тестовый пакет через `netcat`:

   ```bash
   echo "IMEI:866123456789012 LAT:55.796 LNG:49.108 SPEED:0" | nc localhost 5023
   ```

   Если трекер или отдельный gateway умеет отправлять HTTPS, используйте HTTP ingest вместо прямого TCP:

   ```bash
   curl -X POST http://localhost:3000/api/gsm/ingest \
     -H "Content-Type: application/json" \
     -H "X-GSM-Ingest-Token: $GSM_INGEST_TOKEN" \
     -d '{"imei":"866123456789012","lat":55.796,"lng":49.108,"speed":0}'
   ```

4. Открыть раздел **GSM** и проверить вкладку **Последние пакеты**.

5. Открыть карточку техники и заполнить поле **GSM IMEI** значением:

   ```text
   866123456789012
   ```

6. Повторить отправку пакета через `nc`.

7. Проверить, что новый пакет связан с техникой, а в карточке техники обновились:
   - последняя связь;
   - координаты;
   - скорость;
   - GSM-статус.

На первом этапе шлюз не реализует конкретный протокол производителя. Сырые данные сохраняются в `gsm_packets`, а fallback-парсер аккуратно извлекает только простые текстовые поля вроде IMEI, LAT, LNG, SPEED, VOLTAGE и моточасов.
Для следующего этапа нужна документация производителя трекера: формат пакетов, handshake, checksum, подтверждения ACK и команды устройства.

## Production notes

- `/api/gsm/ingest` подходит для схемы `tracker/gateway -> HTTPS -> Railway backend`. Endpoint не использует пользовательскую сессию, но требует `GSM_INGEST_TOKEN` или `GSM_GATEWAY_SECRET`.
- Direct TCP работает только если инфраструктура даёт внешний TCP endpoint. Для Railway это отдельный TCP Proxy, обычный HTTPS домен `*.railway.app` не принимает WIALON IPS TCP.
- Если реальные трекеры отправляют TCP/UDP без HTTPS и Railway TCP Proxy не подходит, используйте отдельный VPS/gateway: `GSM tracker -> VPS TCP/UDP gateway -> HTTPS /api/gsm/ingest -> Railway backend`.
- Diagnostics доступны администратору через `GET /api/gsm/diagnostics`; ответ не содержит env и секреты.
