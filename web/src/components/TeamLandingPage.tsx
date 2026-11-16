import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, GraduationCap, MapPin, X } from 'lucide-react'
import { useTranslation } from '../i18n/useTranslation'

export interface TeamLandingPageProps {
  /** Cierra la landing y devuelve el control a la estación de trabajo (conserva mapa y análisis). */
  onClose: () => void
}

interface TeamMember {
  name: string
  role: string
  location: 'México'
  /** Foto de perfil en `web/public/team/`; si falta o no carga, la tarjeta muestra las iniciales. */
  photo: string
}

/** Integrantes del equipo (`MonitosCH`, Chiapas, México). */
const TEAM_MEMBERS: readonly TeamMember[] = Object.freeze([
  {
    name: 'Flavio Cesar Hernandez Ruiz',
    role: 'Integrante',
    location: 'México',
    photo: '/team/flavio-cesar-hernandez-ruiz.jpg',
  },
  {
    name: 'Esteban Pérez González',
    role: 'Integrante',
    location: 'México',
    photo: '/team/esteban-perez-gonzalez.jpg',
  },
  {
    name: 'Luis Manuel Sánchez Gómez',
    role: 'Integrante',
    location: 'México',
    photo: '/team/luis-manuel-sanchez-gomez.jpg',
  },
  {
    name: 'Juan Diego Sarabia Cadenas',
    role: 'Integrante',
    location: 'México',
    photo: '/team/juan-diego-sarabia-cadenas.jpg',
  },
  {
    name: 'Julian Antonio Castro Alonso',
    role: 'Integrante',
    location: 'México',
    photo: '/team/julian-antonio-castro-alonso.jpg',
  },
  {
    name: 'Gunther Nettel Rosario',
    role: 'Integrante',
    location: 'México',
    photo: '/team/gunther-nettel-rosario.jpg',
  },
])

/** Iniciales del nombre y del primer apellido, p. ej. «Flavio Cesar Hernandez Ruiz» → «FR». */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return ''
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/** Avatar con la foto del integrante y respaldo en iniciales si la imagen no está disponible. */
function TeamAvatar({ name, photo }: { name: string; photo: string }) {
  const [failed, setFailed] = useState(false)

  return (
    <span className="team-card__avatar" aria-hidden="true">
      {failed ? (
        <span>{initials(name)}</span>
      ) : (
        <img src={photo} alt="" loading="lazy" onError={() => setFailed(true)} />
      )}
    </span>
  )
}

/**
 * Landing Page institucional del equipo MonitosCH.
 *
 * Vista modal de pantalla completa: se superpone a la estación de trabajo sin desmontarla, así que
 * el mapa, las capas y las anotaciones conservan su estado al volver. Todo el contenido es
 * institucional; no muestra métricas ni resultados del análisis (AGENTS.md §2).
 */
