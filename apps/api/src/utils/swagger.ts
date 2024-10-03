import type { TThis } from '@sinclair/typebox';
import { t } from 'elysia';

export const IdentifierType = t.Recursive(
  (identifier: TThis) =>
    t.Union([t.String(), t.Number(), t.Boolean(), t.Array(identifier), t.Record(t.String(), identifier)]),
  {
    description: 'The cache identifier under which it will be registered.',
  },
);

export const ErrorResponseType = t.Object({
  message: t.String({
    description: 'The error message.',
  }),
  detail: t.Optional(
    t.String({
      description: 'A more detailed explanation of the error.',
    }),
  ),
  status: t.Optional(
    t.Number({
      description: 'HTTP status code.',
    }),
  ),
  traceId: t.Optional(
    t.String({
      description: 'The Opentelemetry trace id.',
    }),
  ),
  spanId: t.Optional(
    t.String({
      description: 'The Opentelemetry span id.',
    }),
  ),
});
