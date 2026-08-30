import * as Sentry from "@sentry/nextjs";

export function register() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
  }
}

export const onRequestError = Sentry.captureRequestError;
