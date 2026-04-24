import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchMyMetrics, fetchUserSkills } from '../dashApi.js';
import { useDateRange } from '../hooks/useDateRange.js';
import { onTimeLogChanged } from '../../core/events.js';
import PeriodSelector from './PeriodSelector.jsx';
import KpiCard from './KpiCard.jsx';
import { LineChart, BarChart, GaugeChart, BellChart, RadarChart } from './Charts.jsx';
import HeatMap from './HeatMap.jsx';
import Treemap from './Treemap.jsx';
import Badges from './Badges.jsx';

function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rateHint(rate) {
    if (rate == null) return '';
    if (rate >= 90) return '🎯 Excelente';
    if (rate >= 70) return '✅ Bien';
    if (rate >= 50) return '⚠️ Regular';
    return '❌ A mejorar';
}

function ielHint(iel) {
    if (iel == null) return 'C × (1 + oportunidad)';
    if (iel >= 100) return '🚀 Por encima del objetivo';
    if (iel >= 80)  return '✅ Efectividad alta';
    if (iel >= 60)  return '⚠️ Efectividad media';
    return '❌ Efectividad baja';
}

function slaHintClass(days) {
    if (days <= 3) return 'text-success';
    if (days <= 7) return 'text-warning';
    return 'text-danger';
}

function slaHintText(days) {
    if (days <= 3) return '✅ Excelente cierre';
    if (days <= 7) return '⚠️ Dentro del rango';
    return '❌ Mejorar tiempo de cierre';
}

const SLA_COLOR_STOPS = [
    { pct: 30, color: '#10b981' },
    { pct: 60, color: '#f59e0b' },
    { pct: 100, color: '#ef4444' },
];

