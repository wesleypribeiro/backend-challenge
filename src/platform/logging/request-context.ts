import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<Readonly<{ correlationId: string }>>();
export const correlationIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
