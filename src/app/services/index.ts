// Единая точка импорта всех сервисов.
// При переходе на реальный API меняются только файлы сервисов,
// а не все компоненты/хуки, которые их используют.

export { equipmentService } from './equipment.service';
export { rentalsService } from './rentals.service';
export { clientsService } from './clients.service';
export { serviceTicketsService } from './service-tickets.service';
export { paymentsService } from './payments.service';
export { documentsService } from './documents.service';
export { usersService } from './users.service';
export { ownersService } from './owners.service';
export { mechanicsService } from './mechanics.service';
export { serviceWorkCatalogService } from './service-work-catalog.service';
export { sparePartsCatalogService } from './spare-parts-catalog.service';
