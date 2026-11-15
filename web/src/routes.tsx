import type { ComponentType } from 'react'
import ExploradorFeature from './features/explorador'
import ComparadorFeature from './features/comparador'
import LaboratorioFeature from './features/laboratorio'
import ExportacionFeature from './features/exportacion'

export type FeatureRouteId = 'explorador' | 'comparador' | 'laboratorio' | 'exportacion'

export interface FeatureRouteConfig {
  id: FeatureRouteId
  path: string
  label: string
  owner: 'P5' | 'P6'
  component: ComponentType<never>
}

/**
 * Registro oficial de los 4 módulos del frontend (`docs/plan-de-trabajo.md` §2 y §6).
 */
export const FEATURE_ROUTES: readonly FeatureRouteConfig[] = [
  {
    id: 'explorador',
    path: '/explorador',
    label: 'Explorador Global',
    owner: 'P5',
    component: ExploradorFeature as ComponentType<never>,
  },
  {
    id: 'comparador',
    path: '/comparador',
    label: 'Comparador Temporal',
    owner: 'P5',
    component: ComparadorFeature as ComponentType<never>,
  },
  {
    id: 'laboratorio',
    path: '/laboratorio',
    label: 'Laboratorio Científico',
    owner: 'P6',
    component: LaboratorioFeature,
  },
  {
    id: 'exportacion',
    path: '/exportacion',
    label: 'Exportación',
    owner: 'P6',
    component: ExportacionFeature,
  },
]
