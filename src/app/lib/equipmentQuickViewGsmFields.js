import {
  deriveEquipmentGsmSignalState,
  hasMeaningfulEquipmentGsmData,
  hasUsableGsmCoordinates,
} from './gsmSignalState.js';

const SIGNAL_STATE_LABELS = Object.freeze({
  online: 'Онлайн',
  location_only: 'Только координаты',
  offline: 'Офлайн',
});

function isPresent(value) {
  return value !== null && value !== undefined && value !== '';
}

function firstPresent(...values) {
  return values.find(isPresent) ?? '—';
}

export function buildEquipmentQuickViewGsmFields(selectedEquipment = {}, signalOptions = {}) {
  const latitude = firstPresent(selectedEquipment.gsmLastLat, selectedEquipment.gsmLatitude);
  const longitude = firstPresent(selectedEquipment.gsmLastLng, selectedEquipment.gsmLongitude);
  const hasSignalState = hasMeaningfulEquipmentGsmData(selectedEquipment);
  const hasCanonicalBinding = selectedEquipment.gsmBindingVerified === true;
  const hasTrustedTelemetry = hasCanonicalBinding && selectedEquipment.gsmTelemetryVerified === true;
  const signalState = deriveEquipmentGsmSignalState(selectedEquipment, null, signalOptions);
  const hasUsableCoordinates = hasTrustedTelemetry
    && hasUsableGsmCoordinates(latitude, longitude);

  return [
    {
      label: 'Статус',
      value: hasSignalState
        ? (hasCanonicalBinding ? SIGNAL_STATE_LABELS[signalState] : 'Непроверенные данные')
        : '—',
    },
    { label: 'IMEI', value: hasCanonicalBinding ? firstPresent(selectedEquipment.gsmImei) : '—' },
    { label: 'Устройство', value: hasCanonicalBinding ? firstPresent(selectedEquipment.gsmDeviceId, selectedEquipment.gsmTrackerId) : '—' },
    { label: 'Последний сигнал', value: hasTrustedTelemetry ? firstPresent(selectedEquipment.gsmLastSeenAt, selectedEquipment.gsmLastSignalAt) : '—' },
    { label: 'Адрес', value: hasTrustedTelemetry ? firstPresent(selectedEquipment.gsmAddress) : '—' },
    { label: 'Координаты', value: hasUsableCoordinates ? `${latitude}, ${longitude}` : '—' },
    { label: 'Моточасы GSM', value: hasTrustedTelemetry ? firstPresent(selectedEquipment.gsmLastMotoHours, selectedEquipment.gsmHourmeter) : '—' },
    { label: 'Напряжение', value: hasTrustedTelemetry ? firstPresent(selectedEquipment.gsmLastVoltage, selectedEquipment.gsmBatteryVoltage) : '—' },
  ];
}
