import { PartialType } from '@nestjs/mapped-types';
import { CreateAnnouncementDto } from './create-announcement.dto';
import { IsNumber, IsOptional } from 'class-validator';

export class UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto) {
  @IsNumber()
  @IsOptional()
  recallCount?: number;
}
