import { Download, Map as MapIcon, Plus } from 'lucide-react'
import type { ViewMode } from '../types/workspace'

interface HeaderProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  canShowEdited: boolean
  onDuplicate: () => void
  onExportJson: () => void
}

export function Header({
  viewMode,
  onViewModeChange,
  canShowEdited,
  onDuplicate,
  onExportJson,
}: HeaderProps) {
  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__logo" aria-hidden="true">
          <MapIcon size={17} strokeWidth={2.2} />
        </span>
        <span className="header__title">TerraPulse AI</span>
      </div>

      <div className="pill-tabs" role="tablist" aria-label="Modo de mapa">
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'general'}
          className={`pill-tabs__tab ${viewMode === 'general' ? 'is-active' : ''}`}
          onClick={() => onViewModeChange('general')}
        >
          Mapa General
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'editado'}
          className={`pill-tabs__tab ${viewMode === 'editado' ? 'is-active' : ''}`}
          onClick={() => onViewModeChange('editado')}
          disabled={!canShowEdited}
          title={canShowEdited ? 'Modo de edición' : 'Duplica el mapa para crear una copia editable'}
        >
          Mapa Editado
        </button>
      </div>

      <div className="header__actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onExportJson}
          title="Exportar configuración y dibujos del mapa actual en formato JSON"
        >
          <Download size={15} aria-hidden="true" />
          Exportar JSON
        </button>
        <button type="button" className="btn btn--primary" onClick={onDuplicate}>
          <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
          Duplicar Mapa
        </button>
      </div>
    </header>
  )
}
