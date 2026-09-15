export class DocumentProviderError extends Error {
  constructor(readonly code: string) { super(code); }
}
