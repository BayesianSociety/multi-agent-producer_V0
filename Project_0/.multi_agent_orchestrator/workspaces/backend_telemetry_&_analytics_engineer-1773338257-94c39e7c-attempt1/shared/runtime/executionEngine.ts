import {
  BLOCK_DEFINITIONS,
  BlockType,
  ConditionExpression,
  Direction,
  ItemType,
  ProgramGraph,
  SymptomType
} from './blockDefinitions';

export type FailureReason =
  | 'invalidProgram'
  | 'disconnectedBlocks'
  | 'collision'
  | 'outOfBounds'
  | 'missingItem'
  | 'missingAction'
  | 'goalNotMet'
  | 'wrongCondition'
  | 'loopGuardExceeded';

export interface Position {
  x: number;
  y: number;
  direction?: Direction;
}

export interface GridDefinition {
  width: number;
  height: number;
  tileSize: number;
  layout?: string[];
  walkable?: Array<{ x: number; y: number }>;
  obstacles?: Array<{ x: number; y: number }>;
}

export interface PetEntity {
  id: string;
  sprite: string;
  start: Position;
  symptoms: SymptomType[];
}

export interface MentorEntity {
  id: string;
  sprite: string;
  position: Position;
}

export interface PuzzleObject {
  id: string;
  type: string;
  position: Position;
  itemType?: ItemType;
  consumable?: boolean;
}

export interface PuzzleTarget {
  id: string;
  type: string;
  position: Position;
  requires?: string[];
}

export type SuccessCriterion =
  | { type: 'reach'; entityId: string; targetId?: string; targetPosition?: Position }
  | { type: 'collectItem'; itemType: ItemType; objectId?: string }
  | { type: 'performAction'; action: string; targetId?: string; targetIds?: string[]; times?: number; optional?: boolean }
  | { type: 'resolveSymptom'; symptom: SymptomType }
  | { type: 'deliverItem'; itemType: ItemType; targetId: string };

export interface HintRule {
  failureReason: FailureReason;
  hint: string;
}

export interface PuzzleDefinition {
  id: number;
  title: string;
  scene: string;
  storyText: string;
  goalText: string;
  concepts: string[];
  grid: GridDefinition;
  entities: {
    pet: PetEntity;
    mentor?: MentorEntity;
    objects: PuzzleObject[];
    targets: PuzzleTarget[];
  };
  availableBlocks: string[];
  constraints?: {
    maxBlocks?: number;
    requiredBlocks?: string[];
  };
  successCriteria: SuccessCriterion[];
  hintRules: HintRule[];
}

export interface RuntimeOptions {
  maxLoopIterations: number;
  maxInstructionCount: number;
  failOnDisconnected: boolean;
}

const DEFAULT_OPTIONS: RuntimeOptions = {
  maxLoopIterations: 128,
  maxInstructionCount: 1024,
  failOnDisconnected: true
};

export interface CompileError {
  blockId?: string;
  message: string;
}

export interface InstructionMetadata {
  blockId: string;
}

interface MoveInstruction extends InstructionMetadata {
  kind: 'move';
  steps: number;
}

interface TurnInstruction extends InstructionMetadata {
  kind: 'turn';
  direction: 'left' | 'right' | 'face';
  faceDirection?: Direction;
}

interface ActionInstruction extends InstructionMetadata {
  kind: 'action';
  action: string;
  args?: Record<string, unknown>;
}

interface LoopInstruction extends InstructionMetadata {
  kind: 'loop';
  iterations: number;
  body: Instruction[];
}

interface SequenceLoopInstruction extends InstructionMetadata {
  kind: 'sequenceLoop';
  count: number;
  body: Instruction[];
}

interface LoopUntilInstruction extends InstructionMetadata {
  kind: 'loopUntil';
  condition: ConditionExpression;
  body: Instruction[];
}

interface BranchInstruction extends InstructionMetadata {
  kind: 'branch';
  condition: ConditionExpression;
  whenTrue: Instruction[];
  whenFalse?: Instruction[];
}

