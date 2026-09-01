# GSM WIALON IPS TCP on Railway

## Runtime env

Set these variables for the backend service:

```bash
ENABLE_GSM_TCP_GATEWAY=true
GSM_TCP_PORT=5050
GSM_TCP_MAX_LINE_BYTES=16384
GSM_TCP_MAX_PACKETS_PER_MINUTE=120
GSM_TCP_CONNECTION_TIMEOUT_MS=120000
```

Finite process-wide connection, authentication, packet, byte, and pre-authentication budgets are listed in `docs/gprs-gateway.md`. Invalid, non-finite, zero, and negative limit values are clamped to safe finite bounds rather than disabling protection.

The gateway listens on `0.0.0.0:5050` inside the Railway service.

## Railway TCP Proxy

1. Open the backend service in Railway.
2. Enable TCP Proxy for internal port `5050`.
3. Copy the external TCP `host:port` issued by Railway.
4. Optionally save that value as display/configuration metadata in `gsm_devices.targetServer`.
5. Configure the tracker to use the Railway TCP Proxy `host:port`.

The regular Railway HTTPS domain is not suitable for WIALON IPS TCP trackers. The tracker must connect to the TCP Proxy endpoint, not to `https://...railway.app`.

## Provision a device

First find the exact stable equipment ID through the scoped binding search:

```bash
curl -H "Authorization: Bearer <admin-token>" \
  "https://<backend-host>/api/gsm/bindings?search=<inventory-or-serial>"
```

Then use `POST /api/gsm/devices/link` as an administrator. Use a unique transport-safe secret (8–256 ASCII letters, digits, `.`, `_`, `~`, or `-`) and deliver it to the device through an approved secret channel:

```json
{
  "equipmentId": "<stable-equipment-id>",
  "imei": "<tracker-imei>",
  "protocol": "WIALON IPS TCP",
  "ingressMode": "tcp_device_credential",
  "ingressSecret": "<unique-device-secret>",
  "targetServer": "<railway-tcp-host:port>"
}
```

The login packet must authenticate with the same provisioned secret before any telemetry packet is accepted:

```text
#L#<tracker-imei>;<same-unique-device-secret>\r\n
```

The response must be `#AL#1\r\n`. Subsequent WIALON packets on that same connection are accepted only while the device record, binding revision, tenant scope, ingress mode, and credential fingerprint remain current. Rebind, retirement, identity rotation, or credential rotation invalidates the existing session and requires a new authenticated connection.
