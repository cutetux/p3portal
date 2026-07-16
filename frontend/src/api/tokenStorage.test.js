// p3portal.org
// PROJ-109: Unit-Tests für die Token-Persistenz-Helper.
import { describe, it, expect, beforeEach } from 'vitest'
import { getToken, persistToken, refreshToken, clearToken } from './tokenStorage'

describe('tokenStorage (PROJ-109)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('persistToken(remember=true) legt NUR in localStorage ab', () => {
    persistToken('jwt-1', true)
    expect(localStorage.getItem('token')).toBe('jwt-1')
    expect(sessionStorage.getItem('token')).toBeNull()
  })

  it('persistToken(remember=false) legt NUR in sessionStorage ab', () => {
    persistToken('jwt-2', false)
    expect(sessionStorage.getItem('token')).toBe('jwt-2')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('Wechsel remember true→false verschiebt den Token (nie in beiden Stores)', () => {
    persistToken('jwt', true)
    persistToken('jwt', false)
    expect(localStorage.getItem('token')).toBeNull()
    expect(sessionStorage.getItem('token')).toBe('jwt')
  })

  it('getToken bevorzugt localStorage, fällt auf sessionStorage zurück, sonst null', () => {
    expect(getToken()).toBeNull()
    sessionStorage.setItem('token', 'sess')
    expect(getToken()).toBe('sess')
    localStorage.setItem('token', 'local')
    expect(getToken()).toBe('local')
  })

  it('refreshToken behält den bestehenden Ablageort bei (localStorage)', () => {
    persistToken('old', true)
    refreshToken('new')
    expect(localStorage.getItem('token')).toBe('new')
    expect(sessionStorage.getItem('token')).toBeNull()
  })

  it('refreshToken behält den bestehenden Ablageort bei (sessionStorage)', () => {
    persistToken('old', false)
    refreshToken('new')
    expect(sessionStorage.getItem('token')).toBe('new')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('refreshToken ohne vorhandenen Token → sessionStorage (kein remember)', () => {
    refreshToken('fresh')
    expect(sessionStorage.getItem('token')).toBe('fresh')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('clearToken entfernt aus BEIDEN Stores', () => {
    localStorage.setItem('token', 'a')
    sessionStorage.setItem('token', 'b')
    clearToken()
    expect(localStorage.getItem('token')).toBeNull()
    expect(sessionStorage.getItem('token')).toBeNull()
  })
})