type Instruction =
  | MoveInstruction
  | TurnInstruction
  | ActionInstruction
  | LoopInstruction
  | SequenceLoopInstruction
  | LoopUntilInstruction
  | BranchInstruction;

export interface CompileResult {
  instructions: Instruction[];
  disconnectedBlockIds: string[];
  errors: CompileError[];
}

export interface RuntimeEventBase {
  blockId: string;
}

export type RuntimeEvent =
  | (RuntimeEventBase & { type: 'move.step'; from: Position; to: Position; direction: Direction; blocked: boolean })
  | (RuntimeEventBase & { type: 'turn'; direction: Direction })
  | (RuntimeEventBase & { type: 'action'; action: string; targetId?: string; itemType?: ItemType; success: boolean })
  | (RuntimeEventBase & { type: 'condition.checked'; outcome: boolean; condition: ConditionExpression })
  | (RuntimeEventBase & { type: 'loop.iteration'; iteration: number });

export interface WorldStateSnapshot {
  position: Position;
  inventory: ItemType[];
  remainingSymptoms: SymptomType[];
  collectedObjectIds: string[];
  actionLog: ActionRecord[];
}

export interface ActionRecord {
  action: string;
  targetId?: string;
  position: Position;
  timestamp: number;
  itemType?: ItemType;
}

export interface ExecutionResult {
  status: 'success' | 'failure';
  failureReason?: FailureReason;
  hint?: string;
  events: RuntimeEvent[];
  metrics: {
    executedInstructions: number;
    loopIterations: number;
  };
  finalState: WorldStateSnapshot;
  disconnectedBlockIds: string[];
}

export function compileProgram(program: ProgramGraph): CompileResult {
  const errors: CompileError[] = [];
  if (!program.rootId || !program.nodes[program.rootId]) {
    errors.push({ message: 'Program is missing an On Start block.' });
    return { instructions: [], disconnectedBlockIds: [], errors };
  }

  const rootNode = program.nodes[program.rootId];
  if (rootNode.type !== BlockType.OnStart) {
    errors.push({ blockId: rootNode.id, message: 'Root block must be On Start.' });
    return { instructions: [], disconnectedBlockIds: [], errors };
  }

  const visited = new Set<string>([rootNode.id]);
  const instructions: Instruction[] = [];
  const stack = new Set<string>();

  function compileSequence(blockId: string | null | undefined): Instruction[] {
    const local: Instruction[] = [];
    let currentId = blockId ?? null;
    while (currentId) {
      if (stack.has(currentId)) {
        errors.push({ blockId: currentId, message: 'Detected a cycle in the block graph.' });
        break;
      }
      const node = program.nodes[currentId];
      if (!node) {
        errors.push({ blockId: currentId, message: 'Block reference is missing from graph.' });
        break;
      }
      stack.add(currentId);
      visited.add(currentId);
      const def = BLOCK_DEFINITIONS[node.type];
      if (!def) {
        errors.push({ blockId: node.id, message: `Unknown block type: ${node.type}` });
      } else {
        switch (node.type) {
          case BlockType.MoveForward: {
            local.push({ kind: 'move', steps: 1, blockId: node.id });
            break;
          }
          case BlockType.MoveForwardSteps: {
            const steps = clampNumber(node.args?.['steps'], 1, 16, 2);
            local.push({ kind: 'move', steps, blockId: node.id });
            break;
          }
          case BlockType.TurnLeft: {
            local.push({ kind: 'turn', direction: 'left', blockId: node.id });
            break;
          }
          case BlockType.TurnRight: {
            local.push({ kind: 'turn', direction: 'right', blockId: node.id });
            break;
          }
          case BlockType.FaceDirection: {
            const direction = (node.args?.['direction'] as Direction) ?? 'north';
            local.push({ kind: 'turn', direction: 'face', faceDirection: direction, blockId: node.id });
            break;
          }
          case BlockType.PickUpItem:
          case BlockType.DropItem:
          case BlockType.BrushPet:
          case BlockType.CleanStation:
          case BlockType.ApplyBandage:
          case BlockType.GiveTreat:
          case BlockType.ApplyOintment:
          case BlockType.GiveMedicine:
          case BlockType.CheckVitals:
          case BlockType.Wait: {
            local.push({ kind: 'action', action: node.type, args: node.args ?? {}, blockId: node.id });
            break;
          }
          case BlockType.RepeatTimes: {
            const iterations = clampNumber(node.args?.['count'], 1, 32, 2);
            const body = compileSequence(node.children?.['body']);
            local.push({ kind: 'loop', iterations, body, blockId: node.id });
            break;
          }
          case BlockType.RepeatSequence: {
            const count = clampNumber(node.args?.['count'], 1, 32, 4);
            const body = compileSequence(node.children?.['body']);
            local.push({ kind: 'sequenceLoop', count, body, blockId: node.id });
            break;
          }
          case BlockType.RepeatUntil: {
            const condition = (node.args?.['condition'] as ConditionExpression) ?? { kind: 'boolean', value: true };
            const body = compileSequence(node.children?.['body']);
            local.push({ kind: 'loopUntil', condition, body, blockId: node.id });
            break;
          }
          case BlockType.IfCondition: {
            const condition = (node.args?.['condition'] as ConditionExpression) ?? { kind: 'boolean', value: true };
            const whenTrue = compileSequence(node.children?.['then']);
            local.push({ kind: 'branch', condition, whenTrue, blockId: node.id });
            break;
          }
          case BlockType.IfElseCondition: {
            const condition = (node.args?.['condition'] as ConditionExpression) ?? { kind: 'boolean', value: true };
            const whenTrue = compileSequence(node.children?.['then']);
            const whenFalse = compileSequence(node.children?.['else']);
            local.push({ kind: 'branch', condition, whenTrue, whenFalse, blockId: node.id });
            break;
          }
          default: {
            errors.push({ blockId: node.id, message: `Block type ${node.type} is not supported by the runtime.` });
          }
        }
      }
      stack.delete(currentId);
      currentId = node?.next ?? null;
    }
    return local;
  }

  instructions.push(...compileSequence(rootNode.next));
  const disconnectedBlockIds = Object.keys(program.nodes).filter(
    (id) => !visited.has(id)
  );

  return { instructions, disconnectedBlockIds, errors };
}

