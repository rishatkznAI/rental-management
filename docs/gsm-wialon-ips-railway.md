# GSM WIALON IPS TCP on Railway

## Runtime env

Set these variables for the backend service:

```bash
ENABLE_GSM_TCP_GATEWAY=true
GSM_TCP_PORT=5050
```

The gateway listens on `0.0.0.0:5050` inside the Railway service.

## Railway TCP Proxy

1. Open the backend service in Railway.
2. Enable TCP Proxy for internal port `5050`.
3. Copy the external TCP `host:port` issued by Railway.
4. Save that value into `gsm_devices.targetServer` for the UMKA device.
5. Configure the tracker to use the Railway TCP Proxy `host:port`.

The regular Railway HTTPS domain is not suitable for WIALON IPS TCP trackers. UMKA must connect to the TCP Proxy endpoint, not to `https://...railway.app`.

## First device

Initial rollout device:

- Equipment: `MANTALL XE140W`, inventory number `03300976`
- Legacy object: `049`
- Device: `UMKA`
- IMEI: `869132070808689`
- SIM1: `+79625678660`
- Protocol: `WIALON IPS TCP`
- Old server: `gw1.glonasssoft.ru:15050`

Use `POST /api/gsm/devices/link` as an administrator to link it:

```json
{
  "inventoryNumber": "03300976",
  "model": "MANTALL XE140W",
  "imei": "869132070808689",
  "deviceType": "UMKA",
  "protocol": "WIALON IPS TCP",
  "sim1": "+79625678660",
  "oldServer": "gw1.glonasssoft.ru:15050",
  "targetServer": "RAILWAY_TCP_HOST:PORT"
}
```
