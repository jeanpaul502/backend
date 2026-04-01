import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Favorite } from './entities/favorite.entity';
import { Movie } from '../movies/entities/movie.entity';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(Favorite)
    private favoritesRepository: Repository<Favorite>,
    @InjectRepository(Movie)
    private moviesRepository: Repository<Movie>,
  ) {}

  async getFavoriteIds(userId: string): Promise<string[]> {
    const rows = await this.favoritesRepository.find({
      where: { userId },
      select: { movieId: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => r.movieId);
  }

  async getFavoriteMovies(userId: string): Promise<Movie[]> {
    const qb = this.moviesRepository
      .createQueryBuilder('movie')
      .innerJoin(
        Favorite,
        'fav',
        'fav.movieId = movie.id AND fav.userId = :userId',
        {
          userId,
        },
      )
      .orderBy('fav.createdAt', 'DESC');

    return qb.getMany();
  }

  async addFavorite(
    userId: string,
    movieId: string,
  ): Promise<{ added: boolean }> {
    const movie = await this.moviesRepository.findOne({
      where: { id: movieId },
    });
    if (!movie) {
      throw new NotFoundException('Film introuvable');
    }

    const existing = await this.favoritesRepository.findOne({
      where: { userId, movieId },
    });
    if (existing) return { added: false };

    const favorite = this.favoritesRepository.create({ userId, movieId });
    await this.favoritesRepository.save(favorite);
    return { added: true };
  }

  async removeFavorite(
    userId: string,
    movieId: string,
  ): Promise<{ removed: boolean }> {
    const result = await this.favoritesRepository.delete({ userId, movieId });
    return { removed: (result.affected || 0) > 0 };
  }

  async toggleFavorite(
    userId: string,
    movieId: string,
  ): Promise<{ favorited: boolean }> {
    const existing = await this.favoritesRepository.findOne({
      where: { userId, movieId },
    });
    if (existing) {
      await this.favoritesRepository.delete({ userId, movieId });
      return { favorited: false };
    }
    await this.addFavorite(userId, movieId);
    return { favorited: true };
  }
}
