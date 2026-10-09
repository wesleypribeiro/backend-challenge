import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

@Injectable()
export class WorkerLifetime implements OnModuleInit, OnModuleDestroy {
  private idleTimer: ReturnType<typeof setInterval> | undefined;

  onModuleInit(): void {
    // Mantém o application context vivo enquanto ainda não existem consumers.
    this.idleTimer = setInterval(() => {}, 2_147_483_647);
  }

  onModuleDestroy(): void {
    clearInterval(this.idleTimer);
    this.idleTimer = undefined;
  }
}
