export function getEquipmentTotalPages(totalVisible: number, pageSize: number) {
  return Math.max(1, Math.ceil(totalVisible / pageSize));
}

export function clampEquipmentPage(page: number, totalPages: number) {
  return Math.min(Math.max(page, 1), totalPages);
}

export function getEquipmentPageRange(totalVisible: number, currentPage: number, pageSize: number) {
  const totalPages = getEquipmentTotalPages(totalVisible, pageSize);
  const visibleCurrentPage = clampEquipmentPage(currentPage, totalPages);
  const pageStart = totalVisible === 0 ? 0 : (visibleCurrentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(totalVisible, visibleCurrentPage * pageSize);

  return { totalPages, visibleCurrentPage, pageStart, pageEnd };
}

export function getEquipmentPageItems<T>(items: T[], currentPage: number, pageSize: number) {
  return items.slice((currentPage - 1) * pageSize, currentPage * pageSize);
}