export function TeamLandingPage({ onClose }: TeamLandingPageProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const membersTitleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [logoFailed, setLogoFailed] = useState(false)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="team-landing" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="team-landing__bar">
        <span className="team-landing__bar-label">
          {t('MonitosCH · Página del equipo — NASA Space Apps Challenge 2026', 'MonitosCH · Team page — NASA Space Apps Challenge 2026')}
        </span>
        <button
          ref={closeRef}
          type="button"
          className="btn btn--sm team-landing__back"
          onClick={onClose}
          title={t('Cerrar la página y volver al mapa (Esc)', 'Close the page and return to the map (Esc)')}
        >
          <X size={14} aria-hidden="true" />
          <span>{t('Volver a la estación de trabajo', 'Return to the workstation')}</span>
        </button>
      </div>

      <div className="team-landing__scroll">
        <div className="team-landing__sheet">
          <header className="team-landing__hero">
            <div className="team-landing__hero-media">
              <div className="team-logo-slot team-logo-slot--hero">
                {logoFailed ? (
                  <span className="team-landing__logo-fallback" aria-hidden="true">
                    MCH
                  </span>
                ) : (
                  <img
                    className="team-landing__logo"
                    src="/monitosch-logo.png"
                    alt={t('Emblema del equipo MonitosCH: un mono astronauta con casco y cohete', 'MonitosCH team emblem: an astronaut monkey with a helmet and rocket')}
                    onError={() => setLogoFailed(true)}
                  />
                )}
              </div>
              <span className="team-landing__logo-caption">MonitosCH · Chiapas, {t('México', 'Mexico')}</span>
            </div>

            <div className="team-landing__hero-body">
              <p className="team-landing__eyebrow">NASA Space Apps Challenge 2026</p>
              <h1 id={titleId} className="team-landing__title">
                MonitosCH
              </h1>
              <p className="team-landing__subtitle">
                {t('TerraPulse AI — Plataforma Abierta de Observación Terrestre y Análisis SAR con Datos NISAR', 'TerraPulse AI — Open Earth Observation and SAR Analysis Platform with NISAR Data')}
              </p>
              <p className="team-landing__creed">
                <GraduationCap size={13} aria-hidden="true" />
                <span>
                  {t('Estudiantes de la Licenciatura en Desarrollo y Tecnologías de Software', 'Undergraduate students in Software Development and Technologies')}
                </span>
              </p>
              <p className="team-landing__description">
                {t('Somos MonitosCH, un equipo multidisciplinario de ingeniería, desarrollo de software y análisis geoespacial desde Chiapas, México. Diseñamos TerraPulse AI para transformar observaciones satelitales de radar de apertura sintética (NISAR L-band) en evidencia científica trazable, reproducible y comprensible sobre las transformaciones de la superficie terrestre, combinando procesamiento físico riguroso, validación independiente y visualización interactiva.', 'We are MonitosCH, a multidisciplinary engineering, software development and geospatial analysis team based in Chiapas, Mexico. We designed TerraPulse AI to turn synthetic aperture radar satellite observations (NISAR L-band) into traceable, reproducible and understandable scientific evidence about changes to Earth’s surface, combining rigorous physical processing, independent validation and interactive visualization.')}
              </p>

              <div className="team-landing__actions">
                <button type="button" className="btn btn--primary" onClick={onClose}>
                  <span>{t('Explorar la estación de trabajo NISAR', 'Explore the NISAR workstation')}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
                <button type="button" className="btn btn--ghost" onClick={onClose}>
                  <span>{t('Volver a la estación de trabajo', 'Return to the workstation')}</span>
                </button>
              </div>
            </div>
          </header>

          <section className="team-landing__section" aria-labelledby={membersTitleId}>
            <div className="team-landing__section-head">
              <h2 id={membersTitleId} className="team-landing__section-title">
                {t('Integrantes del equipo', 'Team Members')}
              </h2>
              <span className="team-landing__section-meta">
                {t('{count} integrantes · México', '{count} members · Mexico', { count: TEAM_MEMBERS.length })}
              </span>
            </div>

            <ul className="team-landing__grid">
              {TEAM_MEMBERS.map((member) => (
                <li key={member.name} className="team-card">
                  <TeamAvatar name={member.name} photo={member.photo} />
                  <div className="team-card__body">
                    <span className="team-card__name">{member.name}</span>
                    <span className="team-card__role">{t('Integrante', 'Member')}</span>
                    <span className="team-card__meta">
                      <MapPin size={11} aria-hidden="true" />
                      {t('México', 'Mexico')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <footer className="team-landing__footer">
            <p>
              <strong>{t('Caso de estudio actual:', 'Current case study:')}</strong> Chiapas, {t('México', 'Mexico')} ·{' '}
              <code>EPSG:32615</code> · {t('productos', 'products')} <strong>NISAR L2 GCOV</strong> (Frequency A,
              L-band, 10 × 10 m).
            </p>
            <p>
              <strong>{t('Enfoque:', 'Approach:')}</strong> {t('trazabilidad científica abierta. Cada cifra publicada debe poder rastrearse hasta las escenas, fechas, parámetros y código que la produjeron: dato original → procesamiento → métrica → interpretación.', 'open scientific traceability. Every published figure must be traceable to the scenes, dates, parameters and code that produced it: original data → processing → metric → interpretation.')}
            </p>
            <p className="team-landing__footer-note">
              {t('Las anotaciones del mapa son marcas del usuario: no son detecciones ni resultados del análisis.', 'Map annotations are user marks: they are neither detections nor analysis results.')}
            </p>
          </footer>
        </div>
      </div>
    </div>
  )
}

export default TeamLandingPage
