import { IsEnum, IsString, IsOptional, IsNumber } from 'class-validator';
import type {
  RequestType,
  NotificationMethod,
} from '../entities/request.entity';

export class CreateRequestDto {
  @IsEnum(['movie', 'series', 'tv_channel'])
  type: RequestType;

  @IsString()
  title: string;

  @IsNumber()
  @IsOptional()
  tmdbId?: number;

  @IsString()
  @IsOptional()
  poster?: string;

  @IsString()
  @IsOptional()
  overview?: string;

  @IsString()
  @IsOptional()
  releaseDate?: string;

  @IsEnum(['whatsapp', 'email', 'telegram'])
  @IsOptional()
  notificationMethod?: NotificationMethod;

  @IsString()
  @IsOptional()
  contactInfo?: string;

  @IsString()
  @IsOptional()
  userId?: string;
}
