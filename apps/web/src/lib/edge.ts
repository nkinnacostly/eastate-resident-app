import { supabase } from './supabase';

/**
 * Calling an Edge Function and getting a usable error message out of it.
 *
 * `supabase.functions.invoke` reports any non-2xx as a FunctionsHttpError whose
 * `message` is only the status line — "Edge Function returned a non-2xx status
 * code". Everything that tells a person what went wrong is in the response
 * body, which has to be read off `error.context` before it is thrown away.
 * That is subtle enough to be worth having in exactly one place: a second copy
 * silently degrades to showing the status line the first time someone forgets.
 *
 * Our functions answer in two shapes, and both mean failure:
 *   - non-2xx with `{ error, detail }`  → arrives as FunctionsHttpError
 *   - 200 with `{ error }`              → arrives as data, no error at all
 * The second is why the success path still has to look for `error`.
 */
export async function callEdgeFunction<T>(
  name: string,
  // Not `unknown`: functions.invoke types its body as a union of concrete
  // payloads, and `unknown` is assignable to none of them. Every caller here
  // sends a plain JSON object, so that is what this asks for.
  body: Record<string, unknown>,
  /** Machine codes to sentences, once per caller rather than at each call site. */
  describe: (code: string) => string,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string; detail?: string }>(
    name,
    { body },
  );

  if (error) {
    const res = (error as { context?: Response }).context;
    if (res && typeof res.json === 'function') {
      try {
        const parsed = await res.json();
        if (parsed?.error) {
          throw new Error(describe(parsed.error) + (parsed.detail ? ` — ${parsed.detail}` : ''));
        }
      } catch (e) {
        // A body that is not JSON, or was already consumed. Fall through to the
        // status-line message rather than masking the original failure with a
        // parse error the person can do nothing about.
        if (e instanceof Error && e.message && !e.message.startsWith('Edge Function')) throw e;
      }
    }
    throw new Error(error.message);
  }

  if (!data || (data as { error?: string }).error) {
    throw new Error(describe((data as { error?: string })?.error ?? 'unknown_error'));
  }
  return data;
}
