import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const normPhone = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value);

export const PHONE_E164 = /^\+[1-9]\d{6,14}$/;
const PASSWORD_MSG = 'Password must be 10-128 characters and contain at least one letter and one number';

export class RegisterDto {
  @Transform(trim) @IsString() @Length(2, 100) fullName!: string;
  @Transform(normEmail) @IsEmail() @MaxLength(254) email!: string;
  @Transform(normPhone) @Matches(PHONE_E164, { message: 'Phone must include the country code, e.g. +250788123456' }) phone!: string;

  @IsString() @MinLength(10, { message: PASSWORD_MSG }) @MaxLength(128, { message: PASSWORD_MSG })
  @Matches(/[A-Za-z]/, { message: PASSWORD_MSG }) @Matches(/\d/, { message: PASSWORD_MSG })
  password!: string;

  @IsString() confirmPassword!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{2}$/, { message: 'Country must be an ISO 3166-1 alpha-2 code, e.g. RW' })
  country!: string;

  @Transform(trim) @IsString() @Length(3, 200) addressLine!: string;
  @Transform(trim) @IsString() @Length(2, 100) city!: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) region?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
}

export class VerifyOtpDto {
  @Transform(normEmail) @IsEmail() email!: string;
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' }) code!: string;
}

export class ResendOtpDto {
  @Transform(normEmail) @IsEmail() email!: string;
}

export class LoginDto {
  /** Email address or E.164 phone number */
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(254) identifier!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password!: string;
}

export class LoginOtpRequestDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(254) identifier!: string;
}

export class LoginOtpVerifyDto extends LoginOtpRequestDto {
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' }) code!: string;
}

export class ForgotPasswordDto {
  @Transform(normEmail) @IsEmail() email!: string;
}

export class ResetPasswordDto {
  @Transform(normEmail) @IsEmail() email!: string;
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' }) code!: string;

  @IsString() @MinLength(10, { message: PASSWORD_MSG }) @MaxLength(128, { message: PASSWORD_MSG })
  @Matches(/[A-Za-z]/, { message: PASSWORD_MSG }) @Matches(/\d/, { message: PASSWORD_MSG })
  newPassword!: string;
}
