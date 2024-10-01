import type { TThis } from '@sinclair/typebox';
import { t } from 'elysia';

export const IdentifierType = (identifier: TThis) =>
  t.Union([t.String(), t.Number(), t.Boolean(), t.Array(identifier), t.Record(t.String(), identifier)]);

export const ErrorResponseType = t.Object({
  name: t.String({
    description: 'The name of the error.',
  }),
  message: t.String({
    description: 'A more detailed error message.',
  }),
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
