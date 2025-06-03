export type Result<T, E = string> =
  | { success: true; data: T }
  | { success: false; error: E };

export type AsyncResult<T, E = string> = Promise<Result<T, E>>;

export const Ok = <T>(data: T): Result<T, never> => ({ success: true, data });
export const Err = <E>(error: E): Result<never, E> => ({
  success: false,
  error,
});
