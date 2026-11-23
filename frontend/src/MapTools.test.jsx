/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ZoneDraft } from './MapTools.jsx'

/**
 * Le panneau d'une zone à éviter : en contour, on ne garde rien tant qu'il n'y a
 * pas trois coins — deux points ne ferment aucune surface —, et le dernier
 * point posé par erreur se retire sans tout recommencer.
 */
afterEach(cleanup)

describe('ZoneDraft', () => {
  it('passe en contour, et attend trois coins avant de garder', () => {
    const onChange = vi.fn()
    const draft = { shape: 'polygon', points: [[7.2, 47.9], [7.21, 47.9]], radius_m: 300, name: '' }
    render(<ZoneDraft draft={draft} onChange={onChange} onKeep={() => {}} onCancel={() => {}} />)
    expect(screen.getByText(/2 sur 3 au moins/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Éviter cette zone' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retirer le dernier point' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ points: [[7.2, 47.9]] }))
  })

  it('garde la raison choisie', () => {
    const onChange = vi.fn()
    render(<ZoneDraft draft={{ radius_m: 300, name: '' }} onChange={onChange} onKeep={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Travaux' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'works' }))
  })
})
