import { IsString, IsNotEmpty, IsNumber, IsOptional, IsBoolean, IsArray, IsIn } from 'class-validator';

export class CreateMovieDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  poster: string;

  @IsString()
  @IsNotEmpty()
  coverImage: string;

  @IsString()
  @IsNotEmpty()
  titleLogo: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  ageRating: string;

  @IsNumber()
  score: number;

  @IsNumber()
  @IsOptional()
  voteCount?: number;

  @IsString()
  @IsNotEmpty()
  section: string;

  @IsArray()
  @IsString({ each: true })
  genres: string[];

  @IsString()
  @IsNotEmpty()
  releaseDate: string;

  @IsBoolean()
  isTop10: boolean;

  @IsBoolean()
  isHero: boolean;

  @IsString()
  @IsIn(['active', 'inactive', 'scheduled'])
  status: 'active' | 'inactive' | 'scheduled';

  @IsString()
  @IsOptional()
  scheduledDate?: string;

  @IsString()
  @IsOptional()
  badge?: string;

  @IsString()
  @IsOptional()
  videoUrl?: string;

  @IsString()
  @IsOptional()
  director?: string;

  @IsArray()
  @IsOptional()
  cast?: { name: string; image: string }[];

  @IsString()
  @IsOptional()
  duration?: string;
}
