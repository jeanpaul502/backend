import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { Session } from './entities/session.entity';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

export class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Session)
    private sessionsRepository: Repository<Session>,
    private mailService: MailService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const existingUser = await this.findByEmail(createUserDto.email);
    if (existingUser) {
      throw new ConflictException('Cet email est déjà utilisé');
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(createUserDto.password, salt);

    const code = Math.floor(10000 + Math.random() * 90000).toString();
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 15);

    const user = this.usersRepository.create({
      ...createUserDto,
      password: hashedPassword,
      verificationCode: code,
      verificationCodeExpires: expires,
      isVerified: false,
    });
    const savedUser = await this.usersRepository.save(user);

    // Send verification email
    try {
      await this.mailService.sendTemplateMail(
        savedUser.email,
        'Vérification de votre email - Cineo',
        './verification',
        {
          name: savedUser.firstName || 'Cher utilisateur',
          code,
        },
      );
    } catch (error) {
      console.error('Error sending verification email:', error);
    }

    const { password, ...result } = savedUser;
    return result;
  }

  async verifyEmail(email: string, code: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    if (!user) {
      throw new NotFoundException('Aucun compte associé à cette adresse email');
    }

    if (user.isVerified) {
      return true;
    }

    if (
      user.verificationLockoutUntil &&
      user.verificationLockoutUntil > new Date()
    ) {
      const remaining = Math.ceil(
        (user.verificationLockoutUntil.getTime() - new Date().getTime()) /
          60000,
      );
      throw new TooManyRequestsException(
        `Trop de tentatives. Veuillez réessayer dans ${remaining} minutes.`,
      );
    }

    // Check if code is expired
    if (
      user.verificationCodeExpires &&
      user.verificationCodeExpires < new Date()
    ) {
      user.verificationCode = null;
      user.verificationCodeExpires = null;
      user.verificationCodeAttempts = 0;
      await this.usersRepository.save(user);
      throw new BadRequestException('Le code a expiré');
    }

    if (!user.verificationCode) {
      throw new BadRequestException('Le code a expiré');
    }

    if (user.verificationCode !== code) {
      user.verificationCodeAttempts = (user.verificationCodeAttempts || 0) + 1;
      if (user.verificationCodeAttempts >= 5) {
        const lockoutTime = new Date();
        lockoutTime.setMinutes(lockoutTime.getMinutes() + 15);
        user.verificationLockoutUntil = lockoutTime;
        user.verificationCode = null;
        user.verificationCodeExpires = null;
        user.verificationCodeAttempts = 0;
        await this.usersRepository.save(user);
        throw new TooManyRequestsException(
          'Trop de tentatives incorrectes. Veuillez réessayer dans 15 minutes.',
        );
      }
      await this.usersRepository.save(user);
      throw new BadRequestException(
        `Code incorrect. Tentatives restantes : ${5 - user.verificationCodeAttempts}`,
      );
    }

    user.isVerified = true;
    user.verificationCode = null;
    user.verificationCodeExpires = null;
    user.verificationCodeAttempts = 0;
    user.verificationLockoutUntil = null;
    await this.usersRepository.save(user);

    // Send welcome email
    try {
      await this.mailService.sendTemplateMail(
        user.email,
        'Bienvenue sur Cineo !',
        './welcome',
        { name: user.firstName || 'Cher utilisateur' },
      );
    } catch (error) {
      console.error('Error sending welcome email:', error);
    }

    return true;
  }

  async resendVerificationCode(email: string): Promise<void> {
    const user = await this.findByEmail(email);
    if (!user) throw new NotFoundException('Utilisateur non trouvé');
    if (user.isVerified) throw new BadRequestException('Compte déjà vérifié');

    if (
      user.verificationLockoutUntil &&
      user.verificationLockoutUntil > new Date()
    ) {
      const remaining = Math.ceil(
        (user.verificationLockoutUntil.getTime() - new Date().getTime()) /
          60000,
      );
      throw new TooManyRequestsException(
        `Trop de tentatives. Veuillez réessayer dans ${remaining} minutes.`,
      );
    }

    const code = Math.floor(10000 + Math.random() * 90000).toString();
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 15);

    user.verificationCode = code;
    user.verificationCodeExpires = expires;
    user.verificationCodeAttempts = 0;
    user.verificationLockoutUntil = null;
    await this.usersRepository.save(user);

    try {
      await this.mailService.sendTemplateMail(
        user.email,
        'Vérification de votre email - Cineo',
        './verification',
        {
          name: user.firstName || 'Cher utilisateur',
          code,
        },
      );
    } catch (error) {
      console.error('Error sending verification email:', error);
    }
  }

  findAll() {
    return this.usersRepository.find({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        subscriptionType: true,
        profilePicture: true,
        createdAt: true,
        accountStatus: true,
        isVerified: true,
        subscriptionEndDate: true,
        lastIp: true,
        lastCountry: true,
        lastCity: true,
        lastDevice: true,
        lastActive: true,
        lastCountryCode: true,
      },
    });
  }

  findOne(id: string) {
    return this.usersRepository.findOne({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        subscriptionType: true,
        profilePicture: true,
        createdAt: true,
        accountStatus: true,
        isVerified: true,
        subscriptionEndDate: true,
        lastIp: true,
        lastCountry: true,
        lastCity: true,
        lastDevice: true,
        lastActive: true,
        lastCountryCode: true,
      },
    });
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const user = await this.usersRepository.findOneBy({ email });
    return user || undefined;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    await this.usersRepository.update(id, updateUserDto);
    return this.usersRepository.findOneBy({ id });
  }

  async remove(id: string) {
    // Delete sessions first to avoid FK constraint errors
    await this.sessionsRepository.delete({ user: { id } });
    await this.usersRepository.delete(id);
  }

  async generateResetCode(email: string): Promise<string> {
    const user = await this.findByEmail(email);
    if (!user) {
      throw new NotFoundException('Aucun compte associé à cette adresse email');
    }

    if (user.resetLockoutUntil && user.resetLockoutUntil > new Date()) {
      const remaining = Math.ceil(
        (user.resetLockoutUntil.getTime() - new Date().getTime()) / 60000,
      );
      throw new TooManyRequestsException(
        `Trop de tentatives. Veuillez réessayer dans ${remaining} minutes.`,
      );
    }

    const code = Math.floor(10000 + Math.random() * 90000).toString();
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 15);

    user.resetCode = code;
    user.resetCodeExpires = expires;
    user.resetCodeAttempts = 0;
    user.resetLockoutUntil = null;
    await this.usersRepository.save(user);

    // Send reset code email
    try {
      await this.mailService.sendTemplateMail(
        user.email,
        'Réinitialisation de votre mot de passe Cineo',
        './reset-password',
        { code },
      );
    } catch (error) {
      console.error('Error sending reset code email:', error);
      // We might want to throw here if email is critical, but usually we just log it
      // so the user flow isn't completely broken if mail server is down.
      // However, for password reset, if they don't get the email, they are stuck.
      // But throwing an error might hide the fact that the code was generated.
    }

    return code;
  }

  async verifyResetCode(email: string, code: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    if (!user) {
      throw new NotFoundException('Aucun compte associé à cette adresse email');
    }

    if (user.resetLockoutUntil && user.resetLockoutUntil > new Date()) {
      const remaining = Math.ceil(
        (user.resetLockoutUntil.getTime() - new Date().getTime()) / 60000,
      );
      throw new TooManyRequestsException(
        `Trop de tentatives. Veuillez réessayer dans ${remaining} minutes.`,
      );
    }

    // Check if code is expired
    if (user.resetCodeExpires && user.resetCodeExpires < new Date()) {
      user.resetCode = null;
      user.resetCodeExpires = null;
      user.resetCodeAttempts = 0;
      await this.usersRepository.save(user);
      throw new BadRequestException('Le code a expiré');
    }

    if (!user.resetCode) {
      throw new BadRequestException('Le code a expiré');
    }

    if (user.resetCode !== code) {
      user.resetCodeAttempts = (user.resetCodeAttempts || 0) + 1;
      if (user.resetCodeAttempts >= 5) {
        const lockoutTime = new Date();
        lockoutTime.setMinutes(lockoutTime.getMinutes() + 15);
        user.resetLockoutUntil = lockoutTime;
        user.resetCode = null;
        user.resetCodeExpires = null;
        user.resetCodeAttempts = 0;
        await this.usersRepository.save(user);
        throw new TooManyRequestsException(
          'Trop de tentatives incorrectes. Veuillez réessayer dans 15 minutes.',
        );
      }
      await this.usersRepository.save(user);
      throw new BadRequestException(
        `Code incorrect. Tentatives restantes : ${5 - user.resetCodeAttempts}`,
      );
    }

    return true;
  }

  async createSession(
    userId: string,
    sessionData: Partial<Session> & { countryCode?: string },
  ) {
    const user = await this.findOne(userId);
    if (!user) throw new NotFoundException('User not found');

    let session: Session | null = null;

    // If deviceId is provided, check for existing session
    if (sessionData.deviceId) {
      session = await this.sessionsRepository.findOne({
        where: {
          user: { id: userId },
          deviceId: sessionData.deviceId,
        },
      });
    }

    // Filter out countryCode from sessionData before passing to merge/create
    const { countryCode, ...sessionFields } = sessionData;

    if (session) {
      // Update existing session
      this.sessionsRepository.merge(session, {
        ...sessionFields,
        lastActive: new Date(),
        isOnline: true,
      });
    } else {
      // Create new session
      session = this.sessionsRepository.create({ ...sessionFields, user });
    }

    // Update User with latest session info
    user.lastActive = new Date();
    if (sessionData.ipAddress) user.lastIp = sessionData.ipAddress;
    if (sessionData.country) user.lastCountry = sessionData.country;
    if (countryCode) user.lastCountryCode = countryCode;
    if (sessionData.city) user.lastCity = sessionData.city;
    if (sessionData.device) user.lastDevice = sessionData.device; // Or construct a string from device/os/browser

    // Construct a friendly device string if possible
    // Prioritize "Device Name" requested by user (e.g. "iPhone 12 Pro", "Windows 11")
    // If device string seems like a full name (has spaces or version), use it.
    // Otherwise try to construct from OS/Browser.

    if (
      sessionData.device &&
      sessionData.device !== 'Ordinateur' &&
      sessionData.device !== 'Téléphone' &&
      sessionData.device !== 'Tablette'
    ) {
      user.lastDevice = sessionData.device;
    } else if (sessionData.os && sessionData.browser) {
      user.lastDevice = `${sessionData.browser} sur ${sessionData.os}`;
    } else if (sessionData.device) {
      user.lastDevice = sessionData.device;
    }

    await this.usersRepository.save(user);

    return this.sessionsRepository.save(session);
  }

  async updateLastActive(userId: string) {
    await this.usersRepository.update(userId, { lastActive: new Date() });
  }

  async findSessionById(sessionId: number) {
    return this.sessionsRepository.findOne({ where: { id: sessionId } });
  }

  async updateSessionActivity(sessionId: number, userId: string) {
    const now = new Date();
    await Promise.all([
      this.sessionsRepository.update(sessionId, { lastActive: now }),
      this.usersRepository.update(userId, { lastActive: now }),
    ]);
  }

  async getUserSessions(userId: string, currentToken?: string) {
    const sessions = await this.sessionsRepository.find({
      where: { user: { id: userId } },
    });
    const now = new Date().getTime();
    const FIVE_MINUTES = 5 * 60 * 1000;

    return sessions
      .map((session) => {
        const lastActiveTime = new Date(session.lastActive).getTime();
        const isOnline = now - lastActiveTime < FIVE_MINUTES;

        return {
          ...session,
          isOnline, // Override DB value with dynamic calculation
          isCurrent: session.token === currentToken,
          lastActiveAt: session.lastActive,
          token: undefined, // Hide token
        };
      })
      .sort((a, b) => {
        if (a.isCurrent) return -1;
        if (b.isCurrent) return 1;
        return (
          new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime()
        );
      });
  }

  async deleteSession(sessionId: number, userId: string) {
    return this.sessionsRepository.delete({
      id: sessionId,
      user: { id: userId },
    });
  }

  async resetPassword(email: string, newPassword: string): Promise<void> {
    const user = await this.findByEmail(email);
    if (!user) {
      throw new NotFoundException('Aucun compte associé à cette adresse email');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException(
        'Le mot de passe doit contenir au moins 8 caractères',
      );
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    user.resetCode = null;
    user.resetCodeExpires = null;
    user.resetCodeAttempts = 0;
    user.resetLockoutUntil = null;
    await this.usersRepository.save(user);

    // Send password changed email
    try {
      await this.mailService.sendTemplateMail(
        user.email,
        'Mot de passe modifié - Cineo',
        './password-changed',
        { name: user.firstName || 'Cher utilisateur' },
      );
    } catch (error) {
      console.error('Error sending password changed email:', error);
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'password'],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.password) {
      throw new BadRequestException('Aucun mot de passe défini');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException(
        'Le mot de passe doit contenir au moins 8 caractères',
      );
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Mot de passe actuel incorrect');
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await this.usersRepository.save(user);
  }
}
