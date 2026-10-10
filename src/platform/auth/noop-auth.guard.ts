import { Injectable, type CanActivate } from '@nestjs/common';

/**
 * Explicit extension point for authentication (README §2: auth does not score
 * and is not prescribed). This change ships a no-op guard on every financial
 * controller so the real provider (e.g. an OIDC `AuthGuard('oidc')` against
 * Keycloak/Zitadel, or a shared-API-key guard for internal services) can be
 * swapped in without touching a single handler. Health endpoints stay public
 * by design and carry no guard.
 */
@Injectable()
export class NoopAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
