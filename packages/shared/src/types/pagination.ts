export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginationMeta extends PaginationParams {
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface PaginatedResult<TItem> {
  items: TItem[];
  pagination: PaginationMeta;
}

export type SortDirection = 'asc' | 'desc';

export interface SortParams<TField extends string = string> {
  sortBy: TField;
  sortDirection: SortDirection;
}
