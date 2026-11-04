import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { PHONE_E164 } from '../auth/dto/auth.dto';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normPhone = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value);

export class CreateAddressDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) label?: string;
  @Transform(trim) @IsString() @Length(2, 100) recipientName!: string;
  @Transform(normPhone) @Matches(PHONE_E164, { message: 'Phone must include the country code, e.g. +250788123456' }) phone!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^[A-Z]{2}$/, { message: 'Country must be an ISO alpha-2 code' }) country!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) region?: string;
  @Transform(trim) @IsString() @Length(2, 100) city!: string;
  @Transform(trim) @IsString() @Length(3, 200) street!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(20) postalCode?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
export class UpdateAddressDto extends PartialType(CreateAddressDto) {}

@ApiTags('Addresses')
@ApiBearerAuth()
@Controller('users/me/addresses')
export class AddressesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.address.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
  }

  @Post()
  async create(@Body() dto: CreateAddressDto, @CurrentUser() user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId: user.id } });
      if (count >= 20) throw new ForbiddenException('You can save at most 20 addresses');
      const makeDefault = dto.isDefault === true || count === 0;
      if (makeDefault) await tx.address.updateMany({ where: { userId: user.id, isDefault: true }, data: { isDefault: false } });
      return tx.address.create({ data: { ...dto, label: dto.label ?? 'Home', userId: user.id, isDefault: makeDefault } });
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAddressDto, @CurrentUser() user: AuthUser) {
    await this.own(id, user.id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.address.updateMany({ where: { userId: user.id, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: dto });
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const addr = await this.own(id, user.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });
      if (addr.isDefault) {
        const next = await tx.address.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  private async own(id: string, userId: string) {
    const addr = await this.prisma.address.findFirst({ where: { id, userId } });
    if (!addr) throw new NotFoundException('Address not found');
    return addr;
  }
}