interface GridModel {
  width: number;
  height: number;
  walkable: Set<string>;
}

interface RuntimeWorldState {
  puzzle: PuzzleDefinition;
  position: Position;
  facing: Direction;
  symptoms: Set<SymptomType>;
  inventory: ItemType[];
  collectedObjects: Set<string>;
  actionLog: ActionRecord[];
  timestamp: number;
}

function createGridModel(grid: GridDefinition): GridModel {
  const walkable = new Set<string>();
  if (grid.walkable?.length) {
    grid.walkable.forEach((coord) => walkable.add(key(coord.x, coord.y)));
  } else if (grid.layout?.length) {
    grid.layout.forEach((row, y) => {
      Array.from(row).forEach((char, x) => {
        if (char !== '#') {
          walkable.add(key(x, y));
        }
      });
    });
  } else {
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        walkable.add(key(x, y));
      }
    }
  }
  return { width: grid.width, height: grid.height, walkable };
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function rotate(direction: Direction, turn: 'left' | 'right'): Direction {
  const order: Direction[] = ['north', 'east', 'south', 'west'];
  const index = order.indexOf(direction);
  const delta = turn === 'left' ? -1 : 1;
  const newIndex = (index + delta + order.length) % order.length;
  return order[newIndex];
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : fallback;
  if (Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function evalCondition(expr: ConditionExpression, state: RuntimeWorldState): boolean {
  switch (expr.kind) {
    case 'symptom':
      return applyNegation(expr.negate, state.symptoms.has(expr.symptom ?? 'itchy'));
    case 'inventory':
      return applyNegation(expr.negate, expr.item ? state.inventory.includes(expr.item) : false);
    case 'location':
      if (expr.location?.targetId) {
        const target = state.puzzle.entities.targets.find((t) => t.id === expr.location?.targetId);
        return applyNegation(expr.negate, target ? positionsMatch(state.position, target.position) : false);
      }
      return applyNegation(
        expr.negate,
        expr.location ? positionsMatch(state.position, expr.location) : false
      );
    case 'boolean':
      return applyNegation(expr.negate, Boolean(expr.value));
    default:
      return applyNegation(expr.negate, false);
  }
}

function applyNegation(negate: boolean | undefined, value: boolean): boolean {
  return negate ? !value : value;
}

function positionsMatch(a: Position, b: Position | undefined): boolean {
  if (!b) return false;
  return a.x === b.x && a.y === b.y;
}

function positionAfterStep(position: Position, facing: Direction): Position {
  switch (facing) {
    case 'north':
      return { x: position.x, y: position.y - 1 };
    case 'east':
      return { x: position.x + 1, y: position.y };
    case 'south':
      return { x: position.x, y: position.y + 1 };
    case 'west':
      return { x: position.x - 1, y: position.y };
    default:
      return position;
  }
}

interface ActionRequirements {
  requiresItem?: ItemType;
  consumesItem?: boolean;
  resolves?: SymptomType;
}

const ACTION_REQUIREMENTS: Record<string, ActionRequirements> = {
  [BlockType.GiveTreat]: { requiresItem: 'treat', consumesItem: true },
  [BlockType.BrushPet]: { requiresItem: 'brush', consumesItem: false, resolves: 'dirty' },
  [BlockType.CleanStation]: { consumesItem: false },
  [BlockType.ApplyBandage]: { requiresItem: 'bandage', consumesItem: true, resolves: 'injured' },
  [BlockType.ApplyOintment]: { requiresItem: 'ointment', consumesItem: true, resolves: 'itchy' },
  [BlockType.GiveMedicine]: { requiresItem: 'medicine', consumesItem: true, resolves: 'sniffles' },
  [BlockType.CheckVitals]: { consumesItem: false },
  [BlockType.Wait]: { consumesItem: false }
};

export function executeProgram(
  program: ProgramGraph,
  puzzle: PuzzleDefinition,
  options?: Partial<RuntimeOptions>
): ExecutionResult {
  const runtimeOptions = { ...DEFAULT_OPTIONS, ...options };
  const compileResult = compileProgram(program);
  if (compileResult.errors.length) {
    return buildFailureResult(
      'invalidProgram',
      puzzle,
      compileResult,
      [],
      selectHint(puzzle, 'invalidProgram')
    );
  }
  if (compileResult.disconnectedBlockIds.length && runtimeOptions.failOnDisconnected) {
    return buildFailureResult(
      'disconnectedBlocks',
      puzzle,
      compileResult,
      [],
      selectHint(puzzle, 'disconnectedBlocks')
    );
  }

  const gridModel = createGridModel(puzzle.grid);
  const state: RuntimeWorldState = {
    puzzle,
    position: { x: puzzle.entities.pet.start.x, y: puzzle.entities.pet.start.y },
    facing: puzzle.entities.pet.start.direction ?? 'east',
    symptoms: new Set(puzzle.entities.pet.symptoms),
    inventory: [],
    collectedObjects: new Set<string>(),
    actionLog: [],
    timestamp: 0
  };

  const events: RuntimeEvent[] = [];
  let executedInstructions = 0;
  let loopIterations = 0;

  const actionContext = {
    gridModel,
    state,
    events,
    runtimeOptions,
    compileResult
  };

  for (const instruction of compileResult.instructions) {
    executedInstructions += 1;
    if (executedInstructions > runtimeOptions.maxInstructionCount) {
      return buildFailureResult(
        'loopGuardExceeded',
        puzzle,
        compileResult,
        events,
        selectHint(puzzle, 'loopGuardExceeded'),
        state,
        executedInstructions,
        loopIterations
      );
    }
    const outcome = executeInstruction(instruction, actionContext);
    if (outcome?.failureReason) {
      return buildFailureResult(
        outcome.failureReason,
        puzzle,
        compileResult,
        events,
        selectHint(puzzle, outcome.failureReason),
        state,
        executedInstructions,
        loopIterations
      );
    }
    if ('loopIterations' in outcome && typeof outcome.loopIterations === 'number') {
      loopIterations += outcome.loopIterations;
    }
  }

  const criteriaEvaluation = evaluateSuccessCriteria(puzzle.successCriteria, state);
  if (!criteriaEvaluation.passed) {
    const reason = criteriaEvaluation.failureReason ?? 'goalNotMet';
    return buildFailureResult(
      reason,
      puzzle,
      compileResult,
      events,
      selectHint(puzzle, reason),
      state,
      executedInstructions,
      loopIterations
    );
  }

  return {
    status: 'success',
    events,
    failureReason: undefined,
    hint: undefined,
    metrics: {
      executedInstructions,
      loopIterations
    },
    finalState: snapshotState(state),
    disconnectedBlockIds: compileResult.disconnectedBlockIds
  };
}

function executeInstruction(
  instruction: Instruction,
  ctx: {
    gridModel: GridModel;
    state: RuntimeWorldState;
    events: RuntimeEvent[];
    runtimeOptions: RuntimeOptions;
    compileResult: CompileResult;
  }
): { failureReason?: FailureReason; loopIterations?: number } | void {
  const { state, gridModel, events, runtimeOptions } = ctx;
  switch (instruction.kind) {
    case 'move': {
      for (let i = 0; i < instruction.steps; i += 1) {
        const current = { ...state.position };
        const next = positionAfterStep(state.position, state.facing);
        if (!gridModel.walkable.has(key(next.x, next.y))) {
          events.push({
            type: 'move.step',
            blockId: instruction.blockId,
            from: current,
            to: next,
            direction: state.facing,
            blocked: true
          });
          return { failureReason: 'collision' };
        }
        state.position = next;
        events.push({
          type: 'move.step',
          blockId: instruction.blockId,
          from: current,
          to: next,
          direction: state.facing,
          blocked: false
        });
      }
      return;
    }
    case 'turn': {
      if (instruction.direction === 'face' && instruction.faceDirection) {
        state.facing = instruction.faceDirection;
      } else {
        state.facing = rotate(state.facing, instruction.direction);
      }
      events.push({ type: 'turn', blockId: instruction.blockId, direction: state.facing });
      return;
    }
    case 'action': {
      return performActionInstruction(instruction, state, events);
    }
    case 'loop': {
      let iterations = 0;
      for (let i = 0; i < instruction.iterations; i += 1) {
        iterations += 1;
        const outcome = runInstructionList(instruction.body, ctx);
        events.push({ type: 'loop.iteration', blockId: instruction.blockId, iteration: i });
        if (outcome?.loopIterations) {
          iterations += outcome.loopIterations;
        }
        if (outcome?.failureReason) return outcome;
      }
      return { loopIterations: iterations };
    }
    case 'sequenceLoop': {
      let iterations = 0;
      for (let i = 0; i < instruction.count; i += 1) {
        iterations += 1;
        const outcome = runInstructionList(instruction.body, ctx);
        events.push({ type: 'loop.iteration', blockId: instruction.blockId, iteration: i });
        if (outcome?.loopIterations) {
          iterations += outcome.loopIterations;
        }
        if (outcome?.failureReason) return outcome;
      }
      return { loopIterations: iterations };
    }
    case 'loopUntil': {
      let iterations = 0;
      while (!evalCondition(instruction.condition, state)) {
        if (iterations >= runtimeOptions.maxLoopIterations) {
          return { failureReason: 'loopGuardExceeded' };
        }
        iterations += 1;
        const outcome = runInstructionList(instruction.body, ctx);
        events.push({ type: 'loop.iteration', blockId: instruction.blockId, iteration: iterations });
        if (outcome?.loopIterations) {
          iterations += outcome.loopIterations;
        }
        if (outcome?.failureReason) return outcome;
      }
      return { loopIterations: iterations };
    }
    case 'branch': {
      const result = evalCondition(instruction.condition, state);
      events.push({
        type: 'condition.checked',
        blockId: instruction.blockId,
        outcome: result,
        condition: instruction.condition
      });
      const body = result ? instruction.whenTrue : instruction.whenFalse ?? [];
      const outcome = runInstructionList(body, ctx);
      if (outcome?.loopIterations) {
        return { loopIterations: outcome.loopIterations };
      }
      if (outcome?.failureReason) return outcome;
      return;
    }
    default:
      return;
  }
}

function runInstructionList(
  list: Instruction[],
  ctx: {
    gridModel: GridModel;
    state: RuntimeWorldState;
    events: RuntimeEvent[];
    runtimeOptions: RuntimeOptions;
    compileResult: CompileResult;
  }
): { failureReason?: FailureReason; loopIterations?: number } | void {
  let totalLoopIterations = 0;
  for (const instruction of list) {
    const outcome = executeInstruction(instruction, ctx);
    if (outcome?.loopIterations) {
      totalLoopIterations += outcome.loopIterations;
    }
    if (outcome?.failureReason) {
      return outcome;
    }
  }
  if (totalLoopIterations) {
    return { loopIterations: totalLoopIterations };
  }
  return;
}

function performActionInstruction(
  instruction: ActionInstruction,
  state: RuntimeWorldState,
  events: RuntimeEvent[]
): { failureReason?: FailureReason } | void {
  switch (instruction.action) {
    case BlockType.PickUpItem: {
      const object = state.puzzle.entities.objects.find(
        (o) => !state.collectedObjects.has(o.id) && positionsMatch(state.position, o.position)
      );
      if (!object || !object.itemType) {
        events.push({ type: 'action', blockId: instruction.blockId, action: instruction.action, success: false });
        return { failureReason: 'missingItem' };
      }
      state.collectedObjects.add(object.id);
      state.inventory.push(object.itemType);
      events.push({
        type: 'action',
        blockId: instruction.blockId,
        action: instruction.action,
        targetId: object.id,
        itemType: object.itemType,
        success: true
      });
      return;
    }
    case BlockType.DropItem: {
      const desired = instruction.args?.['item'] as ItemType | undefined;
      const index = desired ? state.inventory.indexOf(desired) : state.inventory.length - 1;
      if (index < 0) {
        events.push({ type: 'action', blockId: instruction.blockId, action: instruction.action, success: false });
        return { failureReason: 'missingItem' };
      }
      const [item] = state.inventory.splice(index, 1);
      const target = findTargetAtPosition(state);
      events.push({
        type: 'action',
        blockId: instruction.blockId,
        action: instruction.action,
        itemType: item,
        targetId: target?.id,
        success: true
      });
      logActionRecord(state, instruction.action, state.position, target?.id, item);
      return;
    }
    default: {
      const requirements = ACTION_REQUIREMENTS[instruction.action] ?? {};
      if (requirements.requiresItem && !state.inventory.includes(requirements.requiresItem)) {
        events.push({ type: 'action', blockId: instruction.blockId, action: instruction.action, success: false });
        return { failureReason: 'missingItem' };
      }
      if (requirements.requiresItem && requirements.consumesItem) {
        const index = state.inventory.indexOf(requirements.requiresItem);
        if (index >= 0) {
          state.inventory.splice(index, 1);
        }
      }
      if (requirements.resolves) {
        state.symptoms.delete(requirements.resolves);
      }
      const target = findTargetAtPosition(state);
      events.push({
        type: 'action',
        blockId: instruction.blockId,
        action: instruction.action,
        targetId: target?.id,
        success: true
      });
      logActionRecord(state, instruction.action, state.position, target?.id);
      return;
    }
  }
}

function findTargetAtPosition(state: RuntimeWorldState): PuzzleTarget | undefined {
  return state.puzzle.entities.targets.find((target) => positionsMatch(target.position, state.position));
}

function logActionRecord(
  state: RuntimeWorldState,
  action: string,
  position: Position,
  targetId?: string,
  itemType?: ItemType
): void {
  state.timestamp += 1;
  state.actionLog.push({ action, position: { ...position }, targetId, itemType, timestamp: state.timestamp });
}

interface CriteriaEvaluation {
  passed: boolean;
  failureReason?: FailureReason;
}

function evaluateSuccessCriteria(criteria: SuccessCriterion[], state: RuntimeWorldState): CriteriaEvaluation {
  for (const rule of criteria) {
    switch (rule.type) {
      case 'reach': {
        if (rule.targetId) {
          const target = state.puzzle.entities.targets.find((t) => t.id === rule.targetId);
          if (!target || !positionsMatch(state.position, target.position)) {
            return { passed: false, failureReason: 'goalNotMet' };
          }
        } else if (rule.targetPosition && !positionsMatch(state.position, rule.targetPosition)) {
          return { passed: false, failureReason: 'goalNotMet' };
        }
        break;
      }
      case 'collectItem': {
        if (!hasCollectedItem(state, rule.itemType)) {
          return { passed: false, failureReason: 'missingItem' };
        }
        break;
      }
      case 'performAction': {
        const matches = state.actionLog.filter((record) => record.action === rule.action);
        if (rule.targetId) {
          const found = matches.some((record) => record.targetId === rule.targetId);
          if (!found && !rule.optional) {
            return { passed: false, failureReason: 'missingAction' };
          }
        } else if (rule.targetIds?.length) {
          const remaining = rule.targetIds.filter(
            (targetId) => !matches.some((record) => record.targetId === targetId)
          );
          if (remaining.length && !rule.optional) {
            return { passed: false, failureReason: 'missingAction' };
          }
        } else if (rule.times && matches.length < rule.times) {
          return { passed: false, failureReason: 'missingAction' };
        } else if (!rule.optional && !matches.length) {
          return { passed: false, failureReason: 'missingAction' };
        }
        break;
      }
      case 'resolveSymptom': {
        if (state.symptoms.has(rule.symptom)) {
          return { passed: false, failureReason: 'goalNotMet' };
        }
        break;
      }
      case 'deliverItem': {
        const delivered = state.actionLog.some(
          (record) =>
            record.action === BlockType.DropItem &&
            record.targetId === rule.targetId &&
            record.itemType === rule.itemType
        );
        if (!delivered) {
          return { passed: false, failureReason: 'missingAction' };
        }
        break;
      }
      default:
        break;
    }
  }
  return { passed: true };
}

function snapshotState(state: RuntimeWorldState): WorldStateSnapshot {
  return {
    position: { ...state.position, direction: state.facing },
    inventory: [...state.inventory],
    remainingSymptoms: Array.from(state.symptoms),
    collectedObjectIds: Array.from(state.collectedObjects),
    actionLog: [...state.actionLog]
  };
}

function selectHint(puzzle: PuzzleDefinition, reason: FailureReason): string | undefined {
  return puzzle.hintRules.find((rule) => rule.failureReason === reason)?.hint;
}

function buildFailureResult(
  failureReason: FailureReason,
  puzzle: PuzzleDefinition,
  compileResult: CompileResult,
  events: RuntimeEvent[],
  hint: string | undefined,
  state: RuntimeWorldState | undefined = undefined,
  executedInstructions = 0,
  loopIterations = 0
): ExecutionResult {
  return {
    status: 'failure',
    failureReason,
    hint,
    events,
    metrics: {
      executedInstructions,
      loopIterations
    },
    finalState: state ? snapshotState(state) : {
      position: puzzle.entities.pet.start,
      inventory: [],
      remainingSymptoms: puzzle.entities.pet.symptoms,
      collectedObjectIds: [],
      actionLog: []
    },
    disconnectedBlockIds: compileResult.disconnectedBlockIds
  };
}

function hasCollectedItem(state: RuntimeWorldState, itemType: ItemType): boolean {
  if (state.inventory.includes(itemType)) {
    return true;
  }
  return state.puzzle.entities.objects.some(
    (object) => object.itemType === itemType && state.collectedObjects.has(object.id)
  );
}
