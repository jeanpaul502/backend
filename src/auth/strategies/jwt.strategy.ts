import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('token'),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'defaultSecret',
    });
  }

  async validate(payload: any) {
    if (payload.sid) {
      const session = await this.usersService.findSessionById(payload.sid);
      if (!session) {
        throw new UnauthorizedException('Session invalide ou expirée');
      }
      // Note: We don't update activity here on every request to avoid DB spam.
      // We rely on /heartbeat or specific actions.
      // But keeping it for now as per previous logic, or maybe optimize it?
      // Actually, if we have heartbeat, we might not need this on EVERY request.
      // But let's keep it safe for now.
      await this.usersService.updateSessionActivity(payload.sid, payload.sub);
    }

    // Check user status
    const user = await this.usersService.findOne(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }
    if (user.accountStatus === 'blocked') {
      throw new UnauthorizedException(
        'Votre compte a été bloqué. Veuillez contacter le support.',
      );
    }

    return { userId: payload.sub, email: payload.email, sid: payload.sid };
  }
}
