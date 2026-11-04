import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 20;
}

export const paginate = (q: PaginationQuery) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });

export const pageResult = <T>(items: T[], total: number, q: PaginationQuery) => ({
  items,
  total,
  page: q.page,
  pageSize: q.pageSize,
  totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
});
