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
export { serviceWorksService } from './service-works.service';
export { sparePartsService } from './spare-parts.service';
export { repairWorkItemsService } from './repair-work-items.service';
export { repairPartItemsService } from './repair-part-items.service';
export { reportsService } from './reports.service';
export { plannerService } from './planner.service';
export { serviceVehiclesService } from './service-vehicles.service';
