import React, { useEffect, useMemo, useState } from 'react';
import { PuzzleDefinition } from '@shared/runtime/executionEngine';

interface AnalyticsDashboardProps {
  apiBaseUrl: string;
  puzzles: PuzzleDefinition[];
}

interface DashboardSummaryResponse {
  totals: {
    sessions: number;
    attempts: number;
    successRate: number;
    avgAttemptsPerPuzzle: number;
    avgTimeSeconds: number;
  };
  puzzles: Array<{
    puzzleId: number;
    attempts: number;
    successRate: number;
    avgTimeSeconds: number;
  }>;
}

interface PuzzleDetailResponse {
  puzzleId: number;
  attempts: Array<AttemptDetail>;
}

interface AttemptDetail {
  attemptId: string;
  result: 'success' | 'failure' | 'aborted';
  failureReason?: string;
  executionSteps: number;
  codeSnapshotJson: string;
  startedAt: number;
  endedAt?: number;
  movements: Array<MovementPoint>;
}

interface MovementPoint {
  ts: number;
  x: number;
  y: number;
}

interface EventRecord {
  id: string;
  ts: number;
  type: string;
  payload_json: Record<string, unknown>;
}

const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ apiBaseUrl, puzzles }) => {
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<number>(puzzles[0]?.id ?? 1);
  const [puzzleDetail, setPuzzleDetail] = useState<PuzzleDetailResponse | null>(null);
  const [puzzleError, setPuzzleError] = useState<string | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventFilters, setEventFilters] = useState({ sessionId: '', attemptId: '', puzzleId: '' });
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const fetchSummary = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/analytics/dashboard`);
        if (!response.ok) throw new Error('Failed to load dashboard metrics');
        const json = (await response.json()) as DashboardSummaryResponse;
        if (mounted) {
          setSummary(json);
          setSummaryError(null);
        }
      } catch (error) {
        console.error(error);
        if (mounted) setSummaryError((error as Error).message);
      }
    };
    fetchSummary();
    const interval = setInterval(fetchSummary, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [apiBaseUrl]);

  useEffect(() => {
    let mounted = true;
    const fetchPuzzleDetail = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/analytics/puzzles/${selectedPuzzleId}`);
        if (!response.ok) throw new Error('Failed to load puzzle detail');
        const json = (await response.json()) as PuzzleDetailResponse;
        if (mounted) {
          setPuzzleDetail(json);
          setPuzzleError(null);
          setSelectedAttemptId(json.attempts[0]?.attemptId ?? null);
        }
      } catch (error) {
        console.error(error);
        if (mounted) setPuzzleError((error as Error).message);
      }
    };
    fetchPuzzleDetail();
    return () => {
      mounted = false;
    };
  }, [apiBaseUrl, selectedPuzzleId]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        setEventsLoading(true);
        const params = new URLSearchParams();
        if (eventFilters.sessionId) params.append('sessionId', eventFilters.sessionId);
        if (eventFilters.attemptId) params.append('attemptId', eventFilters.attemptId);
        if (eventFilters.puzzleId) params.append('puzzleId', eventFilters.puzzleId);
        const url = `${apiBaseUrl}/api/analytics/events${params.toString() ? `?${params}` : ''}`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Failed to load events');
        const json = (await response.json()) as EventRecord[];
        setEvents(json);
        setEventsError(null);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error(error);
        setEventsError((error as Error).message);
      } finally {
        setEventsLoading(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [apiBaseUrl, eventFilters]);

  const selectedPuzzle = useMemo(() => puzzles.find((p) => p.id === selectedPuzzleId), [puzzles, selectedPuzzleId]);
  const selectedAttempt = useMemo(() => {
    if (!puzzleDetail) return null;
    return puzzleDetail.attempts.find((attempt) => attempt.attemptId === selectedAttemptId) ?? puzzleDetail.attempts[0] ?? null;
  }, [puzzleDetail, selectedAttemptId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        {summary ? (
          <>
            <MetricCard label="Sessions" value={summary.totals.sessions.toLocaleString()} />
            <MetricCard label="Attempts" value={summary.totals.attempts.toLocaleString()} />
            <MetricCard label="Success Rate" value={`${(summary.totals.successRate * 100).toFixed(1)}%`} />
            <MetricCard label="Avg Attempts / Puzzle" value={summary.totals.avgAttemptsPerPuzzle.toFixed(2)} />
            <MetricCard label="Avg Time (s)" value={summary.totals.avgTimeSeconds.toFixed(1)} />
          </>
        ) : summaryError ? (
          <div>{summaryError}</div>
        ) : (
          <div>Loading dashboard…</div>
        )}
      </section>

      <section style={{ background: '#fff', borderRadius: 20, padding: '1.5rem', boxShadow: '0 12px 40px rgba(15,23,42,0.08)' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Puzzle Detail</h3>
          <select value={selectedPuzzleId} onChange={(event) => setSelectedPuzzleId(Number(event.target.value))}>
            {puzzles.map((puzzle) => (
              <option key={puzzle.id} value={puzzle.id}>
                Puzzle {puzzle.id}: {puzzle.title}
              </option>
            ))}
          </select>
        </header>
        {puzzleError && <div style={{ color: '#b91c1c' }}>{puzzleError}</div>}
        {puzzleDetail ? (
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <div style={{ flex: 1, maxHeight: 360, overflowY: 'auto' }}>
              {puzzleDetail.attempts.map((attempt) => (
                <article
                  key={attempt.attemptId}
                  onClick={() => setSelectedAttemptId(attempt.attemptId)}
                  style={{
                    border: attempt.attemptId === selectedAttemptId ? '2px solid #6f58ff' : '1px solid #e2e8f0',
                    borderRadius: 16,
                    padding: '0.85rem',
                    marginBottom: '0.75rem',
                    cursor: 'pointer',
                    background: 'rgba(111,88,255,0.04)'
                  }}
                >
                  <strong>{attempt.result.toUpperCase()}</strong> — Steps: {attempt.executionSteps}
                  {attempt.failureReason && <span> · {attempt.failureReason}</span>}
                  <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                    {new Date(attempt.startedAt).toLocaleString()}
                  </div>
                </article>
              ))}
            </div>
            <div style={{ flex: 1 }}>
              {selectedAttempt && selectedPuzzle ? (
                <MovementReplay attempt={selectedAttempt} puzzle={selectedPuzzle} />
              ) : (
                <div>No attempts yet.</div>
              )}
            </div>
          </div>
        ) : (
          <div>Loading puzzle detail…</div>
        )}
      </section>

      <section style={{ background: '#fff', borderRadius: 20, padding: '1.5rem', boxShadow: '0 12px 40px rgba(15,23,42,0.08)' }}>
        <header style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input
            placeholder="Filter by session"
            value={eventFilters.sessionId}
            onChange={(event) => setEventFilters((prev) => ({ ...prev, sessionId: event.target.value }))}
          />
          <input
            placeholder="Filter by attempt"
            value={eventFilters.attemptId}
            onChange={(event) => setEventFilters((prev) => ({ ...prev, attemptId: event.target.value }))}
          />
          <input
            placeholder="Filter by puzzle"
            value={eventFilters.puzzleId}
            onChange={(event) => setEventFilters((prev) => ({ ...prev, puzzleId: event.target.value }))}
          />
        </header>
        {eventsError && <div style={{ color: '#b91c1c' }}>{eventsError}</div>}
        {eventsLoading ? (
          <div>Loading events…</div>
        ) : (
          <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Timestamp</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td style={{ padding: '0.5rem', borderTop: '1px solid #e2e8f0' }}>
                    {new Date(event.ts).toLocaleTimeString()}
                  </td>
                  <td style={{ padding: '0.5rem', borderTop: '1px solid #e2e8f0' }}>{event.type}</td>
                  <td style={{ padding: '0.5rem', borderTop: '1px solid #e2e8f0' }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(event.payload_json, null, 2)}</pre>
                  </td>
                </tr>
              ))}
              {!events.length && (
                <tr>
                  <td colSpan={3} style={{ padding: '0.75rem', textAlign: 'center' }}>
                    No events for filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <article
    style={{
      background: '#fff',
      borderRadius: 16,
      padding: '1rem',
      boxShadow: '0 8px 24px rgba(15,23,42,0.08)'
    }}
  >
    <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>{label}</div>
    <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{value}</div>
  </article>
);

const MovementReplay: React.FC<{ attempt: AttemptDetail; puzzle: PuzzleDefinition }> = ({ attempt, puzzle }) => {
  const tileSize = puzzle.grid.tileSize ?? 48;
  const width = puzzle.grid.width * tileSize;
  const height = puzzle.grid.height * tileSize;
  const movementCount = attempt.movements?.length ?? 0;
  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Movement Replay</h4>
      <div style={{ position: 'relative', width, height, borderRadius: 18, background: '#f8fafc' }}>
        {(attempt.movements ?? []).map((move, index) => (
          <div
            key={`${move.ts}-${index}`}
            style={{
              position: 'absolute',
              left: move.x * tileSize + tileSize / 2,
              top: move.y * tileSize + tileSize / 2,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: index === movementCount - 1 ? '#22c55e' : '#3b82f6',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 8px rgba(59,130,246,0.4)'
            }}
          />
        ))}
      </div>
      <pre style={{ maxHeight: 160, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', padding: '0.75rem', borderRadius: 12 }}>
        {attempt.codeSnapshotJson}
      </pre>
    </div>
  );
};

export default AnalyticsDashboard;
