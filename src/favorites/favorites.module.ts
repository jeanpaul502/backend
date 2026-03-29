import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { Favorite } from './entities/favorite.entity';
import { Movie } from '../movies/entities/movie.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Favorite, Movie])],
  controllers: [FavoritesController],
  providers: [FavoritesService],
})
export class FavoritesModule {}

