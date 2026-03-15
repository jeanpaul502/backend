import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { CreateMovieDto } from './dto/create-movie.dto';

@Injectable()
export class TmdbService {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.themoviedb.org/3';
  private readonly imageBaseUrl = 'https://image.tmdb.org/t/p/original';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('TMDB_API_KEY') || '';
  }

  async searchMovies(query: string) {
    if (!this.apiKey) {
      throw new HttpException(
        'TMDB API Key not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const url = `${this.baseUrl}/search/movie`;
      const response = await lastValueFrom(
        this.httpService.get(url, {
          params: {
            api_key: this.apiKey,
            query: query,
            language: 'fr-FR',
          },
        }),
      );

      return response.data.results.map((movie) => ({
        id: movie.id,
        title: movie.title,
        releaseDate: movie.release_date,
        poster: movie.poster_path
          ? `${this.imageBaseUrl}${movie.poster_path}`
          : null,
        overview: movie.overview,
        type: 'movie',
      }));
    } catch (error) {
      throw new HttpException(
        'Failed to fetch from TMDB',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async searchSeries(query: string) {
    if (!this.apiKey) {
      throw new HttpException(
        'TMDB API Key not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const url = `${this.baseUrl}/search/tv`;
      const response = await lastValueFrom(
        this.httpService.get(url, {
          params: {
            api_key: this.apiKey,
            query: query,
            language: 'fr-FR',
          },
        }),
      );

      return response.data.results.map((show) => ({
        id: show.id,
        title: show.name, // TV shows use 'name' instead of 'title'
        releaseDate: show.first_air_date,
        poster: show.poster_path
          ? `${this.imageBaseUrl}${show.poster_path}`
          : null,
        overview: show.overview,
        type: 'series',
      }));
    } catch (error) {
      throw new HttpException(
        'Failed to fetch from TMDB',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async getMovieDetails(tmdbId: string): Promise<Partial<CreateMovieDto>> {
    if (!this.apiKey) {
      throw new HttpException(
        'TMDB API Key not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const url = `${this.baseUrl}/movie/${tmdbId}`;
      const response = await lastValueFrom(
        this.httpService.get(url, {
          params: {
            api_key: this.apiKey,
            language: 'fr-FR',
            append_to_response: 'images,credits,release_dates',
            include_image_language: 'fr,en,null',
          },
        }),
      );

      const data = response.data;

      // Extract certification (Age Rating)
      let ageRating = 'Inconnu'; // Default fallback

      // Try to find French certification first
      const frRelease = data.release_dates?.results?.find(
        (r) => r.iso_3166_1 === 'FR',
      );
      const frCert = frRelease?.release_dates?.find(
        (d) => d.certification,
      )?.certification;

      if (frCert) {
        switch (frCert) {
          case 'U':
          case 'TP':
            ageRating = 'Tout public';
            break;
          case '10':
            ageRating = '10+';
            break;
          case '12':
            ageRating = '12+';
            break;
          case '16':
            ageRating = '16+';
            break;
          case '18':
            ageRating = '18+';
            break;
          default:
            // If it's a number, append +
            if (!isNaN(Number(frCert))) {
              ageRating = `${frCert}+`;
            } else {
              ageRating = frCert;
            }
            break;
        }
      } else {
        // Fallback to US certification and map it
        const usRelease = data.release_dates?.results?.find(
          (r) => r.iso_3166_1 === 'US',
        );
        const usCert = usRelease?.release_dates?.find(
          (d) => d.certification,
        )?.certification;

        if (usCert) {
          switch (usCert) {
            case 'G':
            case 'PG':
            case 'TV-Y':
            case 'TV-Y7':
            case 'TV-G':
            case 'TV-PG':
              ageRating = 'Tout public';
              break;
            case 'PG-13':
            case 'TV-14':
              ageRating = '12+';
              break;
            case 'R':
            case 'TV-MA':
              ageRating = '16+';
              break;
            case 'NC-17':
              ageRating = '18+';
              break;
            default:
              ageRating = usCert; // Keep original if unknown
          }
        } else {
          // Final fallback based on genres if no certification found
          const genreNames =
            data.genres?.map((g) => g.name.toLowerCase()) || [];
          if (
            genreNames.some((g) =>
              ['animation', 'familial', 'family'].includes(g),
            )
          ) {
            ageRating = 'Tout public';
          } else if (
            genreNames.some((g) =>
              ['horreur', 'horror', 'crime', 'war', 'guerre'].includes(g),
            )
          ) {
            ageRating = '16+'; // Safe default for mature genres
          } else {
            ageRating = '12+'; // Standard default
          }
        }
      }

      // Map genres
      const genres = data.genres?.map((g) => g.name) || [];

      // Extract Director
      const director =
        data.credits?.crew?.find((c) => c.job === 'Director')?.name ||
        'Inconnu';

      // Extract Cast (Top 100 to get real remaining count)
      const cast =
        data.credits?.cast?.slice(0, 20).map((actor) => ({
          name: actor.name,
          image: actor.profile_path
            ? `https://image.tmdb.org/t/p/w185${actor.profile_path}`
            : '',
          profile_path: actor.profile_path,
        })) || [];

      // Find Logo (from images.logos)
      // Priority: French -> English -> No Language (often international/universal) -> Any
      // Note: We requested 'fr,en,null' in include_image_language
      const logos = data.images?.logos || [];
      const logo =
        logos.find((l) => l.iso_639_1 === 'fr') ||
        logos.find((l) => l.iso_639_1 === 'en') ||
        logos.find(
          (l) =>
            l.iso_639_1 === null || l.iso_639_1 === 'xx' || l.iso_639_1 === '',
        ) ||
        logos[0];

      return {
        title: data.title,
        description: data.overview,
        poster: data.poster_path
          ? `${this.imageBaseUrl}${data.poster_path}`
          : '',
        coverImage: data.backdrop_path
          ? `${this.imageBaseUrl}${data.backdrop_path}`
          : '',
        titleLogo: logo ? `${this.imageBaseUrl}${logo.file_path}` : '',
        releaseDate: data.release_date,
        director: director,
        cast: cast,
        duration: this.formatDuration(data.runtime),
        score: Math.round(data.vote_average * 10) / 10,
        voteCount: data.vote_count,
        ageRating: ageRating,
        genres: genres,
        section: 'Tendances', // Default
        isTop10: false,
        isHero: false,
        status: 'active',
      };
    } catch (error) {
      throw new HttpException(
        'Failed to fetch details from TMDB',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private formatDuration(minutes: number): string {
    if (!minutes) return '0h 00min';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m.toString().padStart(2, '0')}min`;
  }
}
