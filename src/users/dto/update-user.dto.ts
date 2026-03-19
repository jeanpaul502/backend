import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsOptional, IsString, IsEnum, IsBoolean } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsOptional()
  @IsEnum(['free', 'premium', 'vip'])
  subscriptionType?: string;

  @IsOptional()
  subscriptionEndDate?: Date | null;

  @IsOptional()
  @IsEnum(['user', 'admin'])
  role?: string;

  @IsOptional()
  @IsEnum(['active', 'blocked'])
  accountStatus?: string;

  @IsOptional()
  @IsString()
  profilePicture?: string;

  @IsOptional()
  @IsString()
  whatsappPhone?: string;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;
}
