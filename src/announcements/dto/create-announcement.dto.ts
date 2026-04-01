import { IsString, IsArray, IsBoolean, IsOptional } from 'class-validator';

export class CreateAnnouncementDto {
  @IsBoolean()
  @IsOptional()
  isUpdate?: boolean;

  @IsString()
  @IsOptional()
  version?: string;

  @IsString()
  title: string;

  @IsArray()
  @IsString({ each: true })
  features: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  hasAndroidApp?: boolean;

  @IsString()
  @IsOptional()
  androidAppUrl?: string;
}
