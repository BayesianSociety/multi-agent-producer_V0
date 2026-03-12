import {
  BLOCK_DEFINITIONS,
  BlockDefinition,
  BlockType,
  ProgramBlockNode,
  ProgramGraph
} from '@shared/runtime/blockDefinitions';
import { generateId } from './ids';

export interface WorkspaceBlock {
  id: string;
  type: BlockType;
  args: Record<string, unknown>;
  children: Record<string, WorkspaceBlock[]>;
}

export interface WorkspaceProgram {
  blocks: WorkspaceBlock[];
}

const ROOT_ID = 'root';

export function createEmptyProgram(): WorkspaceProgram {
  return { blocks: [] };
}

export function createWorkspaceBlock(type: BlockType): WorkspaceBlock {
  const definition = BLOCK_DEFINITIONS[type];
  const args: Record<string, unknown> = {};
  definition?.args?.forEach((arg) => {
    if (arg.defaultValue !== undefined) {
      args[arg.name] = arg.defaultValue;
    }
  });
  const children: Record<string, WorkspaceBlock[]> = {};
  definition?.childSlots?.forEach((slot) => {
    children[slot.name] = [];
  });
  return {
    id: generateId('blk'),
    type,
    args,
    children
  };
}

export function cloneProgram(program: WorkspaceProgram): WorkspaceProgram {
  return {
    blocks: cloneSequence(program.blocks)
  };
}

function cloneSequence(sequence: WorkspaceBlock[]): WorkspaceBlock[] {
  return sequence.map((block) => cloneBlock(block));
}

function cloneBlock(block: WorkspaceBlock): WorkspaceBlock {
  const children: Record<string, WorkspaceBlock[]> = {};
  Object.entries(block.children ?? {}).forEach(([slot, nodes]) => {
    children[slot] = cloneSequence(nodes);
  });
  return {
    id: block.id,
    type: block.type,
    args: { ...block.args },
    children
  };
}

export function findBlock(sequence: WorkspaceBlock[], blockId: string): WorkspaceBlock | null {
  for (const block of sequence) {
    if (block.id === blockId) return block;
    for (const nodes of Object.values(block.children ?? {})) {
      const found = findBlock(nodes, blockId);
      if (found) return found;
    }
  }
  return null;
}

export function getSequenceByPath(program: WorkspaceProgram, path: string): WorkspaceBlock[] | null {
  if (path === 'root') return program.blocks;
  const [blockId, slot] = path.split('.');
  if (!blockId || !slot) return null;
  const block = findBlock(program.blocks, blockId);
  if (!block) return null;
  block.children[slot] = block.children[slot] ?? [];
  return block.children[slot];
}

export function insertBlock(program: WorkspaceProgram, path: string, index: number, block: WorkspaceBlock): WorkspaceProgram {
  const next = cloneProgram(program);
  const target = getSequenceByPath(next, path);
  if (!target) return program;
  target.splice(index, 0, block);
  return next;
}

export function removeBlock(program: WorkspaceProgram, path: string, index: number): WorkspaceProgram {
  const next = cloneProgram(program);
  const target = getSequenceByPath(next, path);
  if (!target) return program;
  target.splice(index, 1);
  return next;
}

export function moveBlock(
  program: WorkspaceProgram,
  sourcePath: string,
  sourceIndex: number,
  targetPath: string,
  targetIndex: number
): WorkspaceProgram {
  if (sourcePath === targetPath && sourceIndex === targetIndex) {
    return program;
  }
  const next = cloneProgram(program);
  const sourceSeq = getSequenceByPath(next, sourcePath);
  const targetSeq = getSequenceByPath(next, targetPath);
  if (!sourceSeq || !targetSeq) return program;
  const [block] = sourceSeq.splice(sourceIndex, 1);
  if (!block) return program;
  const insertIndex = sourceSeq === targetSeq && targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
  targetSeq.splice(insertIndex, 0, block);
  return next;
}

export function updateBlockArgs(program: WorkspaceProgram, blockId: string, args: Record<string, unknown>): WorkspaceProgram {
  const next = cloneProgram(program);
  const block = findBlock(next.blocks, blockId);
  if (!block) return program;
  block.args = { ...block.args, ...args };
  return next;
}

export function countBlocks(program: WorkspaceProgram): number {
  function count(sequence: WorkspaceBlock[]): number {
    return sequence.reduce((total, block) => {
      const childCount = Object.values(block.children ?? {}).reduce(
        (acc, nodes) => acc + count(nodes),
        0
      );
      return total + 1 + childCount;
    }, 0);
  }
  return count(program.blocks);
}

export function serializeProgram(program: WorkspaceProgram): ProgramGraph {
  const nodes: Record<string, ProgramBlockNode> = {};

  function linkSequence(sequence: WorkspaceBlock[], setter: (nextId: string | null) => void) {
    if (!sequence.length) {
      setter(null);
      return;
    }
    setter(sequence[0].id);
    sequence.forEach((block, index) => {
      const node = registerBlock(block);
      const nextBlock = sequence[index + 1];
      node.next = nextBlock ? nextBlock.id : null;
    });
  }

  function registerBlock(block: WorkspaceBlock): ProgramBlockNode {
    const def = BLOCK_DEFINITIONS[block.type];
    if (!def) {
      throw new Error(`Unknown block type: ${block.type}`);
    }
    const node: ProgramBlockNode = {
      id: block.id,
      type: block.type,
      args: block.args,
      next: null,
      children: {}
    };
    nodes[block.id] = node;
    def.childSlots?.forEach((slot) => {
      const sequence = block.children[slot.name] ?? [];
      linkSequence(sequence, (childStart) => {
        if (!node.children) node.children = {};
        node.children[slot.name] = childStart;
      });
    });
    return node;
  }

  linkSequence(program.blocks, (first) => {
    nodes[ROOT_ID] = {
      id: ROOT_ID,
      type: BlockType.OnStart,
      args: {},
      next: first,
      children: {}
    };
  });

  return {
    rootId: ROOT_ID,
    nodes
  };
}

export function programToCode(program: WorkspaceProgram): string {
  const lines: string[] = ['onStart {'];
  renderSequence(program.blocks, 1, lines);
  lines.push('}');
  return lines.join('\n');
}

function renderSequence(sequence: WorkspaceBlock[], indent: number, lines: string[]): void {
  const prefix = '  '.repeat(indent);
  sequence.forEach((block) => {
    const def = BLOCK_DEFINITIONS[block.type];
    const label = def?.label ?? block.type;
    const args = renderArgs(block, def);
    if (def?.childSlots?.length) {
      lines.push(`${prefix}${label}${args} {`);
      def.childSlots.forEach((slot) => {
        const nested = block.children[slot.name] ?? [];
        renderSequence(nested, indent + 1, lines);
      });
      lines.push(`${prefix}}`);
    } else {
      lines.push(`${prefix}${label}${args}`);
    }
  });
}

function renderArgs(block: WorkspaceBlock, def?: BlockDefinition): string {
  if (!def?.args?.length) return '';
  const parts = def.args.map((arg) => {
    const value = block.args?.[arg.name];
    return `${arg.label}: ${value ?? arg.defaultValue ?? ''}`.trim();
  });
  return parts.length ? ` (${parts.join(', ')})` : '';
}