export default function MyMetricsView({ user }) {
    const dr = useDateRange('month');
    const [data, setData]       = useState(null);
    const [skills, setSkills]   = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);
    const fetchingRef           = useRef(false);
    const rangeRef              = useRef({ start: dr.range.start, end: dr.range.end });

    const load = useCallback((start, end) => {
        setLoading(true);
        setError(null);
        fetchingRef.current = true;

        Promise.all([
            fetchMyMetrics(start, end),
            user?.id ? fetchUserSkills(user.id).catch(() => null) : Promise.resolve(null),
        ])
            .then(([metricsData, skillsData]) => {
                setData(metricsData);
                setSkills(skillsData ?? metricsData?.skills ?? []);
            })
            .catch(err => setError(err.message))
            .finally(() => {
                setLoading(false);
                fetchingRef.current = false;
            });
    }, [user?.id]);

    useEffect(() => {
        rangeRef.current = { start: dr.range.start, end: dr.range.end };
        load(dr.range.start, dr.range.end);
    }, [dr.range.start, dr.range.end, load]);

    useEffect(() => {
        return onTimeLogChanged(() => {
            if (fetchingRef.current) return;
            load(rangeRef.current.start, rangeRef.current.end);
        });
    }, [load]);

    const handlePeriod = key => {
        dr.setPeriod(key);
    };

    const handleApplyCustom = () => {
        if (dr.customStart && dr.customEnd) {
            load(dr.customStart, dr.customEnd);
        }
    };

    if (loading) {
        return (
            <>
                <Header dr={dr} onPeriod={handlePeriod} onApply={handleApplyCustom} />
                <div className="loading-state">
                    <i className="fas fa-spinner fa-spin" /> Cargando…
                </div>
            </>
        );
    }

    if (error) {
        return (
            <>
                <Header dr={dr} onPeriod={handlePeriod} onApply={handleApplyCustom} />
                <div className="error-state">
                    <i className="fas fa-exclamation-circle" /> {error}
                </div>
            </>
        );
    }

    if (!data) {
        return (
            <>
                <Header dr={dr} onPeriod={handlePeriod} onApply={handleApplyCustom} />
                <div className="empty-state">Sin datos para el período seleccionado.</div>
            </>
        );
    }

    const iel            = data.iel ?? data.effectiveness ?? data.effectivenessIndex;
    const slaAvgDays     = data.slaAvgDays;
    const teamPercentile = data.teamPercentile;
    const truncate       = s => (s.length > 12 ? s.slice(0, 12) + '…' : s);

    return (
        <>
            <Header dr={dr} onPeriod={handlePeriod} onApply={handleApplyCustom} />

            {/* Row 1: KPI base (solo 4 tarjetas principales) */}
            <div className="metrics-grid">
                <KpiCard
                    color="primary" icon="fa-check-circle"
                    value={data.completedTasks ?? 0}
                    label="Tareas completadas"
                    subtext={data.totalTasks ? `de ${data.totalTasks} totales` : 'este período'}
                />
                <KpiCard
                    color="success" icon="fa-percentage"
                    value={data.completionRate != null ? Math.round(data.completionRate) + '%' : '—'}
                    label="Tasa de cumplimiento"
                    subtext={rateHint(data.completionRate)}
                />
                <KpiCard
                    color="warning" icon="fa-clock"
                    value={data.hoursWorked != null ? (Math.round(data.hoursWorked * 10) / 10) + 'h' : '—'}
                    label="Horas trabajadas"
                    subtext="tiempo registrado"
                />
                <KpiCard
                    color="iel" icon="fa-chart-line"
                    value={iel != null ? Math.round(iel) + '%' : '—'}
                    label="Índice de Efectividad"
                    subtext={ielHint(iel)}
                />
            </div>

            {/* Tendencia temporal */}
            {data.tasksByMonth?.length > 0 && (
                <div className="section-card mx">
                    <h3 className="chart-title">
                        <i className="fas fa-chart-area" /> Tendencia Temporal
                    </h3>
                    <LineChart
                        labels={data.tasksByMonth.map(m => m.month)}
                        datasets={[{ label: 'Tareas completadas', data: data.tasksByMonth.map(m => m.count ?? 0) }]}
                    />
                </div>
            )}

            {/* Previsibilidad + SLA Gauge */}
            <div className="charts-grid mx">
                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-crosshairs" /> Previsibilidad – Estimado vs Real
                    </h3>
                    {data.predictabilityByTask?.length > 0 ? (
                        <BarChart
                            labels={data.predictabilityByTask.map(t => truncate(esc(t.title)))}
                            datasets={[
                                { label: 'Estimado (h)', data: data.predictabilityByTask.map(t => t.estimated ?? 0) },
                                { label: 'Real (h)',     data: data.predictabilityByTask.map(t => t.actual ?? 0) },
                            ]}
                        />
                    ) : (
                        <div className="chart-placeholder">
                            <i className="fas fa-crosshairs fa-2x" />
                            <p>Sin datos de estimación registrados aún</p>
                        </div>
                    )}
                </div>

                <div className="chart-card chart-card-gauge">
                    <h3 className="chart-title">
                        <i className="fas fa-flag-checkered" /> SLA – Tiempo de cierre
                    </h3>
                    <div className="gauge-wrap">
                        <div className="gauge-canvas-box">
                            {slaAvgDays != null ? (
                                <GaugeChart value={slaAvgDays} max={14} colorStops={SLA_COLOR_STOPS} />
                            ) : null}
                        </div>
                        <div className="gauge-label-box">
                            <span className="gauge-big">
                                {slaAvgDays != null ? Math.round(slaAvgDays * 10) / 10 : '—'}
                            </span>
                            <span className="gauge-unit">
                                {slaAvgDays != null ? 'días promedio' : 'sin datos'}
                            </span>
                        </div>
                    </div>
                    {slaAvgDays != null && (
                        <p className={`gauge-hint ${slaHintClass(slaAvgDays)}`}>
                            {slaHintText(slaAvgDays)}
                        </p>
                    )}
                </div>
            </div>

            {/* Deep Work + Skills Radar */}
            <div className="charts-grid mx">
                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-brain" /> Deep Work – últimas 12 semanas
                    </h3>
                    <HeatMap byDay={data.deepWorkByDay ?? {}} />
                </div>

                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-star" /> Mis Skills
                    </h3>
                    {skills.length > 0 ? (
                        <RadarChart
                            labels={skills.map(s => s.name ?? s.skillName ?? 'Skill')}
                            datasets={[{ label: 'Mi score', data: skills.map(s => s.score ?? 0) }]}
                        />
                    ) : (
                        <div className="chart-placeholder">
                            <i className="fas fa-star fa-2x" />
                            <p>Registra tus skills en la pestaña Skills</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Balance de Carga */}
            {data.tasksByCategory?.length > 0 && (
                <div className="section-card mx">
                    <h3 className="chart-title">
                        <i className="fas fa-th" /> Balance de Carga
                    </h3>
                    <Treemap data={data.tasksByCategory} />
                </div>
            )}

            {/* Gamificación + Benchmarking */}
            <div className="charts-grid mx">
                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-trophy" /> Logros
                    </h3>
                    <Badges data={{ ...data, skills }} />
                </div>

                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-users" /> Benchmarking vs equipo
                    </h3>
                    {teamPercentile != null ? (
                        <>
                            <BellChart percentile={teamPercentile} />
                            <p className="text-muted text-sm bell-footnote">
                                Percentil <strong>{Math.round(teamPercentile)}</strong> – mejor que el{' '}
                                {Math.round(teamPercentile)}% de tu equipo
                            </p>
                        </>
                    ) : (
                        <div className="chart-placeholder">
                            <i className="fas fa-users fa-2x" />
                            <p>Sin datos de comparativa del equipo</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Tareas difíciles */}
            {data.difficultTasks?.length > 0 && (
                <div className="section-card mx">
                    <h3 className="section-title">
                        <i className="fas fa-fire" /> Tareas difíciles
                    </h3>
                    <div className="difficult-list">
                        {data.difficultTasks.map((t, i) => (
                            <div key={i} className="difficult-item">
                                <div className="difficult-name">{esc(t.title)}</div>
                                <div className="difficult-meta">
                                    <span className="badge badge-danger">
                                        Dificultad {t.difficulty ?? '?'}/10
                                    </span>
                                    {t.reason && (
                                        <span className="text-muted text-sm">{esc(t.reason)}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}

function Header({ dr, onPeriod, onApply }) {
    return (
        <div className="view-header">
            <h2 className="view-title">
                <i className="fas fa-chart-bar" /> Mis Métricas
            </h2>
            <PeriodSelector
                period={dr.period}
                onPeriodChange={onPeriod}
                customStart={dr.customStart}
                onCustomStartChange={dr.setCustomStart}
                customEnd={dr.customEnd}
                onCustomEndChange={dr.setCustomEnd}
                onApplyCustom={onApply}
            />
        </div>
    );
}
