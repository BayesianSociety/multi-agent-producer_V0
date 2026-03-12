import React, { useMemo, useState } from 'react';
import {
  BLOCK_DEFINITIONS,
  BlockCategory,
  BlockDefinition,
  BlockType
} from '@shared/runtime/blockDefinitions';
import { PuzzleDefinition } from '@shared/runtime/executionEngine';
import {
  WorkspaceProgram,
  WorkspaceBlock,
  createWorkspaceBlock,
  insertBlock,
  moveBlock,
  removeBlock,
  updateBlockArgs,
  programToCode,
  countBlocks,
  findBlock
} from '@/lib/program';
import './workspace.css';

export type WorkspaceMode = 'editing' | 'running';
export type PlaybackSpeed = 'slow' | 'normal' | 'fast';

interface WorkspaceProps {
  puzzle: PuzzleDefinition;
  program: WorkspaceProgram;
  onProgramChange: (next: WorkspaceProgram) => void;
  onWorkspaceEvent?: (event: { type: string; payload?: Record<string, unknown> }) => void;
  mode: WorkspaceMode;
  disconnectedBlockIds: string[];
  showCode: boolean;
  onToggleCode: () => void;
  onPlay: () => void;
  onReset: () => void;
  onStep: () => void;
  speed: PlaybackSpeed;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  highlightBlockId?: string;
}

interface DropTargetKey {
  path: string;
  index: number;
}

type DragPayload =
  | { source: 'library'; blockType: BlockType }
  | { source: 'workspace'; path: string; index: number; blockId: string };

const categoryColors: Record<BlockCategory, string> = {
  [BlockCategory.Movement]: '#2f80ed',
  [BlockCategory.Actions]: '#00b894',
  [BlockCategory.Control]: '#6f58ff',
  [BlockCategory.Logic]: '#eb5757',
  [BlockCategory.Sensing]: '#f2c94c',
  [BlockCategory.Utility]: '#a855f7'
};

const speedLabels: Record<PlaybackSpeed, string> = {
  slow: 'Slow',
  normal: 'Normal',
  fast: 'Fast'
};

