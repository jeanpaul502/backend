import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Session } from '../users/entities/session.entity';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (user && user.password && (await bcrypt.compare(pass, user.password))) {
      if (user.accountStatus === 'blocked') {
        throw new UnauthorizedException(
          'Votre compte a été bloqué. Veuillez contacter le support.',
        );
      }
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any, sessionData?: any) {
    // 1. Create/Update Session FIRST to get the ID
    let session: Session | null = null;
    if (sessionData) {
      session = await this.usersService.createSession(user.id, {
        ...sessionData,
        isOnline: true,
        lastActive: new Date(),
      });
    }

    // 2. Sign Token with Session ID
    const payload = {
      email: user.email,
      sub: user.id,
      sid: session ? session.id : null,
    };
    const token = this.jwtService.sign(payload);

    // 3. Update session with token
    if (session) {
      // Re-save with token. Since we use upsert logic in createSession based on deviceId,
      // we can call it again or we should have a specific update method.
      // However, since we have the session object, let's just use a direct update if possible
      // or call createSession again.
      // To be safe and consistent with the new upsert logic:
      await this.usersService.createSession(user.id, {
        deviceId: sessionData.deviceId,
        token: token,
      });
    }

    return {
      access_token: token,
      user: user,
    };
  }
}
