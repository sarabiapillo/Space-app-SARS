import { useState, useMemo } from 'react'
import {
  MapPin,
  ChevronDown,
  ChevronRight,
  CloudRain,
  Sun,
  Search,
  Sparkles,
} from 'lucide-react'
import {
  getCatalogGrouped,
  PRESET_ROI_CATALOG,
  type CatalogRoiPreset,
} from '../utils/roiCatalog'
import { useTranslation } from '../i18n/useTranslation'

interface RoiCatalogSectionProps {
  activePresetId?: string | null
  onSelectPreset: (preset: CatalogRoiPreset) => void
  onOpenSimulation?: (mode: 'flood' | 'solar') => void
}

export function RoiCatalogSection({
  activePresetId,
  onSelectPreset,
  onOpenSimulation,
}: RoiCatalogSectionProps) {
  const { t } = useTranslation()
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedStates, setExpandedStates] = useState<Record<string, boolean>>({
    'México:Guerrero': true, // Guerrero expandido por defecto para acceso inmediato
    'México:Chiapas': true,
  })

  const grouped = useMemo(() => getCatalogGrouped(), [])

  const filteredPresets = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return null
    return PRESET_ROI_CATALOG.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.state.toLowerCase().includes(term) ||
        p.country.toLowerCase().includes(term) ||
        p.description.toLowerCase().includes(term) ||
        p.riskCategory.toLowerCase().includes(term)
    )
  }, [searchTerm])

  const toggleState = (key: string) => {
    setExpandedStates((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="roi-catalog-container" aria-label={t('Catálogo de ROIs por Estado y País', 'ROI Catalog by State and Country')}>
      {/* Buscador de ROIs del catálogo */}
      <div className="roi-catalog-search">
        <Search size={14} className="roi-catalog-search__icon" />
        <input
          type="text"
          className="roi-catalog-search__input"
          placeholder={t('Buscar ROI en Guerrero, Chiapas, Oaxaca...', 'Search ROI in Guerrero, Chiapas, Oaxaca...')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button
            type="button"
            className="roi-catalog-search__clear"
            onClick={() => setSearchTerm('')}
            title={t('Limpiar búsqueda', 'Clear search')}
          >
            ×
          </button>
        )}
      </div>

      {/* Vista de resultados filtrados si hay término de búsqueda */}
      {filteredPresets !== null ? (
        <div className="roi-catalog-list">
          <div className="roi-catalog-results-header">
            {t('Resultados ({count}):', 'Results ({count}):', { count: filteredPresets.length })}
          </div>
          {filteredPresets.length === 0 ? (
            <div className="roi-catalog-empty">
              {t('No se encontraron regiones con ese término.', 'No regions found matching that term.')}
            </div>
          ) : (
            filteredPresets.map((preset) => (
              <RoiPresetCard
                key={preset.id}
                preset={preset}
                isActive={activePresetId === preset.id}
                onSelect={() => onSelectPreset(preset)}
                onOpenSimulation={onOpenSimulation}
              />
            ))
          )}
        </div>
      ) : (
        /* Vista jerárquica por País y Estado */
        <div className="roi-catalog-groups">
          {grouped.map((countryGroup) => (
            <div key={countryGroup.country} className="roi-country-group">
              <div className="roi-country-header">
                <span className="roi-country-flag">{countryGroup.flag}</span>
                <span className="roi-country-name">{countryGroup.country}</span>
              </div>

              <div className="roi-country-states">
                {countryGroup.states.map(({ state, presets }) => {
                  const stateKey = `${countryGroup.country}:${state}`
                  const isExpanded = expandedStates[stateKey] ?? false
                  const isGuerrero = state === 'Guerrero'

                  return (
                    <div key={state} className={`roi-state-group ${isGuerrero ? 'is-highlighted-state' : ''}`}>
                      <button
                        type="button"
                        className="roi-state-header"
                        onClick={() => toggleState(stateKey)}
                        aria-expanded={isExpanded}
                      >
                        <div className="roi-state-header__title">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <strong>{state}</strong>
                          {isGuerrero && (
                            <span className="roi-badge roi-badge--gold">
                              <Sparkles size={10} /> {t('Precargadas', 'Preloaded')}
                            </span>
                          )}
                        </div>
                        <span className="roi-state-count">{presets.length} ROIs</span>
                      </button>

                      {isExpanded && (
                        <div className="roi-state-cards">
                          {presets.map((preset) => (
                            <RoiPresetCard
                              key={preset.id}
                              preset={preset}
                              isActive={activePresetId === preset.id}
                              onSelect={() => onSelectPreset(preset)}
                              onOpenSimulation={onOpenSimulation}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RoiPresetCard({
  preset,
  isActive,
  onSelect,
  onOpenSimulation,
}: {
  preset: CatalogRoiPreset
  isActive: boolean
  onSelect: () => void
  onOpenSimulation?: (mode: 'flood' | 'solar') => void
}) {
  const { t } = useTranslation()

  return (
    <div className={`roi-card ${isActive ? 'is-active' : ''}`}>
      <div className="roi-card__head">
        <div className="roi-card__title-row">
          <MapPin size={13} className="roi-card__pin" />
          <strong className="roi-card__title">{preset.name}</strong>
        </div>
        <span className={`roi-badge roi-badge--category`}>
          {preset.riskCategory}
        </span>
      </div>

      <p className="roi-card__desc">{preset.description}</p>

      <div className="roi-card__footer">
        <button
          type="button"
          className={`roi-card__btn-select ${isActive ? 'is-selected' : ''}`}
          onClick={onSelect}
          title={t('Cargar esta ROI en el mapa y centrar', 'Load this ROI on the map and center')}
        >
          {isActive ? t('✓ ROI Activa', '✓ Active ROI') : t('Seleccionar ROI', 'Select ROI')}
        </button>

        {onOpenSimulation && (
          <div className="roi-card__quick-sims">
            {(preset.recommendedSimulation === 'both' || preset.recommendedSimulation === 'flood') && (
              <button
                type="button"
                className="roi-card__sim-btn roi-card__sim-btn--flood"
                title={t('Simular inundación / lluvia en esta zona', 'Simulate flood / rainfall in this zone')}
                onClick={() => {
                  onSelect()
                  onOpenSimulation('flood')
                }}
              >
                <CloudRain size={12} /> {t('Lluvia', 'Rain')}
              </button>
            )}
            {(preset.recommendedSimulation === 'both' || preset.recommendedSimulation === 'solar') && (
              <button
                type="button"
                className="roi-card__sim-btn roi-card__sim-btn--solar"
                title={t('Calcular radiación solar en esta zona', 'Calculate solar radiation in this zone')}
                onClick={() => {
                  onSelect()
                  onOpenSimulation('solar')
                }}
              >
                <Sun size={12} /> {t('Solar', 'Solar')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
