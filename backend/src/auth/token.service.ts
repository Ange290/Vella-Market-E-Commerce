import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

export interface ClientContext {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Issues an access JWT and a new refresh token (new family unless one is supplied). */
  async issue(user: { id: string; role: Role }, ctx: ClientContext, familyId: string = randomUUID()): Promise<IssuedTokens> {
    return this.issueWith(this.prisma, user, ctx, familyId);
  }

  private async issueWith(
    db: Pick<PrismaService, 'refreshToken'>,
    user: { id: string; role: Role },
    ctx: ClientContext,
    familyId: string,
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }) as any,
      },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    const refreshExpiresAt = new Date(Date.now() + days * 86_400_000);
    await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        familyId,
        expiresAt: refreshExpiresAt,
        userAgent: ctx.userAgent?.slice(0, 255),
        ipAddress: ctx.ip,
      },
    });
    return { accessToken, refreshToken, refreshExpiresAt };
  }

  /**
   * Rotates a refresh token. Presenting an already-rotated (revoked) token is treated as theft:
   * the entire token family is revoked and the caller must log in again.
   */
  async rotate(rawToken: string, ctx: ClientContext) {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!existing) throw new UnauthorizedException('Invalid session');

    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    if (existing.expiresAt <= new Date() || existing.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Atomic claim: only one concurrent request can revoke (and thus rotate) this token.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count === 0) throw new UnauthorizedException('Session expired. Please log in again.');
      const tokens = await this.issueWith(tx, existing.user, ctx, existing.familyId);
      const newRow = await tx.refreshToken.findUniqueOrThrow({ where: { tokenHash: this.hashToken(tokens.refreshToken) } });
      await tx.refreshToken.update({ where: { id: existing.id }, data: { replacedById: newRow.id } });
      return { tokens, user: existing.user };
    });
  }

  async revokeByToken(rawToken: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashToken(rawToken) } });
    if (!row) return;
    await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
