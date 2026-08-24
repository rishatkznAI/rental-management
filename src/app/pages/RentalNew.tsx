import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePermissions } from '../lib/permissions';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { ArrowLeft } from 'lucide-react';
import { useClientsList } from '../hooks/useClients';
import {
  CLIENT_CONTRACT_KEYS,
  CLIENT_OBJECT_KEYS,
  refreshClientRelationCache,
  useClientContractsList,
  useClientObjectsList,
  useCreateClientContract,
  useCreateClientObject,
} from '../hooks/useClientRelations';
import { useEquipmentList } from '../hooks/useEquipment';
import { useGanttData } from '../hooks/useRentals';
import { usePaymentsList } from '../hooks/usePayments';
import { rentalsService } from '../services/rentals.service';
import type { RentalAvailabilityConflict, RentalCreditRiskSnapshot } from '../services/rentals.service';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api';
import type { GanttRentalData } from '../mock-data';
import type { ClientContract, ClientObject } from '../types';
import { canEquipmentParticipateInRentals } from '../lib/equipmentClassification';
import { calculateRentalAmount, formatCurrency, getRentalDays } from '../lib/utils';
import { hasDateOverlap, isEquipmentBusy } from '../lib/rental-conflicts';
import { buildClientReceivables, buildRentalDebtRows } from '../lib/finance';
import { EquipmentCombobox } from '../components/ui/EquipmentCombobox';
import { clientLabel } from '../components/ui/ClientCombobox';
import { filterRentalManagerUsers } from '../lib/userStorage';
import { staffService, type StaffOption } from '../services/staff.service';
import {
  cacheAvailabilityConflict,
  cacheCreatedRental,
  cacheFinancialRiskConflict,
  refreshRentalCreateCaches,
} from '../lib/rental-create-cache';
import {
  buildRentalNewRoute,
  parseRentalNewRoute,
  stripRentalNewOuterQuery,
} from '../lib/rental-new-route.js';
import {
  forgetIdempotentAttempt,
  idempotencyKeyForAttempt,
  isUnknownMutationOutcome,
} from '../lib/rental-create-attempt.js';

const selectId = (value: unknown) => (value === undefined || value === null ? '' : String(value));
const relationSelectClass = 'h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white';

type IdempotentAttempt = { fingerprint: string; key: string; storageToken?: string };
type RentalCreateField = 'startDate' | 'plannedReturnDate' | 'dailyRate' | 'rate' | 'price' | 'amount' | 'discount' | 'deposit';
type RentalCreateFieldErrors = Partial<Record<RentalCreateField, string>>;

const parseRentalMoneyInput = (value: string, label: string) => {
  const raw = value.trim();
  if (!raw) return { ok: true as const, value: 0 };
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) {
    return { ok: false as const, error: `${label} должно быть корректным числом.` };
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return { ok: false as const, error: `${label} должно быть конечным числом.` };
  }
  const rounded = Math.round(numeric * 100) / 100;
  if (!Number.isSafeInteger(Math.round(numeric * 100)) || Math.abs(numeric - rounded) > 1e-9) {
    return { ok: false as const, error: `${label} может содержать не более двух знаков после запятой.` };
  }
  return { ok: true as const, value: Object.is(rounded, -0) ? 0 : rounded };
};

const readRentalCreateFieldErrors = (body: Record<string, unknown> | null): RentalCreateFieldErrors => {
  const raw = body?.fieldErrors;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter((entry): entry is [RentalCreateField, string] => typeof entry[1] === 'string')
      .filter(([field]) => ['startDate', 'plannedReturnDate', 'dailyRate', 'rate', 'price', 'amount', 'discount', 'deposit'].includes(field)),
  );
};

const clientObjectLabel = (object: ClientObject) => {
  const name = String(object.name || '').trim();
  const address = String(object.address || '').trim();
  if (name && address) return `${name} · ${address}`;
  return name || address || 'Объект без названия';
};

const clientContractLabel = (contract: ClientContract) => {
  const number = String(contract.number || '').trim();
  const title = String(contract.title || '').trim();
  const date = String(contract.date || '').trim();
  if (number && date) return `${number} · ${date}`;
  return number || title || date || 'Договор без номера';
};

const managerOptionLabel = (manager: StaffOption) => {
  const name = String(manager.name || '').trim();
  const email = String((manager as StaffOption & { email?: unknown }).email || '').trim();
  return name || email || 'Менеджер без имени';
};

