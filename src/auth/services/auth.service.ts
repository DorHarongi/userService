import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import * as crypto from 'crypto';

const JWT_SECRET = 'game-secret-key-change-in-production';
const JWT_TTL_MINUTES = 10;

export interface JwtPayload {
    username: string;
    iat: number;
    exp: number;
}

@Injectable()
export class AuthService {
    // Simple JWT implementation without external library to match existing patterns
    generateToken(username: string): string {
        const now = Math.floor(Date.now() / 1000);
        const payload: JwtPayload = {
            username,
            iat: now,
            exp: now + (JWT_TTL_MINUTES * 60)
        };

        const header = this.base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const body = this.base64UrlEncode(JSON.stringify(payload));
        const signature = this.sign(`${header}.${body}`);

        return `${header}.${body}.${signature}`;
    }

    verifyToken(token: string): JwtPayload {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) {
                throw new HttpException('Invalid token format', HttpStatus.UNAUTHORIZED);
            }

            const [header, body, signature] = parts;
            const expectedSignature = this.sign(`${header}.${body}`);

            if (signature !== expectedSignature) {
                throw new HttpException('Invalid token signature', HttpStatus.UNAUTHORIZED);
            }

            const payload: JwtPayload = JSON.parse(this.base64UrlDecode(body));
            const now = Math.floor(Date.now() / 1000);

            if (payload.exp < now) {
                throw new HttpException('Token expired', HttpStatus.UNAUTHORIZED);
            }

            return payload;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException('Invalid token', HttpStatus.UNAUTHORIZED);
        }
    }

    refreshToken(token: string): string {
        const payload = this.verifyToken(token);
        return this.generateToken(payload.username);
    }

    private sign(data: string): string {
        return crypto
            .createHmac('sha256', JWT_SECRET)
            .update(data)
            .digest('base64url');
    }

    private base64UrlEncode(str: string): string {
        return Buffer.from(str).toString('base64url');
    }

    private base64UrlDecode(str: string): string {
        return Buffer.from(str, 'base64url').toString('utf-8');
    }

    getTtlMinutes(): number {
        return JWT_TTL_MINUTES;
    }
}
