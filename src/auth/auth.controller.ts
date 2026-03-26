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

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
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

    // Build the final IP: prefer the IP sent by the client (from ipwho.is/ipapi.co),
    // then fall back to req.ip (uses trust-proxy), then x-forwarded-for
    let clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    if (typeof clientIp === 'string' && clientIp.includes(',')) {
      clientIp = clientIp.split(',')[0].trim();
    }
    // Clean up IPv6-mapped IPv4 addresses
    if (typeof clientIp === 'string' && clientIp.startsWith('::ffff:')) {
      clientIp = clientIp.replace('::ffff:', '');
    }
    if (clientIp === '::1') clientIp = '127.0.0.1';

    // Use client-provided IP (from geolocation API) if it's a valid non-local IP
    const isValidClientIp = ipAddress && ipAddress !== 'Unknown' && ipAddress !== '' && !ipAddress.startsWith('127.') && !ipAddress.startsWith('::');
    const finalIp = isValidClientIp ? ipAddress : (clientIp || 'Unknown');

    return this.authService.login(req.user, {
      device,
      os,
      location,
      deviceId,
      city,
      country,
      countryCode,
      ipAddress: finalIp,
      browser,
      deviceType,
    });
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
    if (body.profilePicture !== undefined) allowed.profilePicture = body.profilePicture;
    if (body.emailNotifications !== undefined) allowed.emailNotifications = body.emailNotifications;
    if (body.whatsappPhone !== undefined) allowed.whatsappPhone = body.whatsappPhone;
    if (body.telegramChatId !== undefined) allowed.telegramChatId = body.telegramChatId;
    if (body.telegramUsername !== undefined) allowed.telegramUsername = body.telegramUsername;

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
