import {
  Controller,
  Post,
  UseGuards,
  Request,
  Body,
  UnauthorizedException,
  Get,
  Patch,
  Delete,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    private configService: ConfigService,
  ) {}

  @UseGuards(AuthGuard('local'))
  @Post('login')
  async login(@Request() req, @Body() body: any) {
    const {
      device,
      os,
      location,
      deviceId,
      city,
      country,
      countryCode,
      ipAddress,
      browser,
      deviceType,
    } = body;

    const serverIp = this.extractClientIp(req);
    const clientIp =
      typeof ipAddress === 'string' && ipAddress.trim() ? ipAddress.trim() : '';
    const finalIp = this.isPublicIp(serverIp)
      ? serverIp
      : this.isPublicIp(clientIp)
        ? clientIp
        : serverIp || clientIp || 'Unknown';

    const ua = String(req.headers['user-agent'] || '').trim();
    const parsedDevice =
      device || os || browser || deviceType ? null : this.parseUserAgent(ua);

    const geo =
      country || city || countryCode || location
        ? null
        : await this.lookupGeo(finalIp);

    return this.authService.login(req.user, {
      device: device || parsedDevice?.device || 'Inconnu',
      os: os || parsedDevice?.os,
      browser: browser || parsedDevice?.browser,
      deviceType: deviceType || parsedDevice?.deviceType,
      location: location || geo?.location,
      deviceId,
      city: city || geo?.city,
      country: country || geo?.country,
      countryCode: countryCode || geo?.countryCode,
      ipAddress: finalIp,
    });
  }

  private normalizeIp(raw: unknown): string {
    let ip = typeof raw === 'string' ? raw.trim() : '';
    if (!ip) return '';
    if (ip.includes(',')) ip = ip.split(',')[0].trim();
    if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
    if (ip === '::1') ip = '127.0.0.1';
    return ip;
  }

  private extractClientIp(req: any): string {
    const candidates = [
      req.headers?.['cf-connecting-ip'],
      req.headers?.['x-real-ip'],
      req.headers?.['x-forwarded-for'],
      req.ip,
      req.socket?.remoteAddress,
    ];
    for (const c of candidates) {
      const ip = this.normalizeIp(c);
      if (ip) return ip;
    }
    return '';
  }

  private isPublicIp(ip: string): boolean {
    if (!ip) return false;
    if (ip.startsWith('127.')) return false;
    if (ip.startsWith('10.')) return false;
    if (ip.startsWith('192.168.')) return false;
    if (ip.startsWith('172.16.')) return false;
    if (ip.startsWith('172.17.')) return false;
    if (ip.startsWith('172.18.')) return false;
    if (ip.startsWith('172.19.')) return false;
    if (ip.startsWith('172.2')) return false; // 172.20-172.29
    if (ip.startsWith('172.3')) return false; // 172.30-172.31
    if (ip === '::1') return false;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return false; // IPv6 ULA
    if (ip.startsWith('fe80:')) return false; // IPv6 link-local
    return true;
  }

  private parseUserAgent(ua: string): {
    device: string;
    os?: string;
    browser?: string;
    deviceType?: string;
  } | null {
    if (!ua) return null;

    let browser = 'Unknown';
    if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Chrome/')) browser = 'Chrome';
    else if (ua.includes('Firefox/')) browser = 'Firefox';
    else if (ua.includes('Safari/') && !ua.includes('Chrome/'))
      browser = 'Safari';

    let os = 'Unknown OS';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Android')) os = 'Android';
    else if (
      ua.includes('iPhone') ||
      ua.includes('iPad') ||
      ua.includes('iPod')
    )
      os = 'iOS';
    else if (ua.includes('Mac OS X')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';

    const isMobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
    const isTablet = /iPad|Tablet/i.test(ua);
    const deviceType = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

    const device =
      deviceType === 'mobile'
        ? 'Téléphone'
        : deviceType === 'tablet'
          ? 'Tablette'
          : 'Ordinateur';

    return { device, os, browser, deviceType };
  }

  private async lookupGeo(ip: string): Promise<{
    location: string;
    city: string;
    country: string;
    countryCode: string;
  } | null> {
    if (!this.isPublicIp(ip)) return null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const url = `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code,city`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      const data: any = await res.json().catch(() => null);
      if (!data?.success) return null;
      const country = String(data.country || '').trim();
      const city = String(data.city || '').trim();
      const countryCode = String(data.country_code || '').trim();
      const location =
        country && city ? `${country}, ${city}` : country || city || '';
      return { country, city, countryCode, location };
    } catch {
      return null;
    }
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  async logout(@Request() req) {
    if (req.user.sid) {
      await this.usersService.deleteSession(req.user.sid, req.user.userId);
    }
    return { message: 'Déconnecté' };
  }

  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    return await this.usersService.create(createUserDto);
  }

  @Get('community-links')
  getCommunityLinks() {
    return {
      whatsappUrl: String(
        this.configService.get('COMMUNITY_WHATSAPP_URL') || '',
      ),
      telegramUrl: String(
        this.configService.get('COMMUNITY_TELEGRAM_URL') || '',
      ),
      discordUrl: String(this.configService.get('COMMUNITY_DISCORD_URL') || ''),
      redditUrl: String(this.configService.get('COMMUNITY_REDDIT_URL') || ''),
    };
  }

  @Post('verify-email')
  async verifyEmail(@Body() body: { email: string; code: string }) {
    await this.usersService.verifyEmail(body.email, body.code);
    return { message: 'Email verified' };
  }

  @Post('resend-verification-code')
  async resendVerificationCode(@Body() body: { email: string }) {
    await this.usersService.resendVerificationCode(body.email);
    return { message: 'Code resent' };
  }

  @Post('forgot-password')
  async forgotPassword(@Body('email') email: string) {
    await this.usersService.generateResetCode(email);
    return { message: 'Code sent' };
  }

  @Post('verify-code')
  async verifyCode(@Body() body: { email: string; code: string }) {
    const isValid = await this.usersService.verifyResetCode(
      body.email,
      body.code,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    return { valid: true };
  }

  @Post('reset-password')
  async resetPassword(
    @Body() body: { email: string; code: string; newPassword: string },
  ) {
    const isValid = await this.usersService.verifyResetCode(
      body.email,
      body.code,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid code');
    }
    await this.usersService.resetPassword(body.email, body.newPassword);
    return { message: 'Password updated' };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('change-password')
  async changePassword(
    @Request() req,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    await this.usersService.changePassword(
      req.user.userId,
      body.currentPassword,
      body.newPassword,
    );
    return { message: 'Password updated successfully' };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async getMe(@Request() req) {
    const user = await this.usersService.findByEmail(req.user.email);
    if (user) {
      const { password, ...result } = user;
      return { user: result };
    }
    return null;
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('profile')
  async getProfile(@Request() req) {
    const user = await this.usersService.findByEmail(req.user.email);
    if (user) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('profile')
  async updateProfile(
    @Request() req,
    @Body()
    body: {
      firstName?: string;
      lastName?: string;
      profilePicture?: string;
      emailNotifications?: boolean;
      whatsappPhone?: string;
      telegramChatId?: string;
      telegramUsername?: string;
      whatsappPhone2?: string;
    },
  ) {
    const userId = req.user.userId;
    // Only pick allowed fields to avoid overwriting sensitive data
    const allowed: any = {};
    if (body.firstName !== undefined) allowed.firstName = body.firstName;
    if (body.lastName !== undefined) allowed.lastName = body.lastName;
    if (body.profilePicture !== undefined)
      allowed.profilePicture = body.profilePicture;
    if (body.emailNotifications !== undefined)
      allowed.emailNotifications = body.emailNotifications;
    if (body.whatsappPhone !== undefined)
      allowed.whatsappPhone = body.whatsappPhone;
    if (body.telegramChatId !== undefined)
      allowed.telegramChatId = body.telegramChatId;
    if (body.telegramUsername !== undefined)
      allowed.telegramUsername = body.telegramUsername;

    await this.usersService.update(userId, allowed);
    const updatedUser = await this.usersService.findOne(userId);
    if (updatedUser) {
      const { password, ...result } = updatedUser;
      return result;
    }
    return null;
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('delete')
  async deleteAccount(@Request() req) {
    const userId = req.user.userId;
    await this.usersService.remove(userId);
    return { message: 'Account deleted' };
  }
}