export default function RentalNew() {
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const clientsQuery = useClientsList();
  const clients = clientsQuery.data ?? [];
  const clientsLoaded = clientsQuery.data !== undefined;
  const clientObjectsQuery = useClientObjectsList();
  const clientObjects = clientObjectsQuery.data ?? [];
  const clientObjectsLoaded = clientObjectsQuery.data !== undefined;
  const clientContractsQuery = useClientContractsList();
  const clientContracts = clientContractsQuery.data ?? [];
  const clientContractsLoaded = clientContractsQuery.data !== undefined;
  const createClientObject = useCreateClientObject();
  const createClientContract = useCreateClientContract();
  const equipmentQuery = useEquipmentList();
  const rawEq = equipmentQuery.data ?? [];
  const equipmentLoaded = equipmentQuery.data !== undefined;
  const { data: ganttRentals = [] } = useGanttData();
  const { data: payments = [] } = usePaymentsList();
  const [managers, setManagers] = useState<StaffOption[]>([]);
  const [formError, setFormError] = useState('');
  const [rentalFieldErrors, setRentalFieldErrors] = useState<RentalCreateFieldErrors>({});
  const [submitNotice, setSubmitNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mountedRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const objectCreateInFlightRef = useRef(false);
  const contractCreateInFlightRef = useRef(false);
  const objectAttemptsRef = useRef(new Map<string, IdempotentAttempt>());
  const contractAttemptsRef = useRef(new Map<string, IdempotentAttempt>());
  const rentalAttemptsRef = useRef(new Map<string, IdempotentAttempt>());
  const clientContextVersionRef = useRef(0);
  const objectContextVersionRef = useRef(0);
  const contractContextVersionRef = useRef(0);
  const rentalContextVersionRef = useRef(0);
  const routeRequest = useMemo(
    () => parseRentalNewRoute({
      routerSearch: location.search,
      browserSearch: typeof window === 'undefined' ? '' : window.location.search,
    }),
    [location.key, location.search],
  );

  const allEq = useMemo(
    () => rawEq.filter(e => canEquipmentParticipateInRentals(e) && e.status !== 'inactive' && e.status !== 'in_service'),
    [rawEq],
  );
  const ganttRents = useMemo(() => ganttRentals, [ganttRentals]);
  const uniqueInventoryNumbers = useMemo(() => {
    const counts = new Map<string, number>();
    allEq.forEach(item => {
      if (!item.inventoryNumber) return;
      counts.set(item.inventoryNumber, (counts.get(item.inventoryNumber) || 0) + 1);
    });
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count === 1)
        .map(([inventoryNumber]) => inventoryNumber),
    );
  }, [allEq]);

  useEffect(() => {
    if (!can('create', 'rentals')) navigate('/rentals', { replace: true });
  }, []);

  useEffect(() => {
    let mounted = true;
    staffService.getManagerOptions()
      .then(users => {
        if (mounted) setManagers(filterRentalManagerUsers(users));
      })
      .catch(() => {
        if (mounted) setManagers([]);
      });
    return () => { mounted = false; };
  }, []);

  const today    = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const [client, setClient] = useState('');
  const [clientId, setClientId] = useState('');
  const [objectId, setObjectId] = useState('');
  const [contractId, setContractId] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(nextWeek);
  const [managerId, setManagerId] = useState('');
  const [manager, setManager] = useState('');
  const [dailyRate, setDailyRate] = useState('');
  const [deposit, setDeposit] = useState('');
  const [notes, setNotes] = useState('');
  const [showObjectCreator, setShowObjectCreator] = useState(false);
  const [newObjectName, setNewObjectName] = useState('');
  const [newObjectAddress, setNewObjectAddress] = useState('');
  const [newObjectContactName, setNewObjectContactName] = useState('');
  const [newObjectContactPhone, setNewObjectContactPhone] = useState('');
  const [newObjectComment, setNewObjectComment] = useState('');
  const [showContractCreator, setShowContractCreator] = useState(false);
  const [newContractDate, setNewContractDate] = useState(today);
  const [newContractTitle, setNewContractTitle] = useState('');
  const [relationError, setRelationError] = useState('');
  const [relationRefreshWarning, setRelationRefreshWarning] = useState('');
  const [creditRiskAcknowledged, setCreditRiskAcknowledged] = useState(false);
  const [authoritativeCreditRisk, setAuthoritativeCreditRisk] = useState<RentalCreditRiskSnapshot | null>(null);
  const [availabilityConflict, setAvailabilityConflict] = useState<RentalAvailabilityConflict | null>(null);
  const [locallyCreatedObjects, setLocallyCreatedObjects] = useState<ClientObject[]>([]);
  const [locallyCreatedContracts, setLocallyCreatedContracts] = useState<ClientContract[]>([]);

  const clearRentalFieldErrors = (...fields: RentalCreateField[]) => {
    setRentalFieldErrors(previous => {
      if (!fields.some(field => previous[field])) return previous;
      const next = { ...previous };
      fields.forEach(field => { delete next[field]; });
      return next;
    });
    setFormError('');
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const resetClientDependencies = () => {
    setObjectId('');
    setContractId('');
    clientContextVersionRef.current += 1;
    objectContextVersionRef.current += 1;
    contractContextVersionRef.current += 1;
    rentalContextVersionRef.current += 1;
    setShowObjectCreator(false);
    setShowContractCreator(false);
    setNewObjectName('');
    setNewObjectAddress('');
    setNewObjectContactName('');
    setNewObjectContactPhone('');
    setNewObjectComment('');
    setNewContractDate(today);
    setNewContractTitle('');
    setRelationError('');
    setRelationRefreshWarning('');
    setCreditRiskAcknowledged(false);
    setAuthoritativeCreditRisk(null);
    setFormError('');
    setRentalFieldErrors({});
    setSubmitNotice('');
  };

  const clientRouteResolution = useMemo(() => {
    if (!clientsLoaded) return { status: 'loading' as const, id: '', label: '' };
    if (routeRequest.client.kind === 'none' || !routeRequest.client.value) {
      return { status: 'empty' as const, id: '', label: '' };
    }
    if (routeRequest.client.kind !== 'id') {
      return { status: 'invalid' as const, id: '', label: '' };
    }
    const selected = clients.find(item => selectId(item.id) === routeRequest.client.value);
    if (!selected) return { status: 'invalid' as const, id: '', label: '' };
    return { status: 'valid' as const, id: selectId(selected.id), label: clientLabel(selected) };
  }, [clients, clientsLoaded, routeRequest.client.kind, routeRequest.client.value]);

  const equipmentRouteResolution = useMemo(() => {
    if (!equipmentLoaded) return { status: 'loading' as const, id: '' };
    if (routeRequest.equipment.kind === 'none' || !routeRequest.equipment.value) {
      return { status: 'empty' as const, id: '' };
    }
    const selected = routeRequest.equipment.kind === 'id'
      ? allEq.find(item => selectId(item.id) === routeRequest.equipment.value)
      : allEq.find(item => item.inventoryNumber === routeRequest.equipment.value);
    if (!selected) {
      const existsButUnavailable = routeRequest.equipment.kind === 'id'
        && rawEq.some(item => selectId(item.id) === routeRequest.equipment.value);
      return { status: existsButUnavailable ? 'unavailable' as const : 'invalid' as const, id: '' };
    }
    return { status: 'valid' as const, id: selectId(selected.id) };
  }, [allEq, equipmentLoaded, rawEq, routeRequest.equipment.kind, routeRequest.equipment.value]);

  const rentalDays = useMemo(() => getRentalDays(startDate, endDate), [startDate, endDate]);
  const parsedDailyRate = useMemo(() => parseRentalMoneyInput(dailyRate, 'Дневная ставка'), [dailyRate]);
  const totalPrice = useMemo(
    () => calculateRentalAmount(parsedDailyRate.ok ? parsedDailyRate.value : 0, startDate, endDate),
    [parsedDailyRate, startDate, endDate],
  );

  const { availableEq, busyEq } = useMemo(() => {
    if (!startDate || !endDate) return { availableEq: allEq, busyEq: [] };
    const av: typeof allEq = [];
    const bz: typeof allEq = [];
    allEq.forEach(eq => {
      if (isEquipmentBusy(eq, startDate, endDate, ganttRents, '', uniqueInventoryNumbers.has(eq.inventoryNumber))) bz.push(eq);
      else av.push(eq);
    });
    return { availableEq: av, busyEq: bz };
  }, [startDate, endDate, allEq, ganttRents, uniqueInventoryNumbers]);

  const selectedEquipment = allEq.find(e => e.id === equipmentId);
  useEffect(() => {
    if (equipmentRouteResolution.status === 'loading') return;
    const nextEquipmentId = equipmentRouteResolution.status === 'valid' ? equipmentRouteResolution.id : '';
    if (equipmentId === nextEquipmentId) return;
    rentalContextVersionRef.current += 1;
    setEquipmentId(nextEquipmentId);
    setAvailabilityConflict(null);
    setFormError('');
    setSubmitNotice('');
  }, [equipmentId, equipmentRouteResolution.id, equipmentRouteResolution.status]);

  useEffect(() => {
    if (clientRouteResolution.status === 'loading') return;
    const nextClientId = clientRouteResolution.status === 'valid' ? clientRouteResolution.id : '';
    const nextClientLabel = clientRouteResolution.status === 'valid' ? clientRouteResolution.label : '';
    if (clientId !== nextClientId) resetClientDependencies();
    if (clientId !== nextClientId) setClientId(nextClientId);
    if (client !== nextClientLabel) setClient(nextClientLabel);
  }, [client, clientId, clientRouteResolution.id, clientRouteResolution.label, clientRouteResolution.status]);

  useEffect(() => {
    if (!routeRequest.hasOuterRentalParams || typeof window === 'undefined') return;
    if (routeRequest.client.source === 'outer-legacy' || routeRequest.equipment.source === 'outer-legacy') return;
    const nextBrowserSearch = stripRentalNewOuterQuery(window.location.search);
    const nextUrl = `${window.location.pathname}${nextBrowserSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, [
    location.pathname,
    location.search,
    routeRequest.client.source,
    routeRequest.equipment.source,
    routeRequest.hasOuterRentalParams,
  ]);

  const handleClientSelection = (nextClientId: string) => {
    const selected = clients.find(item => selectId(item.id) === nextClientId);
    if (clientId !== nextClientId) resetClientDependencies();
    setClientId(nextClientId);
    setClient(selected ? clientLabel(selected) : '');
    const preservedEquipmentId = equipmentId || (
      routeRequest.equipment.kind === 'id' ? routeRequest.equipment.value : ''
    );
    navigate(buildRentalNewRoute({
      clientId: nextClientId,
      equipmentId: preservedEquipmentId,
    }), { replace: true });
  };

  const handleEquipmentSelection = (nextEquipmentId: string) => {
    if (equipmentId !== nextEquipmentId) rentalContextVersionRef.current += 1;
    setEquipmentId(nextEquipmentId);
    setAvailabilityConflict(null);
    setFormError('');
    setSubmitNotice('');
    const preservedClientId = clientId || (
      routeRequest.client.kind === 'id' ? routeRequest.client.value : ''
    );
    navigate(buildRentalNewRoute({
      clientId: preservedClientId,
      equipmentId: nextEquipmentId,
    }), { replace: true });
  };

  const selectedClient = clients.find(item => selectId(item.id) === clientId);
  const effectiveClientObjects = useMemo(() => {
    const merged = new Map(clientObjects.map(item => [selectId(item.id), item]));
    locallyCreatedObjects.forEach(item => merged.set(selectId(item.id), item));
    return [...merged.values()];
  }, [clientObjects, locallyCreatedObjects]);
  const effectiveClientContracts = useMemo(() => {
    const merged = new Map(clientContracts.map(item => [selectId(item.id), item]));
    locallyCreatedContracts.forEach(item => merged.set(selectId(item.id), item));
    return [...merged.values()];
  }, [clientContracts, locallyCreatedContracts]);
  const selectedClientObjects = useMemo(
    () => effectiveClientObjects.filter(item => selectId(item.clientId) === selectId(selectedClient?.id) && item.status !== 'archived'),
    [effectiveClientObjects, selectedClient?.id],
  );
  const objectOptions = useMemo(
    () => selectedClientObjects.map(object => ({
      id: selectId(object.id),
      label: clientObjectLabel(object),
    })),
    [selectedClientObjects],
  );
  const selectedClientContracts = useMemo(
    () => effectiveClientContracts.filter(item =>
      selectId(item.clientId) === selectId(selectedClient?.id) &&
      item.status !== 'archived' &&
      (!objectId || !item.objectId || selectId(item.objectId) === objectId)
    ),
    [effectiveClientContracts, objectId, selectedClient?.id],
  );
  const contractOptions = useMemo(
    () => selectedClientContracts.map(contract => ({
      id: selectId(contract.id),
      label: clientContractLabel(contract),
    })),
    [selectedClientContracts],
  );
  const managerOptions = useMemo(
    () => managers.map(item => ({
      id: selectId(item.id),
      label: managerOptionLabel(item),
    })),
    [managers],
  );
  const selectedManagerOption = managerOptions.find(option => option.id === managerId);
  useEffect(() => {
    if (!routeRequest.legacyObjectId || clientRouteResolution.status !== 'valid') return;
    const requestedObject = objectOptions.find(option => option.id === routeRequest.legacyObjectId);
    if (!requestedObject || objectId === requestedObject.id) return;
    objectContextVersionRef.current += 1;
    contractContextVersionRef.current += 1;
    rentalContextVersionRef.current += 1;
    setObjectId(requestedObject.id);
    setContractId('');
  }, [clientRouteResolution.status, objectId, objectOptions, routeRequest.legacyObjectId]);
  useEffect(() => {
    if (!routeRequest.legacyContractId || clientRouteResolution.status !== 'valid') return;
    const requestedContract = contractOptions.find(option => option.id === routeRequest.legacyContractId);
    if (requestedContract && contractId !== requestedContract.id) {
      contractContextVersionRef.current += 1;
      rentalContextVersionRef.current += 1;
      setContractId(requestedContract.id);
    }
  }, [clientRouteResolution.status, contractId, contractOptions, routeRequest.legacyContractId]);

  useEffect(() => {
    const clientCanNormalize = routeRequest.client.kind !== 'client-name'
      || clientRouteResolution.status === 'valid';
    const equipmentCanNormalize = routeRequest.equipment.kind !== 'equipment-inventory'
      || equipmentRouteResolution.status === 'valid';
    const objectPrefillSettled = !routeRequest.legacyObjectId || (
      clientObjectsLoaded && (
        clientRouteResolution.status !== 'valid'
        || !objectOptions.some(option => option.id === routeRequest.legacyObjectId)
        || objectId === routeRequest.legacyObjectId
      )
    );
    const contractPrefillSettled = !routeRequest.legacyContractId || (
      clientContractsLoaded && (
        clientRouteResolution.status !== 'valid'
        || !contractOptions.some(option => option.id === routeRequest.legacyContractId)
        || contractId === routeRequest.legacyContractId
      )
    );
    if (!clientCanNormalize || !equipmentCanNormalize || !objectPrefillSettled || !contractPrefillSettled) return;

    const normalizedClientId = routeRequest.client.kind === 'id'
      ? routeRequest.client.value
      : clientRouteResolution.status === 'valid' ? clientRouteResolution.id : '';
    const normalizedEquipmentId = routeRequest.equipment.kind === 'id'
      ? routeRequest.equipment.value
      : equipmentRouteResolution.status === 'valid' ? equipmentRouteResolution.id : '';
    const canonicalRoute = buildRentalNewRoute({
      clientId: normalizedClientId,
      equipmentId: normalizedEquipmentId,
    });
    if (`${location.pathname}${location.search}` !== canonicalRoute) {
      navigate(canonicalRoute, { replace: true });
    }
  }, [
    clientContractsLoaded,
    clientObjectsLoaded,
    clientRouteResolution.id,
    clientRouteResolution.status,
    contractId,
    contractOptions,
    equipmentRouteResolution.id,
    equipmentRouteResolution.status,
    location.pathname,
    location.search,
    navigate,
    objectId,
    objectOptions,
    routeRequest.client.kind,
    routeRequest.client.value,
    routeRequest.equipment.kind,
    routeRequest.equipment.value,
    routeRequest.legacyContractId,
    routeRequest.legacyObjectId,
  ]);
  const rentalDebtRows = useMemo(() => buildRentalDebtRows(ganttRents, payments), [ganttRents, payments]);
  const receivables = useMemo(() => buildClientReceivables(clients, rentalDebtRows), [clients, rentalDebtRows]);
  const selectedClientReceivable = receivables.find(item => Boolean(
    selectedClient?.counterpartyId
    && item.counterpartyId === selectedClient.counterpartyId
  ));
  const currentCreditRisk = authoritativeCreditRisk?.clientId === selectId(selectedClient?.id)
    ? authoritativeCreditRisk
    : null;
  const currentDebt = currentCreditRisk?.currentDebt
    ?? selectedClientReceivable?.currentDebt
    ?? selectedClient?.debt
    ?? 0;
  const currentCreditLimit = currentCreditRisk?.creditLimit ?? selectedClient?.creditLimit ?? 0;
  const currentUnpaidRentals = currentCreditRisk?.unpaidRentals ?? selectedClientReceivable?.unpaidRentals ?? 0;
  const currentOverdueRentals = currentCreditRisk?.overdueRentals ?? selectedClientReceivable?.overdueRentals ?? 0;
  const currentExceededLimit = currentCreditRisk?.exceededLimit ?? selectedClientReceivable?.exceededLimit ?? false;
  const requiresCreditRiskAcknowledgement = Boolean(
    currentCreditRisk?.requiresAcknowledgement
    ?? (currentOverdueRentals > 0 || currentExceededLimit),
  );
  const serverConflictApplies = Boolean(
    availabilityConflict
    && equipmentId
    && availabilityConflict.equipmentId === equipmentId
    && hasDateOverlap(startDate, endDate, availabilityConflict.startDate, availabilityConflict.endDate),
  );
  const conflictWarn = Boolean(equipmentId && (busyEq.some(e => e.id === equipmentId) || serverConflictApplies));
  const financialRiskReason = [
    currentOverdueRentals > 0 ? 'Есть просроченная задолженность' : '',
    currentExceededLimit ? 'Превышен кредитный лимит' : '',
  ].filter(Boolean).join(' · ');

  const handleCreateObject = async () => {
    if (objectCreateInFlightRef.current) return;
    setRelationError('');
    setRelationRefreshWarning('');
    if (!selectedClient || !newObjectName.trim()) {
      setRelationError('Для нового объекта укажите название.');
      return;
    }
    const payload = {
      counterpartyId: selectedClient.counterpartyId,
      clientId: selectId(selectedClient.id),
      name: newObjectName.trim(),
      address: newObjectAddress.trim() || undefined,
      contactName: newObjectContactName.trim() || undefined,
      contactPhone: newObjectContactPhone.trim() || undefined,
      comment: newObjectComment.trim() || undefined,
      status: 'active' as const,
    };
    const attempt = idempotencyKeyForAttempt('client-object', payload, objectAttemptsRef.current);
    const clientContextVersion = clientContextVersionRef.current;
    const objectContextVersion = objectContextVersionRef.current;
    objectCreateInFlightRef.current = true;
    try {
      const created = await createClientObject.mutateAsync({
        ...payload,
        idempotencyKey: attempt.key,
      });
      const createdObjectId = selectId(created?.id);
      if (!createdObjectId) throw new Error('Объект создан, но не удалось выбрать его в форме.');
      forgetIdempotentAttempt(attempt, objectAttemptsRef.current);
      const stillOwnsClientContext = mountedRef.current
        && clientContextVersionRef.current === clientContextVersion
        && objectContextVersionRef.current === objectContextVersion
        && clientId === payload.clientId;
      if (!stillOwnsClientContext) return;
      const createdObjectRecord = { ...created, id: createdObjectId };
      setLocallyCreatedObjects(current => [
        ...current.filter(item => selectId(item.id) !== createdObjectId),
        createdObjectRecord,
      ]);
      objectContextVersionRef.current += 1;
      contractContextVersionRef.current += 1;
      rentalContextVersionRef.current += 1;
      const selectedObjectContextVersion = objectContextVersionRef.current;
      setObjectId(createdObjectId);
      setContractId('');
      setNewObjectName('');
      setNewObjectAddress('');
      setNewObjectContactName('');
      setNewObjectContactPhone('');
      setNewObjectComment('');
      setShowObjectCreator(false);
      void refreshClientRelationCache(qc, CLIENT_OBJECT_KEYS.all).catch(() => {
        if (
          mountedRef.current
          && clientContextVersionRef.current === clientContextVersion
          && objectContextVersionRef.current === selectedObjectContextVersion
          && clientId === payload.clientId
        ) {
          setRelationRefreshWarning('Объект создан и выбран. Не удалось обновить список с сервера; можно продолжить заполнение.');
        }
      });
    } catch (error) {
      if (
        mountedRef.current
        && clientContextVersionRef.current === clientContextVersion
        && objectContextVersionRef.current === objectContextVersion
        && clientId === payload.clientId
      ) {
        setRelationError(error instanceof Error ? error.message : 'Не удалось создать объект клиента.');
      }
    } finally {
      objectCreateInFlightRef.current = false;
    }
  };

  const handleCreateContract = async () => {
    if (contractCreateInFlightRef.current) return;
    setRelationError('');
    setRelationRefreshWarning('');
    if (!selectedClient) {
      setRelationError('Для нового договора выберите клиента.');
      return;
    }
    const payload = {
      clientId: selectId(selectedClient.id),
      objectId: objectId || undefined,
      date: newContractDate || undefined,
      title: newContractTitle.trim() || undefined,
      status: 'active' as const,
    };
    const attempt = idempotencyKeyForAttempt('client-contract', payload, contractAttemptsRef.current);
    const clientContextVersion = clientContextVersionRef.current;
    const objectContextVersion = objectContextVersionRef.current;
    const contractContextVersion = contractContextVersionRef.current;
    contractCreateInFlightRef.current = true;
    try {
      const created = await createClientContract.mutateAsync({
        ...payload,
        idempotencyKey: attempt.key,
      });
      const createdContractId = selectId(created?.id);
      if (!createdContractId) throw new Error('Договор создан, но не удалось выбрать его в форме.');
      forgetIdempotentAttempt(attempt, contractAttemptsRef.current);
      const stillOwnsRelationContext = mountedRef.current
        && clientContextVersionRef.current === clientContextVersion
        && objectContextVersionRef.current === objectContextVersion
        && contractContextVersionRef.current === contractContextVersion
        && clientId === payload.clientId
        && objectId === selectId(payload.objectId);
      if (!stillOwnsRelationContext) return;
      const createdContractRecord = { ...created, id: createdContractId };
      setLocallyCreatedContracts(current => [
        ...current.filter(item => selectId(item.id) !== createdContractId),
        createdContractRecord,
      ]);
      contractContextVersionRef.current += 1;
      rentalContextVersionRef.current += 1;
      const selectedContractContextVersion = contractContextVersionRef.current;
      setContractId(createdContractId);
      setNewContractDate(today);
      setNewContractTitle('');
      setShowContractCreator(false);
      void refreshClientRelationCache(qc, CLIENT_CONTRACT_KEYS.all).catch(() => {
        if (
          mountedRef.current
          && clientContextVersionRef.current === clientContextVersion
          && objectContextVersionRef.current === objectContextVersion
          && contractContextVersionRef.current === selectedContractContextVersion
          && clientId === payload.clientId
          && objectId === selectId(payload.objectId)
        ) {
          setRelationRefreshWarning('Договор создан и выбран. Не удалось обновить список с сервера; можно продолжить заполнение.');
        }
      });
    } catch (error) {
      if (
        mountedRef.current
        && clientContextVersionRef.current === clientContextVersion
        && objectContextVersionRef.current === objectContextVersion
        && contractContextVersionRef.current === contractContextVersion
        && clientId === payload.clientId
        && objectId === selectId(payload.objectId)
      ) {
        setRelationError(error instanceof Error ? error.message : 'Не удалось создать договор клиента.');
      }
    } finally {
      contractCreateInFlightRef.current = false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitInFlightRef.current) return;
    setFormError('');
    setRentalFieldErrors({});
    setSubmitNotice('');
    if (!selectedClient) {
      setFormError('Выберите клиента.');
      return;
    }
    if (!selectedEquipment) {
      setFormError('Выберите технику.');
      return;
    }
    if (!startDate || !endDate) {
      setFormError('Укажите даты начала и окончания аренды.');
      return;
    }
    if (!contractId) {
      setFormError('Для аренды укажите договор.');
      return;
    }
    if (requiresCreditRiskAcknowledgement && !creditRiskAcknowledged) {
      setFormError('Подтвердите создание аренды с финансовым риском клиента.');
      return;
    }
    if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
      setFormError('Дата окончания аренды не может быть раньше даты начала.');
      return;
    }
    if (conflictWarn) {
      setFormError('Техника занята на выбранный период. Выберите другие даты или другую технику.');
      return;
    }
    const parsedDeposit = parseRentalMoneyInput(deposit, 'Залог');
    const clientFieldErrors: RentalCreateFieldErrors = {};
    if (!parsedDailyRate.ok) clientFieldErrors.dailyRate = parsedDailyRate.error;
    if (!parsedDeposit.ok) clientFieldErrors.deposit = parsedDeposit.error;
    if (!parsedDailyRate.ok || !parsedDeposit.ok) {
      setRentalFieldErrors(clientFieldErrors);
      setFormError(Object.values(clientFieldErrors)[0] || 'Проверьте финансовые поля аренды.');
      return;
    }
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    const rentalContextVersion = rentalContextVersionRef.current;
    const stillOwnsRentalContext = () => mountedRef.current
      && rentalContextVersionRef.current === rentalContextVersion;
    const todayStr = new Date().toISOString().split('T')[0];
    const initialStatus: GanttRentalData['status'] = startDate <= todayStr ? 'active' : 'created';

    const payload = {
      client: selectedClient.company,
      clientId: selectedClient.id,
      objectId: objectId || undefined,
      contractId: contractId || undefined,
      contact: '',
      startDate,
      plannedReturnDate: endDate,
      equipment: [selectedEquipment.inventoryNumber],
      equipmentId: selectedEquipment.id,
      equipmentInv: selectedEquipment.inventoryNumber,
      pricingMode: 'daily_rate' as const,
      dailyRate: parsedDailyRate.value,
      rate: `${parsedDailyRate.value} ₽/день`,
      price: totalPrice,
      discount: 0,
      deliveryAddress: '',
      manager,
      managerId: managerId || undefined,
      status: initialStatus,
      paymentStatus: 'unpaid',
      deposit: parsedDeposit.value,
      creditRiskAcknowledged,
      comments: notes,
    };
    const attempt = idempotencyKeyForAttempt(
      'rental-create',
      payload,
      rentalAttemptsRef.current,
      { persist: true },
    );

    try {
      const created = await rentalsService.create(payload, attempt.key);

      forgetIdempotentAttempt(attempt, rentalAttemptsRef.current, { persist: true });
      cacheCreatedRental(qc, created);
      void refreshRentalCreateCaches(qc, 'success');
      if (stillOwnsRentalContext()) {
        navigate('/rentals');
      } else if (mountedRef.current) {
        setSubmitNotice('Аренда создана для предыдущего состояния формы. Текущая форма не отправлена.');
      }
    } catch (error) {
      const body = error instanceof ApiError && error.body && typeof error.body === 'object'
        ? error.body as Record<string, unknown>
        : null;
      if (isUnknownMutationOutcome(error)) {
        if (stillOwnsRentalContext()) {
          setFormError('');
          setSubmitNotice('Ответ сервера не получен: аренда могла быть создана. Повторите отправку — тот же запрос будет безопасно подтверждён без дубликата.');
        }
      } else if (error instanceof ApiError && error.status === 409 && body?.code === 'CLIENT_CREDIT_RISK_ACKNOWLEDGEMENT_REQUIRED') {
        const risk = body.risk as RentalCreditRiskSnapshot | undefined;
        if (risk?.clientId) {
          cacheFinancialRiskConflict(qc, risk);
          await refreshRentalCreateCaches(qc, 'financialConflict');
          if (stillOwnsRentalContext()) {
            setAuthoritativeCreditRisk(risk);
            setCreditRiskAcknowledged(false);
          }
        }
      } else if (error instanceof ApiError && error.status === 409 && body?.code === 'EQUIPMENT_AVAILABILITY_CONFLICT') {
        const conflict = body.conflict as RentalAvailabilityConflict | undefined;
        if (conflict?.equipmentId && conflict.startDate && conflict.endDate) {
          cacheAvailabilityConflict(qc, conflict);
          await refreshRentalCreateCaches(qc, 'availabilityConflict');
          if (stillOwnsRentalContext()) setAvailabilityConflict(conflict);
        }
      } else if (error instanceof ApiError && error.status === 400 && body?.code === 'RENTAL_PAYLOAD_VALIDATION_FAILED') {
        if (stillOwnsRentalContext()) setRentalFieldErrors(readRentalCreateFieldErrors(body));
      }
      if (stillOwnsRentalContext() && !isUnknownMutationOutcome(error)) {
        setFormError(error instanceof Error ? error.message : 'Не удалось создать аренду.');
      }
    } finally {
      submitInFlightRef.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => navigate('/rentals')} aria-label="Назад к арендам" title="Назад к арендам">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="app-page-title">Новая аренда</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Создание договора аренды</p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Основная информация</CardTitle>
          <CardDescription>Заполните данные о договоре аренды</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <fieldset data-testid="rental-form-fields" disabled={isSubmitting} className="contents">

            {/* Client */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Клиент <span className="text-red-500">*</span></label>
              {clients.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-400">
                  Клиентов нет — добавьте в разделе «Клиенты»
                </p>
              ) : (
                <select
                  data-testid="rental-client-select"
                  className={relationSelectClass}
                  value={clientId}
                  onChange={(event) => handleClientSelection(event.target.value)}
                >
                  <option value="">Выберите клиента</option>
                  {clients.map(c => (
                    <option key={c.id} value={selectId(c.id)}>{c.company}</option>
                  ))}
                </select>
              )}
              {clientRouteResolution.status === 'invalid' && routeRequest.client.value && (
                <p data-testid="rental-client-route-error" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  Клиент из URL не найден: {routeRequest.client.value}. Выберите существующего клиента или вернитесь к списку клиентов.
                </p>
              )}
            </div>

            {selectedClient && (
              <div
                data-testid="client-financial-state"
                className={`rounded-lg border px-3 py-3 text-sm ${
                  currentExceededLimit || currentOverdueRentals > 0
                    ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300'
                    : currentDebt > 0
                      ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                      : 'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {currentOverdueRentals > 0
                        ? 'Внимание: у клиента есть просроченная задолженность'
                        : currentExceededLimit
                        ? 'Внимание: превышен кредитный лимит клиента'
                        : currentDebt > 0
                          ? 'У клиента есть действующая задолженность'
                          : 'У клиента нет активной задолженности'}
                    </p>
                    <p className="mt-1 text-xs opacity-90">
                      Условия оплаты: {selectedClient.paymentTerms || 'не указаны'}
                    </p>
                    {financialRiskReason && (
                      <p className="mt-1 text-xs font-medium" data-testid="financial-risk-reason">
                        Причина блокировки: {financialRiskReason}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-right">
                    <p className="text-xs uppercase tracking-wide opacity-75">Текущий долг</p>
                    <p className="text-base font-semibold" data-testid="financial-current-debt">{formatCurrency(currentDebt)}</p>
                    <p className="text-xs uppercase tracking-wide opacity-75">Кредитный лимит</p>
                    <p className="text-base font-semibold" data-testid="financial-credit-limit">{formatCurrency(currentCreditLimit)}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs opacity-90" data-testid="financial-rental-counts">
                  Неоплаченных аренд: {currentUnpaidRentals} · просроченных: {currentOverdueRentals}
                </p>
                {requiresCreditRiskAcknowledgement && (
                  <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-current/20 bg-white/60 p-2 text-xs dark:bg-black/10">
                    <input
                      data-testid="credit-risk-acknowledgement"
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={creditRiskAcknowledged}
                      onChange={(event) => setCreditRiskAcknowledged(event.target.checked)}
                    />
                    <span>
                      Подтверждаю создание аренды при просроченной задолженности или превышенном кредитном лимите.
                      Подтверждение будет записано в карточке аренды.
                    </span>
                  </label>
                )}
              </div>
            )}

            {selectedClient && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Объект клиента <span className="font-normal text-gray-500">(необязательно)</span></label>
                  <select
                    data-testid="rental-object-select"
                    className={relationSelectClass}
                    value={objectId}
                    onChange={(event) => {
                      const nextObjectId = event.target.value;
                      if (nextObjectId === '__create__') {
                        setShowObjectCreator(true);
                        setRelationError('');
                        return;
                      }
                      if (objectId !== nextObjectId) {
                        objectContextVersionRef.current += 1;
                        contractContextVersionRef.current += 1;
                        rentalContextVersionRef.current += 1;
                      }
                      setObjectId(nextObjectId);
                      setContractId('');
                      setRelationError('');
                      setRelationRefreshWarning('');
                      setSubmitNotice('');
                    }}
                  >
                    <option value="">Без объекта</option>
                    {objectOptions.map(option => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                    <option value="__create__">+ Добавить новый объект</option>
                  </select>
                  {selectedClientObjects.length === 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      У клиента пока нет объектов. Можно продолжить без объекта или добавить площадку.
                    </p>
                  )}
                  {showObjectCreator && (
                    <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                      <Input
                        placeholder="Например, ЖК Южный парк"
                        value={newObjectName}
                        onChange={(event) => setNewObjectName(event.target.value)}
                      />
                      <Input
                        placeholder="Казань, ул. ..."
                        value={newObjectAddress}
                        onChange={(event) => setNewObjectAddress(event.target.value)}
                      />
                      <Input placeholder="Иван Петров" value={newObjectContactName} onChange={(event) => setNewObjectContactName(event.target.value)} />
                      <Input type="tel" placeholder="+7 ..." value={newObjectContactPhone} onChange={(event) => setNewObjectContactPhone(event.target.value)} />
                      <textarea
                        className={`${relationSelectClass} min-h-20 py-2`}
                        placeholder="КПП №2, въезд со стороны..."
                        value={newObjectComment}
                        onChange={(event) => setNewObjectComment(event.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={handleCreateObject} disabled={createClientObject.isPending}>
                          {createClientObject.isPending ? 'Добавление…' : 'Сохранить объект'}
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => setShowObjectCreator(false)}>Отмена</Button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Договор <span className="text-red-500">*</span></label>
                  {contractOptions.length === 0 ? (
                    <p className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 dark:border-gray-700">
                      Для выбранного клиента{objectId ? ' и объекта' : ''} нет активных договоров. Добавьте договор прямо здесь.
                    </p>
                  ) : (
                    <select
                      data-testid="rental-contract-select"
                      className={relationSelectClass}
                      value={contractId}
                      onChange={(event) => {
                        if (contractId !== event.target.value) {
                          contractContextVersionRef.current += 1;
                          rentalContextVersionRef.current += 1;
                        }
                        setContractId(event.target.value);
                        setSubmitNotice('');
                      }}
                    >
                      <option value="">Выберите договор</option>
                      {contractOptions.map(option => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    className="self-start"
                    onClick={() => {
                      setShowContractCreator(value => !value);
                      setRelationError('');
                    }}
                  >
                    {showContractCreator ? 'Скрыть добавление' : 'Добавить договор'}
                  </Button>
                  {showContractCreator && (
                    <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                      <div className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        Номер договора будет присвоен после создания
                      </div>
                      <Input
                        type="date"
                        value={newContractDate}
                        onChange={(event) => setNewContractDate(event.target.value)}
                      />
                      <Input
                        placeholder="Название (необязательно)"
                        value={newContractTitle}
                        onChange={(event) => setNewContractTitle(event.target.value)}
                      />
                      <Button
                        type="button"
                        onClick={handleCreateContract}
                        disabled={createClientContract.isPending}
                      >
                        {createClientContract.isPending ? 'Добавление…' : 'Сохранить договор'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {relationError && (
              <div data-testid="relation-error" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                {relationError}
              </div>
            )}
            {relationRefreshWarning && (
              <div data-testid="relation-refresh-warning" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                {relationRefreshWarning}
              </div>
            )}

            {/* Dates — before equipment to check availability */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Дата начала <span className="text-red-500">*</span></label>
                <Input
                  type="date"
                  data-testid="rental-start-date"
                  value={startDate}
                  onChange={(e) => {
                    if (startDate !== e.target.value) rentalContextVersionRef.current += 1;
                    setStartDate(e.target.value);
                    setAvailabilityConflict(null);
                    clearRentalFieldErrors('startDate', 'plannedReturnDate', 'price', 'amount');
                    setSubmitNotice('');
                  }}
                  required
                />
                {rentalFieldErrors.startDate && (
                  <p data-testid="rental-start-date-error" className="text-xs text-red-600 dark:text-red-400">
                    {rentalFieldErrors.startDate}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Дата окончания <span className="text-red-500">*</span></label>
                <Input
                  type="date"
                  data-testid="rental-end-date"
                  value={endDate}
                  onChange={(e) => {
                    if (endDate !== e.target.value) rentalContextVersionRef.current += 1;
                    setEndDate(e.target.value);
                    setAvailabilityConflict(null);
                    clearRentalFieldErrors('startDate', 'plannedReturnDate', 'price', 'amount');
                    setSubmitNotice('');
                  }}
                  required
                />
                {rentalFieldErrors.plannedReturnDate && (
                  <p data-testid="rental-end-date-error" className="text-xs text-red-600 dark:text-red-400">
                    {rentalFieldErrors.plannedReturnDate}
                  </p>
                )}
              </div>
            </div>

            {/* Equipment */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Техника <span className="text-red-500">*</span></label>
              {allEq.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-400">
                  Сначала добавьте технику в реестр (раздел «Техника»)
                </p>
              ) : (
                <>
                  {availableEq.length === 0 && startDate && endDate && (
                    <p className="rounded-lg border border-dashed border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 text-sm text-orange-600 dark:text-orange-400">
                      Нет свободной техники на выбранный период
                    </p>
                  )}
                  <div data-testid="rental-equipment-select" data-equipment-id={equipmentId}>
                    <EquipmentCombobox
                      equipment={[...availableEq, ...busyEq]}
                      value={equipmentId}
                      valueKey="id"
                      onChange={handleEquipmentSelection}
                      groups={[
                        ...(availableEq.length > 0
                          ? [{ label: '✓ Доступна на выбранный период', items: availableEq }]
                          : []),
                        ...(busyEq.length > 0
                          ? [{ label: '⚠ Занята на выбранный период', items: busyEq }]
                          : []),
                      ]}
                    />
                  </div>
                  {conflictWarn && (
                    <p data-testid="equipment-availability-conflict" className="rounded-md border border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 text-xs text-orange-700 dark:text-orange-400">
                      ⚠ {serverConflictApplies && availabilityConflict
                        ? `Техника уже занята ${availabilityConflict.startDate} — ${availabilityConflict.endDate}${availabilityConflict.client ? ` (${availabilityConflict.client})` : ''}. Выберите другую технику или даты.`
                        : 'Техника занята на выбранный период — выберите другую технику или даты'}
                    </p>
                  )}
                </>
              )}
              {(equipmentRouteResolution.status === 'invalid' || equipmentRouteResolution.status === 'unavailable') && routeRequest.equipment.value && (
                <p data-testid="rental-equipment-route-error" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  {equipmentRouteResolution.status === 'unavailable'
                    ? `Техника из URL сейчас недоступна для аренды: ${routeRequest.equipment.value}. Выберите доступную технику.`
                    : `Техника из URL не найдена: ${routeRequest.equipment.value}. Выберите существующую технику или вернитесь к реестру.`}
                </p>
              )}
            </div>

            {/* Daily Rate + Deposit */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Менеджер</label>
                {managerOptions.length === 0 ? (
                  <p className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 dark:border-gray-700">
                    Нет доступных менеджеров для назначения.
                  </p>
                ) : (
                  <Select
                    value={managerId || 'none'}
                    onValueChange={(value) => {
                      if (value === 'none') {
                        setManagerId('');
                        setManager('');
                        return;
                      }
                      const selected = managers.find(item => selectId(item.id) === value);
                      const selectedLabel = selected ? managerOptionLabel(selected) : '';
                      setManagerId(value);
                      setManager(selectedLabel);
                    }}
                  >
                    <SelectTrigger>
                      {selectedManagerOption ? (
                        <span data-slot="select-value" className="truncate">{selectedManagerOption.label}</span>
                      ) : (
                        <SelectValue placeholder="Выберите менеджера" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Не назначен</SelectItem>
                      {managerOptions.map(option => (
                        <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Ставка в день (₽)</label>
                <Input
                  type="number"
                  data-testid="rental-daily-rate"
                  placeholder="0"
                  value={dailyRate}
                  onChange={(e) => {
                    setDailyRate(e.target.value);
                    clearRentalFieldErrors('dailyRate', 'rate', 'price', 'amount');
                    setSubmitNotice('');
                  }}
                />
                {(rentalFieldErrors.dailyRate || rentalFieldErrors.rate) && (
                  <p data-testid="rental-daily-rate-error" className="text-xs text-red-600 dark:text-red-400">
                    {rentalFieldErrors.dailyRate || rentalFieldErrors.rate}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Залог (₽)</label>
                <Input
                  type="number"
                  data-testid="rental-deposit"
                  placeholder="0"
                  value={deposit}
                  onChange={(e) => {
                    setDeposit(e.target.value);
                    clearRentalFieldErrors('deposit');
                    setSubmitNotice('');
                  }}
                />
                {rentalFieldErrors.deposit && (
                  <p data-testid="rental-deposit-error" className="text-xs text-red-600 dark:text-red-400">
                    {rentalFieldErrors.deposit}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/50">
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-500 dark:text-gray-400">
                  {rentalDays > 0 ? `Итого за ${rentalDays} дн.` : 'Итого'}
                </span>
                <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(totalPrice)}</span>
              </div>
              {(rentalFieldErrors.price || rentalFieldErrors.amount || rentalFieldErrors.discount) && (
                <p data-testid="rental-price-error" className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {rentalFieldErrors.price || rentalFieldErrors.amount || rentalFieldErrors.discount}
                </p>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Примечания
              </label>
              <textarea
                data-testid="rental-notes"
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                rows={3}
                placeholder="Дополнительная информация о договоре"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            </fieldset>

            {submitNotice && (
              <div data-testid="rental-submit-notice" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                {submitNotice}
              </div>
            )}

            {formError && (
              <div data-testid="rental-form-error" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                {formError}
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button data-testid="rental-submit" type="submit" disabled={isSubmitting || !client || !contractId || !equipmentId || !startDate || !endDate || conflictWarn || (requiresCreditRiskAcknowledgement && !creditRiskAcknowledged)}>
                {isSubmitting ? 'Создание…' : 'Создать аренду'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate('/rentals')}
              >
                Отмена
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
