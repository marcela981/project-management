import { useState, useMemo, useEffect, useRef } from 'react';
import { useDateRange } from '../hooks/useDateRange.js';
import { fetchTeams, fetchTeamMetrics, fetchDeliveryTrend } from '../dashApi.js';
import { onTimeLogChanged } from '../../core/events.js';
import PeriodSelector from './PeriodSelector.jsx';
import KpiCard from './KpiCard.jsx';
import { AreaChart, DoughnutChart } from './Charts.jsx';
import CapacityHeatmap from './CapacityHeatmap.jsx';

function initials(name) {
    return (name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function RateBadge({ rate }) {
    if (rate == null) return <span>—</span>;
    const rounded = Math.round(rate);
    let cls = 'badge-success';
    let icon = 'fa-check-circle';
    if (rounded < 80)      { cls = 'badge-danger';  icon = 'fa-exclamation-circle'; }
    else if (rounded < 90) { cls = 'badge-warning'; icon = 'fa-clock'; }
    return (
        <span className={`badge ${cls}`}>
            <i className={`fas ${icon}`} style={{ marginRight: '4px' }} />
            {rounded}%
        </span>
    );
}

/** Resolves initial filter state and lock rules from the user's role. */
function resolveRoleConstraints(user) {
    const role = user?.role ?? 'member';
    if (role === 'admin') {
        return { defaultTeam: 'all', defaultMember: 'all', lockTeam: false, lockMember: false };
    }
    if (role === 'leader') {
        return { defaultTeam: 'all', defaultMember: 'all', lockTeam: false, lockMember: false };
    }
    return { defaultTeam: user?.teamId ?? 'all', defaultMember: user?.id ?? 'all', lockTeam: true, lockMember: true };
}

/** Converts API trend response to AreaChart props, grouping excess series as "Otros (N)". */
function toChartProps(trend) {
    const labels = trend?.labels ?? [];
    const series = trend?.series ?? [];
    if (series.length === 0) return { labels, datasets: [] };

    const visible = series.slice(0, 8);
    const rest = series.slice(8);

    const datasets = visible.map(s => ({ label: s.label, data: s.data }));

    if (rest.length > 0) {
        const otrosData = labels.map((_, i) => {
            const vals = rest.map(s => s.data[i]).filter(v => v != null);
            return vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
        });
        datasets.push({ label: `Otros (${rest.length})`, data: otrosData });
    }

    return { labels, datasets };
}

function TrendPlaceholder({ loading }) {
    return (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted, #94a3b8)' }}>
            {loading
                ? <><i className="fas fa-spinner fa-spin" style={{ fontSize: '1.5rem', display: 'block', marginBottom: '0.5rem' }} />Cargando datos...</>
                : <><i className="fas fa-chart-area" style={{ fontSize: '1.5rem', display: 'block', marginBottom: '0.5rem' }} />Sin datos de entrega en el período seleccionado</>
            }
        </div>
    );
}

export default function TeamDashboardView({ user }) {
    const dr = useDateRange('month');
    const constraints = useMemo(() => resolveRoleConstraints(user), [user]);

    const [selectedTeam, setSelectedTeam]     = useState(constraints.defaultTeam);
    const [selectedMember, setSelectedMember] = useState(constraints.defaultMember);
    const [teams, setTeams]                   = useState([]);
    const [teamData, setTeamData]             = useState(null);
    const [metricsLoading, setMetricsLoading] = useState(false);
    const [refreshToken, setRefreshToken]     = useState(0);
    const metricsLoadingRef                   = useRef(false);

    const [trendTeams, setTrendTeams]     = useState({ labels: [], series: [] });
    const [trendMembers, setTrendMembers] = useState({ labels: [], series: [] });
    const [trendLoading, setTrendLoading] = useState(false);

    const [rangeError, setRangeError] = useState(null);
    // activeRange is the "confirmed" range that drives all fetches.
    // For non-custom periods it stays in sync automatically; for custom, only after OK.
    const [activeRange, setActiveRange] = useState({ start: dr.range.start, end: dr.range.end });

    useEffect(() => {
        fetchTeams().then(data => setTeams(data ?? [])).catch(() => {});
    }, []);

    useEffect(() => {
        return onTimeLogChanged(() => {
            if (metricsLoadingRef.current) return;
            setRefreshToken(n => n + 1);
        });
    }, []);

    // Sync activeRange immediately for non-custom periods
    useEffect(() => {
        if (dr.period !== 'custom') {
            setActiveRange({ start: dr.range.start, end: dr.range.end });
        }
    }, [dr.period, dr.range.start, dr.range.end]);

    const handlePeriodChange = (p) => {
        dr.setPeriod(p);
        if (p !== 'custom') setRangeError(null);
    };

    const handleApplyCustom = () => {
        const { customStart, customEnd } = dr;
        if (!customStart || !customEnd) {
            setRangeError('Selecciona ambas fechas.');
            return;
        }
        const diff = (new Date(customEnd) - new Date(customStart)) / 86400000;
        if (diff < 0) {
            setRangeError('La fecha de inicio debe ser anterior a la fecha fin.');
            return;
        }
        if (diff > 365) {
            setRangeError('El rango máximo es 365 días.');
            return;
        }
        setRangeError(null);
        setActiveRange({ start: customStart, end: customEnd });
    };

    // Fetch team metrics when selection, active range, or a timelog mutation changes
    useEffect(() => {
        if (!activeRange.start || !activeRange.end) return;
        if (selectedTeam === 'all') {
            if (!teams.length) return;
            setMetricsLoading(true);
            metricsLoadingRef.current = true;
            Promise.all(
                teams.map(t =>
                    fetchTeamMetrics(t.id, activeRange.start, activeRange.end).catch(() => null)
                )
            )
                .then(results => {
                    const combined = results.flatMap(r => r?.memberMetrics ?? []);
                    setTeamData(combined.length ? { memberMetrics: combined } : null);
                })
                .finally(() => {
                    setMetricsLoading(false);
                    metricsLoadingRef.current = false;
                });
            return;
        }

        setMetricsLoading(true);
        metricsLoadingRef.current = true;
        fetchTeamMetrics(selectedTeam, activeRange.start, activeRange.end)
            .then(data => setTeamData(data ?? null))
            .catch(() => setTeamData(null))
            .finally(() => {
                setMetricsLoading(false);
                metricsLoadingRef.current = false;
            });
    }, [selectedTeam, activeRange.start, activeRange.end, teams, refreshToken]);

    const memberMetrics = teamData?.memberMetrics ?? [];

    const filteredMetrics = useMemo(() => {
        if (selectedMember === 'all') return memberMetrics;
        return memberMetrics.filter(m => String(m.userId) === String(selectedMember));
    }, [memberMetrics, selectedMember]);

    const kpis = useMemo(() => {
        if (!teamData) return { total: 0, completionRate: 0, hoursWorked: 0, avgIel: 0 };

        if (selectedMember !== 'all' && filteredMetrics.length > 0) {
            const m = filteredMetrics[0];
            return {
                total:          m.completedTasks ?? 0,
                completionRate: m.completionRate ?? 0,
                hoursWorked:    m.hoursWorked ?? 0,
                avgIel:         m.iel ?? 0,
            };
        }

        const src = memberMetrics;
        return {
            total:          src.reduce((s, m) => s + (m.completedTasks ?? 0), 0),
            completionRate: src.length ? src.reduce((s, m) => s + (m.completionRate ?? 0), 0) / src.length : 0,
            hoursWorked:    src.reduce((s, m) => s + (m.hoursWorked ?? 0), 0),
            avgIel:         src.length ? src.reduce((s, m) => s + (m.iel ?? 0), 0) / src.length : 0,
        };
    }, [teamData, memberMetrics, filteredMetrics, selectedMember]);

    const hasData = !metricsLoading && teamData !== null;

    const STATUS_LABELS = {
        'completed':        'Completadas',
        'actively-working': 'En proceso',
        'working-now':      'Trabajando ahora',
    };

    const statusChart = useMemo(() => {
        let statusMap = {};

        if (selectedMember !== 'all' && filteredMetrics.length > 0) {
            statusMap = filteredMetrics[0].tasksByStatus ?? {};
        } else if (teamData?.tasksByStatus) {
            // Single team: use the pre-aggregated team-level query
            statusMap = teamData.tasksByStatus;
        } else {
            // All teams combined: sum each member's tasksByStatus
            for (const m of memberMetrics) {
                for (const [s, c] of Object.entries(m.tasksByStatus ?? {})) {
                    statusMap[s] = (statusMap[s] ?? 0) + c;
                }
            }
        }

        const entries = Object.entries(statusMap).filter(([, c]) => c > 0);
        return {
            labels: entries.map(([s]) => STATUS_LABELS[s] ?? s),
            data:   entries.map(([, c]) => c),
        };
    }, [teamData, memberMetrics, filteredMetrics, selectedMember]);

    const capacity = useMemo(() => {
        const DAY_MAP = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie' };
        const today    = new Date().toISOString().split('T')[0];
        const capStart = activeRange.start;
        const capEnd   = activeRange.end < today ? activeRange.end : today;

        const result = {};
        for (const m of memberMetrics) {
            const accum = {};
            for (const [dateStr, seconds] of Object.entries(m.deepWorkByDay ?? {})) {
                if (dateStr < capStart || dateStr > capEnd) continue;
                const dayName = DAY_MAP[new Date(`${dateStr}T12:00:00`).getDay()];
                if (!dayName) continue;
                accum[dayName] = (accum[dayName] ?? 0) + seconds;
            }
            result[m.userId] = Object.fromEntries(
                Object.entries(accum).map(([day, secs]) => [day, Math.round((secs / 3600) * 10) / 10])
            );
        }
        return result;
    }, [memberMetrics, activeRange.start, activeRange.end]);

    // Chart B: teams by default; drill-down to members when a team or member is selected
    useEffect(() => {
        if (!activeRange.start || !activeRange.end) return;
        const scope = (selectedTeam !== 'all' || selectedMember !== 'all') ? 'members' : 'teams';
        const params = { scope, start_date: activeRange.start, end_date: activeRange.end };
        if (selectedTeam !== 'all') params.team_id = selectedTeam;
        if (selectedMember !== 'all') params.user_id = selectedMember;

        const id = setTimeout(() => {
            setTrendLoading(true);
            fetchDeliveryTrend(params)
                .then(data => setTrendTeams(data ?? { labels: [], series: [] }))
                .catch(() => setTrendTeams({ labels: [], series: [] }))
                .finally(() => setTrendLoading(false));
        }, 300);
        return () => clearTimeout(id);
    }, [selectedTeam, selectedMember, activeRange.start, activeRange.end]);

    // Chart A: always individual (scope=members)
    useEffect(() => {
        if (!activeRange.start || !activeRange.end) return;
        const params = { scope: 'members', start_date: activeRange.start, end_date: activeRange.end };
        if (selectedTeam !== 'all') params.team_id = selectedTeam;
        if (selectedMember !== 'all') params.user_id = selectedMember;

        const id = setTimeout(() => {
            fetchDeliveryTrend(params)
                .then(data => setTrendMembers(data ?? { labels: [], series: [] }))
                .catch(() => setTrendMembers({ labels: [], series: [] }));
        }, 300);
        return () => clearTimeout(id);
    }, [selectedTeam, selectedMember, activeRange.start, activeRange.end]);

    const handleTeamChange = (val) => {
        if (constraints.lockTeam) return;
        setSelectedTeam(val);
        if (!constraints.lockMember) setSelectedMember('all');
    };

    const handleMemberChange = (val) => {
        if (constraints.lockMember) return;
        setSelectedMember(val);
    };

    const teamsChartProps   = toChartProps(trendTeams);
    const membersChartProps = toChartProps(trendMembers);

    return (
        <>
            {/* Header + Period */}
            <div className="view-header">
                <h2 className="view-title">
                    <i className="fas fa-tachometer-alt" /> Dashboard del Equipo
                </h2>
                <PeriodSelector
                    period={dr.period}
                    onPeriodChange={handlePeriodChange}
                    customStart={dr.customStart}
                    onCustomStartChange={dr.setCustomStart}
                    customEnd={dr.customEnd}
                    onCustomEndChange={dr.setCustomEnd}
                    onApplyCustom={handleApplyCustom}
                    showCustom={true}
                />
            </div>
            {rangeError && (
                <p style={{ color: 'var(--danger, #ef4444)', fontSize: '0.85rem', margin: '0.25rem 0 0.5rem' }}>
                    <i className="fas fa-exclamation-triangle" style={{ marginRight: '4px' }} />
                    {rangeError}
                </p>
            )}

            {/* Filters */}
            <div className="filter-bar">
                <div className="filter-group">
                    <label className="filter-label">
                        <i className="fas fa-layer-group" /> Equipo
                    </label>
                    <select
                        className="form-select-sm"
                        value={selectedTeam}
                        disabled={constraints.lockTeam}
                        onChange={e => handleTeamChange(e.target.value)}
                    >
                        {!constraints.lockTeam && (
                            <option value="all">Todos los equipos</option>
                        )}
                        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                </div>
                <div className="filter-group">
                    <label className="filter-label">
                        <i className="fas fa-user" /> Miembro
                    </label>
                    <select
                        className="form-select-sm"
                        value={selectedMember}
                        disabled={constraints.lockMember}
                        onChange={e => handleMemberChange(e.target.value)}
                    >
                        {!constraints.lockMember && <option value="all">Todos los miembros</option>}
                        {memberMetrics.map(m => (
                            <option key={m.userId} value={m.userId}>{m.displayName}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Row 1 – KPIs */}
            <div className="metrics-grid">
                <KpiCard color="primary" icon="fa-tasks"
                    value={hasData && !metricsLoading ? kpis.total : '—'}
                    label="Tareas Completadas"
                />
                <KpiCard color="success" icon="fa-clock"
                    value={hasData && !metricsLoading ? `${Math.round(kpis.completionRate)}%` : '—'}
                    label="Tasa de Cumplimiento"
                />
                <KpiCard color="warning" icon="fa-hourglass-half"
                    value={hasData && !metricsLoading ? `${kpis.hoursWorked}h` : '—'}
                    label="Horas Trabajadas"
                />
                <KpiCard color="purple" icon="fa-bolt"
                    value={hasData && !metricsLoading ? kpis.avgIel.toFixed(1) : '—'}
                    label="Efectividad Promedio (IEL)"
                />
            </div>

            {/* Row 2 – Delivery trend area charts */}
            <div className="charts-grid mx">
                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-chart-area" /> Tendencia de Entrega – Equipos
                    </h3>
                    <p className="text-muted text-sm" style={{ marginBottom: '0.5rem' }}>
                        {selectedTeam !== 'all' || selectedMember !== 'all'
                            ? 'Drill-down por persona del equipo seleccionado.'
                            : 'Promedio de días vs deadline por equipo.'}
                    </p>
                    {trendLoading || teamsChartProps.datasets.length === 0
                        ? <TrendPlaceholder loading={trendLoading} />
                        : <AreaChart labels={teamsChartProps.labels} datasets={teamsChartProps.datasets} />
                    }
                </div>

                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-chart-area" /> Tendencia de Entrega – Individual
                    </h3>
                    <p className="text-muted text-sm" style={{ marginBottom: '0.5rem' }}>
                        Días promedio vs deadline por persona. Sobre 0 = entrega temprana; bajo 0 = tardía.
                    </p>
                    {trendLoading || membersChartProps.datasets.length === 0
                        ? <TrendPlaceholder loading={trendLoading} />
                        : <AreaChart labels={membersChartProps.labels} datasets={membersChartProps.datasets} />
                    }
                </div>
            </div>

            {/* Row 3 – Doughnut + Heatmap */}
            <div className="charts-grid mx" style={{ gridTemplateColumns: '2fr 3fr' }}>
                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-chart-pie" /> Distribución por Estado
                    </h3>
                    <DoughnutChart labels={statusChart.labels} data={statusChart.data} />
                </div>

                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-fire" /> Mapa de Calor – Capacidad Semanal
                    </h3>
                    <p className="text-muted text-sm" style={{ marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
                        Horas trabajadas por día. Asigna tareas urgentes a quien tenga menor carga.
                    </p>
                    <CapacityHeatmap
                        members={filteredMetrics}
                        capacity={capacity}
                    />
                </div>
            </div>

            {/* Row 4 – Member detail table */}
            <div className="section-card mx">
                <h3 className="section-title">
                    <i className="fas fa-users" /> Detalle por Miembro
                </h3>
                <div className="table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Miembro</th>
                                <th>Tareas Completadas</th>
                                <th>Tasa de Cumplimiento</th>
                                <th>Horas Trabajadas</th>
                                <th>IEL</th>
                                <th>SLA Prom. (días)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {metricsLoading && (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                                        <i className="fas fa-spinner fa-spin" style={{ marginRight: '0.5rem' }} />
                                        Cargando métricas...
                                    </td>
                                </tr>
                            )}
                            {!metricsLoading && !hasData && (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                                        {teams.length === 0
                                            ? 'Cargando equipos...'
                                            : 'No hay datos para el período seleccionado.'}
                                    </td>
                                </tr>
                            )}
                            {!metricsLoading && hasData && filteredMetrics.map(m => (
                                <tr key={m.userId}>
                                    <td>
                                        <div className="member-cell">
                                            <div className="member-avatar">{initials(m.displayName)}</div>
                                            <div className="member-name">{m.displayName}</div>
                                        </div>
                                    </td>
                                    <td>{m.completedTasks ?? 0}</td>
                                    <td><RateBadge rate={m.completionRate} /></td>
                                    <td>{m.hoursWorked != null ? `${m.hoursWorked}h` : '—'}</td>
                                    <td>{m.iel != null ? m.iel.toFixed(1) : '—'}</td>
                                    <td>{m.slaAvgDays != null ? m.slaAvgDays.toFixed(1) : '—'}</td>
                                </tr>
                            ))}
                            {!metricsLoading && hasData && filteredMetrics.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                                        Sin datos para los filtros seleccionados.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}
