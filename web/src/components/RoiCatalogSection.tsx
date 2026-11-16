import { useState, useMemo } from 'react'
import {
  MapPin,
  ChevronDown,
  ChevronRight,
  CloudRain,
  Sun,
  Search,
  Sparkles,
  Filter,
} from 'lucide-react'
import {
  getCatalogGrouped,
  PRESET_ROI_CATALOG,
  type CatalogRoiPreset,
  type RiskCategory,
} from '../utils/roiCatalog'
import { useTranslation } from '../i18n/useTranslation'

interface RoiCatalogSectionProps {
  activePresetId?: string | null
  onSelectPreset: (preset: CatalogRoiPreset) => void
  onOpenSimulation?: (mode: 'flood' | 'solar') => void
}

const CATEGORY_FILTERS: { id: RiskCategory | 'ALL'; labelEs: string; labelEn: string }[] = [
  { id: 'ALL', labelEs: 'Todos los Casos', labelEn: 'All Cases' },
  { id: 'Inundaciones Costeras', labelEs: 'Costeras & Ciclones', labelEn: 'Coastal & Cyclones' },
  { id: 'Riesgo Pluvial y Fluvial', labelEs: 'Pluvial & Fluvial', labelEn: 'Rain & River' },
  { id: 'Alta Radiación Solar', labelEs: 'Radiación Solar', labelEn: 'Solar Radiation' },
  { id: 'Relieve de Montaña', labelEs: 'Montaña & Cañones', labelEn: 'Mountain & Canyons' },
  { id: 'Humedales y Manglares', labelEs: 'Humedales & Manglares', labelEn: 'Wetlands & Mangroves' },
]

