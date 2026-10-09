import { Injectable } from '@nestjs/common';
import { RequestContext } from '@mikro-orm/core';
import { MikroORM, EntityManager } from '@mikro-orm/postgresql';

@Injectable()
export class WorkerDatabaseContext {
  constructor(private readonly orm: MikroORM) {}

  // Uma chamada por execução; transações continuam sendo responsabilidade do use case.
  async run<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
    return RequestContext.create(this.orm.em, async () => {
      const em = this.orm.em.getContext();
      try { return await work(em); }
      finally { em.clear(); }
    });
  }
}
