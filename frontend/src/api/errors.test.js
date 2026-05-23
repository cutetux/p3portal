// p3portal.org
import { describe, it, expect } from 'vitest'
import { formatApiError } from './errors'

describe('formatApiError', () => {
  it('returns string detail unchanged', () => {
    const err = { response: { data: { detail: 'Forbidden' } } }
    expect(formatApiError(err)).toBe('Forbidden')
  })

  it('joins Pydantic v2 validation array (BUG-34-5 root cause)', () => {
    const err = {
      response: {
        data: {
          detail: [
            { type: 'missing', loc: ['body', 'rules', 0, 'warning_threshold'], msg: 'Field required', input: null, ctx: {} },
            { type: 'value_error', loc: ['body', 'name'], msg: 'String too short', input: '', ctx: {} },
          ],
        },
      },
    }
    expect(formatApiError(err)).toBe('rules.0.warning_threshold: Field required; name: String too short')
  })

  it('falls back to fallback when array is empty', () => {
    const err = { response: { data: { detail: [] } } }
    expect(formatApiError(err, 'Fallback')).toBe('Fallback')
  })

  it('uses err.message when no detail present', () => {
    const err = { message: 'Network Error' }
    expect(formatApiError(err)).toBe('Network Error')
  })

  it('uses fallback when err is null/undefined', () => {
    expect(formatApiError(null, 'Fallback')).toBe('Fallback')
    expect(formatApiError(undefined, 'Fallback')).toBe('Fallback')
  })

  it('handles object detail with msg field', () => {
    const err = { response: { data: { detail: { msg: 'Some error' } } } }
    expect(formatApiError(err)).toBe('Some error')
  })
})
