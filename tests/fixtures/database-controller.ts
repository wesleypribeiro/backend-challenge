import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

@Controller('technical-context')
export class DatabaseController {
  static arrived = 0;
  static release: () => void;
  static barrier = new Promise<void>((resolve) => { DatabaseController.release = resolve; });

  constructor(private readonly em: EntityManager) {}

  @Get()
  async probe() {
    const em = this.em.getContext();
    return em.transactional(async (transaction) => {
      const [before] = await transaction.execute<{ pid: number; role: string }[]>(
        'select pg_backend_pid() as pid, current_user as role',
      );
      if (++DatabaseController.arrived === 2) DatabaseController.release();
      await Promise.race([
        DatabaseController.barrier,
        new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('HTTP context barrier timeout')), 3000); timer.unref(); }),
      ]);
      return { id: em.id, sameContext: this.em.getContext() === transaction, ...before };
    });
  }
}
