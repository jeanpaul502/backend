import { PartialType } from '@nestjs/mapped-types';
import { CreateMovieDto } from './create-movie.dto';
import { IsOptional, IsString, IsNumber, IsBoolean, IsArray, IsIn } from 'class-validator';

export class UpdateMovieDto extends PartialType(CreateMovieDto) {
  @IsOptional()
  @IsString()
  tmdbId?: string;

  @IsOptional()
  @IsString()
  backdropPath?: string;

  @IsOptional()
  @IsString()
  trailerKey?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsNumber()
  popularity?: number;

  @IsOptional()
  @IsArray()
  cast?: any[];

  @IsOptional()
  @IsString()
  director?: string;
}

