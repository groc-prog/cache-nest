export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[] | undefined
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? (T[K] extends Function ? T[K] : DeepReadonly<T[K]>) : T[K];
};
