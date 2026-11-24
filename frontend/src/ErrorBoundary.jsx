import { Component } from 'react'

import { t } from './i18n'
/**
 * Filet de sécurité : une exception dans un composant vide l'arbre React et
 * laisse un écran noir, sans rien dire. Mieux vaut afficher ce qui s'est passé
 * et offrir un moyen de repartir.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Lacet — erreur non rattrapée', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <h1>{t('Quelque chose a cassé')}</h1>
        <p>{t('L\'application s\'est arrêtée sur l\'erreur ci-dessous. Relance-la ; si ça recommence, garde ce message : il dit ce qui a cassé.')}</p>
        <pre>{String(this.state.error?.message || this.state.error)}</pre>
        <button className="btn btn--primary" onClick={() => window.location.reload()}>{t('Recharger')}</button>
      </div>
    )
  }
}
