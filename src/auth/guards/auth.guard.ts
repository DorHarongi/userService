import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private authService: AuthService) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            throw new HttpException('No authorization header', HttpStatus.UNAUTHORIZED);
        }

        const [type, token] = authHeader.split(' ');

        if (type !== 'Bearer' || !token) {
            throw new HttpException('Invalid authorization header format', HttpStatus.UNAUTHORIZED);
        }

        try {
            const payload = this.authService.verifyToken(token);
            request.user = payload;
            return true;
        } catch (error) {
            throw error;
        }
    }
}