const Workspace: React.FC<WorkspaceProps> = ({
  puzzle,
  program,
  onProgramChange,
  onWorkspaceEvent,
  mode,
  disconnectedBlockIds,
  showCode,
  onToggleCode,
  onPlay,
  onReset,
  onStep,
  speed,
  onSpeedChange,
  highlightBlockId
}) => {
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [activeDrop, setActiveDrop] = useState<string | null>(null);
  const codeString = useMemo(() => programToCode(program), [program]);
  const blockCount = useMemo(() => countBlocks(program), [program]);
  const maxBlocks = puzzle.constraints?.maxBlocks;
  const editingDisabled = mode !== 'editing';

  const availableBlocks = useMemo(() => {
    const definitions: BlockDefinition[] = [];
    puzzle.availableBlocks.forEach((id) => {
      const definition = BLOCK_DEFINITIONS[id as BlockType];
      if (definition) definitions.push(definition);
    });
    return definitions;
  }, [puzzle]);

  const groupedBlocks = useMemo(() => {
    const groups: Record<BlockCategory, BlockDefinition[]> = {
      [BlockCategory.Movement]: [],
      [BlockCategory.Actions]: [],
      [BlockCategory.Control]: [],
      [BlockCategory.Logic]: [],
      [BlockCategory.Sensing]: [],
      [BlockCategory.Utility]: []
    };
    availableBlocks.forEach((block) => {
      groups[block.category].push(block);
    });
    return groups;
  }, [availableBlocks]);

  const forbiddenIds = useMemo(() => {
    if (!dragPayload || dragPayload.source !== 'workspace') return new Set<string>();
    const node = findBlock(program.blocks, dragPayload.blockId);
    const ids = new Set<string>();
    const walk = (block?: WorkspaceBlock | null) => {
      if (!block) return;
      ids.add(block.id);
      Object.values(block.children ?? {}).forEach((sequence) => {
        sequence.forEach((child) => walk(child));
      });
    };
    walk(node ?? undefined);
    return ids;
  }, [dragPayload, program]);

  const handleDrop = (path: string, index: number) => {
    if (!dragPayload || editingDisabled) return;
    if (dragPayload.source === 'library') {
      const block = createWorkspaceBlock(dragPayload.blockType);
      onProgramChange(insertBlock(program, path, index, block));
      onWorkspaceEvent?.({ type: 'ui.block_added', payload: { blockType: block.type, targetPath: path, index } });
    } else {
      if (path !== 'root') {
        const owner = path.split('.')[0];
        if (forbiddenIds.has(owner)) {
          setDragPayload(null);
          setActiveDrop(null);
          return;
        }
      }
      const next = moveBlock(program, dragPayload.path, dragPayload.index, path, index);
      onProgramChange(next);
      onWorkspaceEvent?.({
        type: 'ui.block_reordered',
        payload: { blockId: dragPayload.blockId, from: dragPayload.path, to: path, index }
      });
    }
    setActiveDrop(null);
    setDragPayload(null);
  };

  const handleRemove = (path: string, index: number) => {
    const next = removeBlock(program, path, index);
    onProgramChange(next);
    onWorkspaceEvent?.({ type: 'ui.block_removed', payload: { path, index } });
  };

  const renderArgs = (block: WorkspaceBlock, def: BlockDefinition | undefined) => {
    if (!def?.args?.length) return null;
    return (
      <div className="block-args">
        {def.args.map((arg) => (
          <label className="arg-field" key={arg.name}>
            {arg.label}
            {renderArgControl(block, arg)}
          </label>
        ))}
      </div>
    );
  };

  const renderArgControl = (block: WorkspaceBlock, arg: BlockDefinition['args'][number]) => {
    const value = block.args?.[arg.name] ?? '';
    if (arg.type === 'number') {
      return (
        <input
          type="number"
          value={value}
          min={arg.min}
          max={arg.max}
          step={arg.step ?? 1}
          onChange={(event) => {
            onProgramChange(updateBlockArgs(program, block.id, { [arg.name]: Number(event.target.value) }));
            onWorkspaceEvent?.({
              type: 'ui.block_argument_changed',
              payload: { blockId: block.id, arg: arg.name, value: Number(event.target.value) }
            });
          }}
        />
      );
    }
    if (arg.type === 'direction' || arg.type === 'enum' || arg.type === 'item') {
      const fallback = arg.options?.[0]?.value ?? '';
      return (
        <select
          value={(value as string) ?? fallback}
          onChange={(event) => {
            onProgramChange(updateBlockArgs(program, block.id, { [arg.name]: event.target.value }));
            onWorkspaceEvent?.({
              type: 'ui.block_argument_changed',
              payload: { blockId: block.id, arg: arg.name, value: event.target.value }
            });
          }}
        >
          {arg.options?.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
    if (arg.type === 'boolean') {
      return (
        <select
          value={value ? 'true' : 'false'}
          onChange={(event) => {
            const nextValue = event.target.value === 'true';
            onProgramChange(updateBlockArgs(program, block.id, { [arg.name]: nextValue }));
            onWorkspaceEvent?.({
              type: 'ui.block_argument_changed',
              payload: { blockId: block.id, arg: arg.name, value: nextValue }
            });
          }}
        >
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    }
    return (
      <input
        value={value}
        onChange={(event) => {
          onProgramChange(updateBlockArgs(program, block.id, { [arg.name]: event.target.value }));
          onWorkspaceEvent?.({
            type: 'ui.block_argument_changed',
            payload: { blockId: block.id, arg: arg.name, value: event.target.value }
          });
        }}
      />
    );
  };

  const renderSequence = (path: string, sequence: WorkspaceBlock[]) => {
    const dropZones: JSX.Element[] = [];
    const nodes: JSX.Element[] = [];
    for (let i = 0; i <= sequence.length; i += 1) {
      const key = `${path}:${i}`;
      dropZones.push(
        <DropZone
          key={`drop-${key}`}
          active={activeDrop === key}
          disabled={editingDisabled}
          onDragEnter={() => setActiveDrop(key)}
          onDragLeave={() => setActiveDrop((current) => (current === key ? null : current))}
          onDrop={() => handleDrop(path, i)}
        />
      );
      if (i < sequence.length) {
        const block = sequence[i];
        nodes.push(
          <WorkspaceBlockCard
            key={block.id}
            block={block}
            definition={BLOCK_DEFINITIONS[block.type]}
            index={i}
            path={path}
            onRemove={() => handleRemove(path, i)}
            onDragStart={() =>
              setDragPayload({ source: 'workspace', blockId: block.id, path, index: i })
            }
            onDragEnd={() => setDragPayload(null)}
            renderChild={(slotName, children) => renderChildSlot(block, slotName, children)}
            renderArgs={() => renderArgs(block, BLOCK_DEFINITIONS[block.type])}
            disconnected={disconnectedBlockIds.includes(block.id)}
            highlight={highlightBlockId === block.id}
            disabled={editingDisabled}
          />
        );
      }
    }
    const rows: JSX.Element[] = [];
    for (let i = 0; i < dropZones.length; i += 1) {
      rows.push(dropZones[i]);
      if (i < nodes.length) {
        rows.push(nodes[i]);
      }
    }
    return <div className="workspace-sequence">{rows}</div>;
  };

  const renderChildSlot = (block: WorkspaceBlock, slotName: string, children: WorkspaceBlock[]) => {
    return (
      <div className="child-slot" key={`${block.id}-${slotName}`}>
        <h4>{slotName}</h4>
        {renderSequence(`${block.id}.${slotName}`, children)}
      </div>
    );
  };

  const workspacePanelClass = ['workspace-panel', 'editor'];
  if (mode === 'running' && !showCode) {
    workspacePanelClass.push('collapsed');
  }

  return (
    <div className="workspace-container">
      <section className="workspace-panel library" aria-label="Command library">
        {Object.values(BlockCategory).map((category) => {
          const blocks = groupedBlocks[category as BlockCategory];
          if (!blocks?.length) return null;
          return (
            <div className="block-category" key={category}>
              <h3>{category}</h3>
              {blocks.map((block) => (
                <div
                  key={block.type}
                  className="block-card"
                  style={{
                    background: `${categoryColors[block.category]}10`,
                    borderColor: `${categoryColors[block.category]}55`
                  }}
                  draggable={!editingDisabled}
                  onDragStart={() => setDragPayload({ source: 'library', blockType: block.type })}
                  onDragEnd={() => setDragPayload(null)}
                >
                  <strong>{block.label}</strong>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#4b5563' }}>
                    {block.description}
                  </p>
                </div>
              ))}
            </div>
          );
        })}
      </section>
      <section className={workspacePanelClass.join(' ')} aria-label="Workspace editor">
        <div className="workspace-controls">
          <button className="primary" disabled={mode !== 'editing'} onClick={onPlay}>
            ▶ Play
          </button>
          <button className="secondary" onClick={onReset}>
            ⟳ Reset
          </button>
          <button className="secondary" onClick={onStep} disabled={mode !== 'editing'}>
            ☰ Step
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
            {(['slow', 'normal', 'fast'] as PlaybackSpeed[]).map((value) => (
              <button
                key={value}
                className="secondary"
                style={{
                  background: value === speed ? '#6f58ff' : undefined,
                  color: value === speed ? '#fff' : undefined
                }}
                onClick={() => onSpeedChange(value)}
              >
                {speedLabels[value]}
              </button>
            ))}
          </div>
          <button className="secondary" onClick={onToggleCode}>
            {showCode ? 'Blocks View' : 'Show Code'}
          </button>
        </div>
        <div className="workspace-status-row">
          <span>
            Blocks: {blockCount}
            {maxBlocks ? ` / ${maxBlocks}` : ''}
          </span>
          {disconnectedBlockIds.length > 0 && <span>⚠ Disconnected blocks detected</span>}
        </div>
        {showCode ? (
          <pre className="code-view" aria-live="polite">
            {codeString}
          </pre>
        ) : (
          <div className="workspace-editor-scroll">
            {renderSequence('root', program.blocks)}
          </div>
        )}
        {maxBlocks && blockCount > maxBlocks && (
          <div className="workspace-alert warning">You have used more blocks than allowed for this puzzle.</div>
        )}
        {disconnectedBlockIds.length > 0 && (
          <div className="workspace-alert error">Connect all blocks to On Start to run the program.</div>
        )}
      </section>
    </div>
  );
};

interface WorkspaceBlockCardProps {
  block: WorkspaceBlock;
  definition?: BlockDefinition;
  path: string;
  index: number;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  renderArgs: () => React.ReactNode;
  renderChild: (slotName: string, children: WorkspaceBlock[]) => React.ReactNode;
  disconnected: boolean;
  highlight: boolean;
  disabled: boolean;
}

const WorkspaceBlockCard: React.FC<WorkspaceBlockCardProps> = ({
  block,
  definition,
  onRemove,
  onDragStart,
  onDragEnd,
  renderArgs,
  renderChild,
  disconnected,
  highlight,
  disabled
}) => {
  const color = definition ? categoryColors[definition.category] : '#94a3b8';
  return (
    <div
      className="workspace-block"
      style={{
        background: color,
        outline: disconnected ? '3px dashed #ffe082' : highlight ? '3px solid #fde047' : 'none'
      }}
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="block-header">
        <span>{definition?.label ?? block.type}</span>
        <div className="block-meta">
          <button
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: '#fff',
              borderRadius: '50%',
              width: 28,
              height: 28,
              cursor: disabled ? 'not-allowed' : 'pointer'
            }}
            disabled={disabled}
            onClick={onRemove}
            aria-label="Remove block"
          >
            ×
          </button>
        </div>
      </div>
      {renderArgs()}
      {definition?.childSlots?.map((slot) => renderChild(slot.name, block.children[slot.name] ?? []))}
    </div>
  );
};

interface DropZoneProps {
  active: boolean;
  disabled: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
}

const DropZone: React.FC<DropZoneProps> = ({ active, disabled, onDragEnter, onDragLeave, onDrop }) => (
  <div
    className={`drop-zone${active ? ' active' : ''}`}
    onDragOver={(event) => {
      if (disabled) return;
      event.preventDefault();
      onDragEnter();
    }}
    onDragLeave={onDragLeave}
    onDrop={(event) => {
      if (disabled) return;
      event.preventDefault();
      onDrop();
    }}
  >
    Drop block here
  </div>
);

export default Workspace;
