// Free text (comments, search queries) is shown in the dashboard and sent to
// an AI model for insights. Mask what a visitor may have typed about
// themselves before it leaves your backend, and keep it short.

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g
/** Phone, tax and registry numbers: any run of 9+ digits, spaces or dashes allowed between them. */
const LONG_NUMBER_RE = /\d(?:[\s-]?\d){8,}/g

export function redactPersonalData(text: string): string {
  return text.replace(EMAIL_RE, '[e-mail]').replace(LONG_NUMBER_RE, '[number]')
}

/** Trims and cuts to `max` characters. */
export function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}
