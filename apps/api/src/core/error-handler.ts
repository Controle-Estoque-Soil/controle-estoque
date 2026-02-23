import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { AppError } from './app-error';

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

export function apiErrorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof ZodError) {
    reply.status(400).send({
      error: {
        code: 'BAD_REQUEST',
        message: 'Validation error',
        details: formatZodError(error),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    reply.status(409).send({
      error: {
        code: 'CONFLICT',
        message: 'Unique constraint violation',
        details: error.meta,
      },
    });
    return;
  }

  request.log.error({ err: error }, 'Unhandled error');
  reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
}