export function RoiCatalogSection({
  activePresetId,
  onSelectPreset,
  onOpenSimulation,
}: RoiCatalogSectionProps) {
  const { t } = useTranslation()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<RiskCategory | 'ALL'>('ALL')
  const [expandedStates, setExpandedStates] = useState<Record<string, boolean>>({
    'México:Guerrero': true,
    'México:Ciudad de México': true,
    'México:Jalisco': true,
    'México:Nuevo León': true,
    'México:Chiapas': true,
  })

  const grouped = useMemo(() => getCatalogGrouped(), [])

  // Filtrado reactivo por término y por categoría de riesgo
  const filteredPresets = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const filterByCategory = selectedCategory !== 'ALL'

    if (!term && !filterByCategory) return null

    return PRESET_ROI_CATALOG.filter((p) => {
      const matchCat = !filterByCategory || p.riskCategory === selectedCategory
      if (!matchCat) return false
      if (!term) return true
      return (
        p.name.toLowerCase().includes(term) ||
        p.shortLabel.toLowerCase().includes(term) ||
        p.state.toLowerCase().includes(term) ||
        p.country.toLowerCase().includes(term) ||
        p.description.toLowerCase().includes(term) ||
        p.riskCategory.toLowerCase().includes(term)
      )
    })
  }, [searchTerm, selectedCategory])

  const toggleState = (key: string) => {
    setExpandedStates((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const expandAll = () => {
    const next: Record<string, boolean> = {}
    for (const c of grouped) {
      for (const s of c.states) {
        next[`${c.country}:${s.state}`] = true
      }
    }
    setExpandedStates(next)
  }

  const collapseAll = () => {
    setExpandedStates({})
  }

  return (
    <div className="roi-catalog-container" aria-label={t('Catálogo de ROIs de México por Estado y Caso', 'Mexico ROI Catalog by State and Case')}>
      {/* Encabezado con conteo general */}
      <div className="roi-catalog-stats">
        <span className="roi-catalog-stats__pill">
          🇲🇽 <strong>32</strong> {t('Estados', 'States')} · <strong>{PRESET_ROI_CATALOG.length}</strong> {t('ROIs clasificadas', 'Classified ROIs')}
        </span>
        <div className="roi-catalog-stats__actions">
          <button type="button" className="roi-catalog-toggle-btn" onClick={expandAll} title={t('Desplegar todos los estados', 'Expand all states')}>
            {t('Abrir todos', 'Expand all')}
          </button>
          <span className="roi-catalog-stats__sep">·</span>
          <button type="button" className="roi-catalog-toggle-btn" onClick={collapseAll} title={t('Colapsar todos los estados', 'Collapse all states')}>
            {t('Cerrar todos', 'Collapse all')}
          </button>
        </div>
      </div>

      {/* Buscador de ROIs del catálogo */}
      <div className="roi-catalog-search">
        <Search size={14} className="roi-catalog-search__icon" />
        <input
          type="text"
          className="roi-catalog-search__input"
          placeholder={t('Buscar por estado (ej. Jalisco, Veracruz) o caso...', 'Search by state (e.g. Jalisco, Veracruz) or case...')}
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

      {/* Píldoras de filtro por caso / categoría de riesgo */}
      <div className="roi-catalog-category-bar" role="group" aria-label={t('Filtrar por caso de estudio', 'Filter by case study')}>
        <div className="roi-catalog-category-label">
          <Filter size={11} /> {t('Casos:', 'Cases:')}
        </div>
        <div className="roi-catalog-category-pills">
          {CATEGORY_FILTERS.map((cat) => {
            const isSelected = selectedCategory === cat.id
            return (
              <button
                key={cat.id}
                type="button"
                className={`roi-category-pill ${isSelected ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory(isSelected && cat.id !== 'ALL' ? 'ALL' : cat.id)}
              >
                {t(cat.labelEs, cat.labelEn)}
              </button>
            )
          })}
        </div>
      </div>

      {/* Vista de resultados filtrados si hay término de búsqueda o categoría activa */}
      {filteredPresets !== null ? (
        <div className="roi-catalog-list">
          <div className="roi-catalog-results-header">
            {t('Resultados ({count}):', 'Results ({count}):', { count: filteredPresets.length })}
            {selectedCategory !== 'ALL' && (
              <button
                type="button"
                className="roi-catalog-clear-filter"
                onClick={() => setSelectedCategory('ALL')}
              >
                {t('Quitar filtro de caso', 'Clear case filter')}
              </button>
            )}
          </div>
          {filteredPresets.length === 0 ? (
            <div className="roi-catalog-empty">
              {t('No se encontraron regiones con esos criterios.', 'No regions found matching those criteria.')}
            </div>
          ) : (
            filteredPresets.map((preset) => (
              <RoiPresetCard
                key={preset.id}
                preset={preset}
                isActive={activePresetId === preset.id}
                onSelect={() => onSelectPreset(preset)}
                onOpenSimulation={onOpenSimulation}
                showStateBadge
              />
            ))
          )}
        </div>
      ) : (
        /* Vista jerárquica organizada por Estado de México */
        <div className="roi-catalog-groups">
          {grouped.map((countryGroup) => (
            <div key={countryGroup.country} className="roi-country-group">
              <div className="roi-country-header">
                <span className="roi-country-flag">{countryGroup.flag}</span>
                <span className="roi-country-name">
                  {countryGroup.country} ({countryGroup.states.length} {t('Estados Federales', 'Federal States')})
                </span>
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
                              <Sparkles size={10} /> {t('Multizona', 'Multi-zone')}
                            </span>
                          )}
                        </div>
                        <span className="roi-state-count">
                          {presets.length} {presets.length === 1 ? 'ROI' : 'ROIs'}
                        </span>
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

function categoryStyleClass(category: RiskCategory): string {
  switch (category) {
    case 'Inundaciones Costeras':
      return 'roi-badge--coastal'
    case 'Riesgo Pluvial y Fluvial':
      return 'roi-badge--rain'
    case 'Alta Radiación Solar':
      return 'roi-badge--solar'
    case 'Relieve de Montaña':
      return 'roi-badge--mountain'
    case 'Humedales y Manglares':
      return 'roi-badge--wetland'
    default:
      return 'roi-badge--category'
  }
}

function RoiPresetCard({
  preset,
  isActive,
  onSelect,
  onOpenSimulation,
  showStateBadge = false,
}: {
  preset: CatalogRoiPreset
  isActive: boolean
  onSelect: () => void
  onOpenSimulation?: (mode: 'flood' | 'solar') => void
  showStateBadge?: boolean
}) {
  const { t } = useTranslation()

  return (
    <div className={`roi-card ${isActive ? 'is-active' : ''}`}>
      <div className="roi-card__head">
        <div className="roi-card__title-row">
          <MapPin size={13} className="roi-card__pin" />
          <strong className="roi-card__title">{preset.name}</strong>
        </div>
        <div className="roi-card__badges">
          {showStateBadge && (
            <span className="roi-badge roi-badge--state">
              {preset.state}
            </span>
          )}
          <span className={`roi-badge ${categoryStyleClass(preset.riskCategory)}`}>
            {preset.riskCategory}
          </span>
        </div>
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
