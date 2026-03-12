import React, { useEffect, useMemo, useRef, useState } from 'react';
import Workspace, { PlaybackSpeed } from './components/Workspace/Workspace';
import GameCanvas from './game/GameCanvas';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import puzzlesJson from '@shared/puzzles/puzzles.json';
import {
  FailureReason,
  PuzzleDefinition,
  RuntimeEvent,
  executeProgram
} from '@shared/runtime/executionEngine';
import {
  WorkspaceProgram,
  createEmptyProgram,
  serializeProgram,
  countBlocks
} from './lib/program';
import { TelemetryClient } from './lib/telemetry';
import './App.css';

const { puzzles, version, theme } = puzzlesJson as {
  puzzles: PuzzleDefinition[];
  version: string;
  theme: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

type RunState = 'editing' | 'running' | 'success' | 'failure';

interface ProgressEntry {
  completed: boolean;
  unlocked: boolean;
}

const buildInitialPrograms = (): Record<number, WorkspaceProgram> => {
  return puzzles.reduce((map, puzzle) => {
    map[puzzle.id] = createEmptyProgram();
    return map;
  }, {} as Record<number, WorkspaceProgram>);
};

const buildInitialProgress = (): Record<number, ProgressEntry> => {
  return puzzles.reduce((map, puzzle, index) => {
    map[puzzle.id] = {
      completed: false,
      unlocked: index === 0
    };
    return map;
  }, {} as Record<number, ProgressEntry>);
};

const playbackDelayFor = (speed: PlaybackSpeed): number => {
  switch (speed) {
    case 'slow':
      return 650;
    case 'fast':
      return 220;
    default:
      return 380;
  }
};

const App: React.FC = () => {
  const [programs, setPrograms] = useState<Record<number, WorkspaceProgram>>(buildInitialPrograms);
  const [currentPuzzleId, setCurrentPuzzleId] = useState<number>(puzzles[0]?.id ?? 1);
  const [progress, setProgress] = useState<Record<number, ProgressEntry>>(buildInitialProgress);
  const [runState, setRunState] = useState<RunState>('editing');
  const [canvasEvents, setCanvasEvents] = useState<RuntimeEvent[] | null>(null);
  const [hint, setHint] = useState<string | undefined>();
  const [failureReason, setFailureReason] = useState<FailureReason | undefined>();
  const [disconnectedBlocks, setDisconnectedBlocks] = useState<string[]>([]);
  const [showCode, setShowCode] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>('normal');
  const [viewMode, setViewMode] = useState<'play' | 'analytics'>('play');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const [stepPreviewCount, setStepPreviewCount] = useState(0);
  const runTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const telemetry = useMemo(() => new TelemetryClient(API_BASE_URL), []);

  const currentPuzzle = useMemo(() => puzzles.find((p) => p.id === currentPuzzleId) ?? puzzles[0], [currentPuzzleId]);
  const currentProgram = programs[currentPuzzle.id] ?? createEmptyProgram();

  useEffect(() => {
    let cancelled = false;
    async function startSession() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/session/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locale: navigator.language,
            userAgent: navigator.userAgent
          })
        });
        if (!response.ok) throw new Error('Unable to start session');
        const json = await response.json();
        if (!cancelled) {
          setSessionId(json.sessionId);
          telemetry.configureContext({ sessionId: json.sessionId });
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) setSessionError((error as Error).message);
      }
    }
    startSession();
    return () => {
      cancelled = true;
    };
  }, [telemetry]);

  useEffect(() => {
    if (!sessionId) return;
    const sendEnd = () => {
      const payload = JSON.stringify({ sessionId });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${API_BASE_URL}/api/session/end`, payload);
      } else {
        fetch(`${API_BASE_URL}/api/session/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        }).catch(() => undefined);
      }
    };
    window.addEventListener('beforeunload', sendEnd);
    return () => {
      sendEnd();
      window.removeEventListener('beforeunload', sendEnd);
    };
  }, [sessionId]);

  useEffect(() => {
    setStepPreviewCount(0);
  }, [currentPuzzleId]);

  useEffect(() => {
    return () => {
      if (runTimerRef.current) {
        clearTimeout(runTimerRef.current);
        runTimerRef.current = null;
      }
    };
  }, []);

  const markProgress = () => {
    setProgress((prev) => {
      const next: Record<number, ProgressEntry> = { ...prev };
      next[currentPuzzle.id] = { ...(next[currentPuzzle.id] ?? { completed: false, unlocked: true }), completed: true };
      const puzzleIndex = puzzles.findIndex((p) => p.id === currentPuzzle.id);
      const nextPuzzle = puzzles[puzzleIndex + 1];
      if (nextPuzzle) {
        const existing = next[nextPuzzle.id] ?? { completed: false, unlocked: false };
        next[nextPuzzle.id] = { ...existing, unlocked: true };
      }
      return next;
    });
  };

  const handleProgramChange = (nextProgram: WorkspaceProgram) => {
    setPrograms((prev) => ({ ...prev, [currentPuzzle.id]: nextProgram }));
  };

  const handleWorkspaceEvent = (event: { type: string; payload?: Record<string, unknown> }) => {
    telemetry.log({
      type: event.type,
      payload: { ...event.payload, puzzleId: currentPuzzle.id }
    });
  };

  const handlePlay = async () => {
    if (!sessionId) {
      setSessionError('Waiting for session start…');
      return;
    }
    const programGraph = serializeProgram(currentProgram);
    const blockCount = countBlocks(currentProgram);
    telemetry.log({
      type: 'ui.play_clicked',
      importance: 'critical',
      payload: { puzzleId: currentPuzzle.id, blockCount }
    });
    setRunState('running');
    setHint(undefined);
    setFailureReason(undefined);
    setAttemptError(null);
    setDisconnectedBlocks([]);
    if (runTimerRef.current) {
      clearTimeout(runTimerRef.current);
      runTimerRef.current = null;
    }
    try {
      const startResponse = await fetch(`${API_BASE_URL}/api/attempts/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          puzzleId: currentPuzzle.id,
          codeSnapshotJson: JSON.stringify(programGraph),
          blockCount
        })
      });
      if (!startResponse.ok) throw new Error('Unable to start attempt');
      const { attemptId: newAttemptId } = await startResponse.json();
      telemetry.configureContext({ attemptId: newAttemptId, puzzleId: currentPuzzle.id });
      telemetry.log({
        type: 'run.started',
        importance: 'critical',
        payload: { attemptId: newAttemptId, puzzleId: currentPuzzle.id }
      });
      const result = executeProgram(programGraph, currentPuzzle);
      setCanvasEvents([...result.events]);
      setHint(result.hint);
      setFailureReason(result.failureReason);
      setDisconnectedBlocks(result.disconnectedBlockIds);
      const playbackDuration = Math.max(800, result.events.length * playbackDelayFor(speed));
      runTimerRef.current = window.setTimeout(() => {
        setRunState(result.status === 'success' ? 'success' : 'failure');
        runTimerRef.current = null;
      }, playbackDuration);
      result.events.forEach((event) => {
        telemetry.log({ type: event.type, payload: toTelemetryPayload(event) });
      });
      telemetry.log({
        type: 'run.ended',
        importance: 'critical',
        payload: {
          attemptId: newAttemptId,
          puzzleId: currentPuzzle.id,
          result: result.status,
          failureReason: result.failureReason
        }
      });
      const completeResponse = await fetch(`${API_BASE_URL}/api/attempts/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId: newAttemptId,
          result: result.status,
          failureReason: result.failureReason,
          executionSteps: result.metrics.executedInstructions,
          endedAt: Date.now()
        })
      });
      if (!completeResponse.ok) {
        throw new Error('Unable to complete attempt');
      }
      if (result.status === 'success') {
        markProgress();
      } else if (result.hint) {
        telemetry.log({
          type: 'ui.hint_shown',
          payload: { puzzleId: currentPuzzle.id, failureReason: result.failureReason, hint: result.hint }
        });
      }
      await telemetry.flush(true);
    } catch (error) {
      console.error(error);
      setAttemptError((error as Error).message);
      if (runTimerRef.current) {
        clearTimeout(runTimerRef.current);
        runTimerRef.current = null;
      }
      setRunState('editing');
    }
  };

  const handleReset = () => {
    if (runTimerRef.current) {
      clearTimeout(runTimerRef.current);
      runTimerRef.current = null;
    }
    setCanvasEvents(null);
    setRunState('editing');
    setHint(undefined);
    setFailureReason(undefined);
    setDisconnectedBlocks([]);
    telemetry.log({ type: 'ui.reset_clicked', payload: { puzzleId: currentPuzzle.id } });
  };

  const handleStep = () => {
    if (runTimerRef.current) {
      clearTimeout(runTimerRef.current);
      runTimerRef.current = null;
    }
    const result = executeProgram(serializeProgram(currentProgram), currentPuzzle, { failOnDisconnected: false });
    const nextCount = Math.min(stepPreviewCount + 1, result.events.length);
    setStepPreviewCount(nextCount);
    setCanvasEvents(result.events.slice(0, nextCount));
    telemetry.log({ type: 'ui.step_clicked', payload: { puzzleId: currentPuzzle.id, stepCount: nextCount } });
  };

  const toggleCodeView = () => {
    setShowCode((prev) => {
      const next = !prev;
      telemetry.log({ type: 'ui.code_view_toggled', payload: { puzzleId: currentPuzzle.id, showCode: next } });
      return next;
    });
  };

  const handleSpeedChange = (nextSpeed: PlaybackSpeed) => {
    setSpeed(nextSpeed);
    telemetry.log({ type: 'ui.speed_changed', payload: { puzzleId: currentPuzzle.id, speed: nextSpeed } });
  };

  const completedCount = Object.values(progress).filter((entry) => entry.completed).length;
  const progressPercent = (completedCount / puzzles.length) * 100;

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <h1 style={{ margin: 0 }}>{theme}</h1>
          <small>Content pack v{version}</small>
        </div>
        <div style={{ flex: 1, marginLeft: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <span>Puzzle {currentPuzzle.id} of {puzzles.length}</span>
            <span>{progressPercent.toFixed(0)}% complete</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setViewMode('play')} disabled={viewMode === 'play'}>
            Gameplay
          </button>
          <button onClick={() => setViewMode('analytics')} disabled={viewMode === 'analytics'}>
            Analytics
          </button>
        </div>
      </header>

      {sessionError && <div style={{ color: '#b91c1c' }}>{sessionError}</div>}
      {attemptError && <div style={{ color: '#b91c1c' }}>{attemptError}</div>}

      <section className="level-strip" aria-label="Puzzle progression">
        {puzzles.map((puzzle) => {
          const status = progress[puzzle.id];
          const locked = !status?.unlocked;
          const completed = status?.completed;
          const className = ['level-node'];
          if (completed) className.push('completed');
          else if (locked) className.push('locked');
          else className.push('unlocked');
          if (puzzle.id === currentPuzzle.id) className.push('current');
          return (
            <button
              key={puzzle.id}
              className={className.join(' ')}
              onClick={() => !locked && setCurrentPuzzleId(puzzle.id)}
              disabled={locked}
            >
              {puzzle.id}
            </button>
          );
        })}
      </section>

      {viewMode === 'analytics' ? (
        <section className="analytics-panel">
          <AnalyticsDashboard apiBaseUrl={API_BASE_URL} puzzles={puzzles} />
        </section>
      ) : (
        <section className="main-stage">
          <GameCanvas
            puzzle={currentPuzzle}
            events={canvasEvents}
            runState={runState}
            speed={speed}
            hint={hint}
            failureReason={failureReason}
          />
          <Workspace
            puzzle={currentPuzzle}
            program={currentProgram}
            onProgramChange={handleProgramChange}
            onWorkspaceEvent={handleWorkspaceEvent}
            mode={runState === 'running' ? 'running' : 'editing'}
            disconnectedBlockIds={disconnectedBlocks}
            showCode={showCode}
            onToggleCode={toggleCodeView}
            onPlay={handlePlay}
            onReset={handleReset}
            onStep={handleStep}
            speed={speed}
            onSpeedChange={handleSpeedChange}
            highlightBlockId={disconnectedBlocks[0]}
          />
        </section>
      )}

      {runState === 'failure' && hint && (
        <div className="oops-modal">
          <article>
            <h2>Oops!</h2>
            <p>{hint}</p>
            <button onClick={() => setRunState('editing')}>Try Again</button>
          </article>
        </div>
      )}

      {runState === 'success' && (
        <div className="success-modal">
          <article>
            <h2>Great work!</h2>
            <p>The pet reached the goal. Ready for the next puzzle?</p>
            <button
              onClick={() => {
                const nextPuzzle = puzzles.find((p) => p.id === currentPuzzle.id + 1);
                if (nextPuzzle) {
                  setCurrentPuzzleId(nextPuzzle.id);
                }
                setRunState('editing');
              }}
            >
              Continue
            </button>
          </article>
        </div>
      )}
    </div>
  );
};

function toTelemetryPayload(event: RuntimeEvent): Record<string, unknown> {
  switch (event.type) {
    case 'move.step':
      return {
        blockId: event.blockId,
        from: event.from,
        to: event.to,
        direction: event.direction,
        blocked: event.blocked
      };
    case 'turn':
      return { blockId: event.blockId, direction: event.direction };
    case 'action':
      return {
        blockId: event.blockId,
        action: event.action,
        targetId: event.targetId,
        itemType: event.itemType,
        success: event.success
      };
    case 'condition.checked':
      return {
        blockId: event.blockId,
        outcome: event.outcome,
        condition: event.condition
      };
    case 'loop.iteration':
      return { blockId: event.blockId, iteration: event.iteration };
    default:
      return { blockId: event.blockId };
  }
}

export default App;
