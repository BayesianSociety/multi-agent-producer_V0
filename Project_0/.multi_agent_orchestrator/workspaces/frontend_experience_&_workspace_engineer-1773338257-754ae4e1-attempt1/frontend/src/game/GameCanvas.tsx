import React, { useEffect, useMemo, useState } from 'react';
import { PlaybackSpeed } from '@/components/Workspace/Workspace';
import {
  FailureReason,
  PuzzleDefinition,
  RuntimeEvent
} from '@shared/runtime/executionEngine';
import './GameCanvas.css';

interface GameCanvasProps {
  puzzle: PuzzleDefinition;
  events: RuntimeEvent[] | null;
  runState: 'idle' | 'running' | 'success' | 'failure';
  speed: PlaybackSpeed;
  hint?: string;
  failureReason?: FailureReason;
}

interface PositionState {
  x: number;
  y: number;
  direction: string;
}

const sceneBackgrounds: Record<string, string> = {
  'welcome-bay': 'linear-gradient(135deg,#fdf2f8,#e0f2fe)',
  'hallway-bright': 'linear-gradient(135deg,#ede9fe,#cffafe)',
  'exam-room': 'linear-gradient(135deg,#fef9c3,#e0f2fe)',
  'treatment-corner': 'linear-gradient(135deg,#fce7f3,#ffe4e6)'
};

const GameCanvas: React.FC<GameCanvasProps> = ({ puzzle, events, runState, speed, hint, failureReason }) => {
  const initialPosition = useMemo(
    () => ({
      x: puzzle.entities.pet.start.x,
      y: puzzle.entities.pet.start.y,
      direction: puzzle.entities.pet.start.direction ?? 'east'
    }),
    [puzzle]
  );
  const [petState, setPetState] = useState<PositionState>(initialPosition);
  const [trail, setTrail] = useState<Array<{ x: number; y: number }>>([
    { x: initialPosition.x, y: initialPosition.y }
  ]);
  const [lastAction, setLastAction] = useState<string>('Ready');

  useEffect(() => {
    setPetState(initialPosition);
    setTrail([{ x: initialPosition.x, y: initialPosition.y }]);
    setLastAction('Ready');
  }, [initialPosition]);

  useEffect(() => {
    if (!events) return;
    setPetState(initialPosition);
    setTrail([{ x: initialPosition.x, y: initialPosition.y }]);
    setLastAction('Running');
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const baseDelay = speed === 'slow' ? 650 : speed === 'fast' ? 220 : 380;

    const applyEvent = (event: RuntimeEvent) => {
      if (event.type === 'move.step') {
        if (event.blocked) {
          setLastAction('Blocked path');
        } else {
          setPetState({ x: event.to.x, y: event.to.y, direction: event.direction });
          setTrail((prev) => [...prev, { x: event.to.x, y: event.to.y }]);
          setLastAction('Walking');
        }
      } else if (event.type === 'turn') {
        setPetState((current) => ({ ...current, direction: event.direction }));
        setLastAction('Turning');
      } else if (event.type === 'action') {
        setLastAction(event.action.replace('actions.', ''));
      } else if (event.type === 'condition.checked') {
        setLastAction(event.outcome ? 'Condition true' : 'Condition false');
      }
    };

    const step = (index: number) => {
      if (cancelled || !events[index]) return;
      applyEvent(events[index]);
      if (index < events.length - 1) {
        timer = setTimeout(() => step(index + 1), baseDelay);
      }
    };

    step(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [events, speed, initialPosition]);

  const sceneBackground = sceneBackgrounds[puzzle.scene] ?? sceneBackgrounds['welcome-bay'];
  const tileSize = puzzle.grid.tileSize ?? 64;
  const stageWidth = puzzle.grid.width * tileSize;
  const stageHeight = puzzle.grid.height * tileSize;
  const walkableSet = useMemo(() => {
    if (puzzle.grid.walkable?.length) {
      return new Set(puzzle.grid.walkable.map((coord) => `${coord.x},${coord.y}`));
    }
    return null;
  }, [puzzle]);

  const tiles = useMemo(() => {
    const list: Array<{ x: number; y: number; walkable: boolean }> = [];
    for (let y = 0; y < puzzle.grid.height; y += 1) {
      for (let x = 0; x < puzzle.grid.width; x += 1) {
        const key = `${x},${y}`;
        const walkable = walkableSet ? walkableSet.has(key) : true;
        list.push({ x, y, walkable });
      }
    }
    return list;
  }, [puzzle, walkableSet]);

  return (
    <div className="game-wrapper">
      <div className="scene-panel" style={{ background: sceneBackground }}>
        <div className="goal-banner">{puzzle.goalText}</div>
        <div className="canvas-stage">
          <div className="grid-surface" style={{ width: stageWidth, height: stageHeight }}>
            {tiles.map((tile) => (
              <div
                key={`${tile.x}-${tile.y}`}
                className="tile"
                style={{
                  left: tile.x * tileSize,
                  top: tile.y * tileSize,
                  width: tileSize,
                  height: tileSize,
                  background: tile.walkable ? 'transparent' : 'rgba(15,23,42,0.08)'
                }}
              />
            ))}
            {trail.map((point, index) => (
              <div
                key={`${point.x}-${point.y}-${index}`}
                className="trail-point"
                style={{
                  left: point.x * tileSize + tileSize / 2,
                  top: point.y * tileSize + tileSize / 2
                }}
              />
            ))}
            {puzzle.entities.targets?.map((target) => (
              <div
                key={target.id}
                className="entity target"
                style={{
                  left: target.position.x * tileSize + tileSize / 2,
                  top: target.position.y * tileSize + tileSize / 2
                }}
              />
            ))}
            {puzzle.entities.objects?.map((object) => (
              <div
                key={object.id}
                className="entity object"
                style={{
                  left: object.position.x * tileSize + tileSize / 2,
                  top: object.position.y * tileSize + tileSize / 2
                }}
              >
                {object.itemType?.slice(0, 1).toUpperCase()}
              </div>
            ))}
            {puzzle.entities.mentor && (
              <div
                className="entity mentor"
                style={{
                  left: puzzle.entities.mentor.position.x * tileSize + tileSize / 2,
                  top: puzzle.entities.mentor.position.y * tileSize + tileSize / 2
                }}
              >
                M
              </div>
            )}
            <div
              className="entity pet"
              style={{
                left: petState.x * tileSize + tileSize / 2,
                top: petState.y * tileSize + tileSize / 2
              }}
            >
              🐾
            </div>
          </div>
        </div>
        <div className="run-status">
          <span>State: {runState === 'running' ? 'Animating' : runState}</span>
          <span>Action: {lastAction}</span>
        </div>
        {hint && <div className="hint-pill">Hint: {hint}</div>}
        {failureReason && runState === 'failure' && (
          <div className="hint-pill" style={{ background: 'rgba(248,113,113,0.25)', color: '#7f1d1d' }}>
            Failure: {failureReason}
          </div>
        )}
      </div>
      <aside className="story-panel">
        <h2>{puzzle.title}</h2>
        <p>{puzzle.storyText}</p>
        <p style={{ fontWeight: 600 }}>Concepts: {puzzle.concepts.join(', ')}</p>
        <ul>
          {puzzle.successCriteria.map((criteria, index) => (
            <li key={index}>{criteria.type}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
};

export default GameCanvas;
