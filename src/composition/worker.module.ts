import { Module } from '@nestjs/common';
import { WorkerLifetime } from './worker-lifetime.js';

@Module({ providers: [WorkerLifetime] })
export class WorkerModule {}
