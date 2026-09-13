// Execution preparation, omitted-only input, and publication recovery are not
// provider calls. Keep their audit rows but exclude them before pagination/counts.
export const modelCallPredicate = `(diagnostics ? 'requestedAt' OR COALESCE((diagnostics->>'httpRequests')::int,0)>0)`;
