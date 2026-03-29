import { Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
@UseGuards(AuthGuard('jwt'))
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get('ids')
  getIds(@Request() req: any) {
    return this.favoritesService.getFavoriteIds(req.user.userId);
  }

  @Get()
  getMovies(@Request() req: any) {
    return this.favoritesService.getFavoriteMovies(req.user.userId);
  }

  @Post(':movieId')
  add(@Request() req: any, @Param('movieId') movieId: string) {
    return this.favoritesService.addFavorite(req.user.userId, movieId);
  }

  @Delete(':movieId')
  remove(@Request() req: any, @Param('movieId') movieId: string) {
    return this.favoritesService.removeFavorite(req.user.userId, movieId);
  }
}

