import { merge } from 'lodash-es';

export class ApiError extends Error {
  detail?: string;

  status: number;

  constructor(props?: { message?: string; detail?: string; status?: number }) {
    const mergedProps = merge(
      {},
      {
        message: 'Internal server error',
        detail: undefined,
        status: 500,
      },
      props,
    );

    super(mergedProps.message);

    this.status = mergedProps.status;
    this.detail = mergedProps.detail;
  }
}
