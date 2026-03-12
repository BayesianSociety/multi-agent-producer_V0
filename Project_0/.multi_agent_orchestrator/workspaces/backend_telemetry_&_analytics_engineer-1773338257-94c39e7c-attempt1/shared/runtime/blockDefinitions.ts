/**
 * Shared block metadata for Pet Vet Coding Puzzles.
 * These definitions are imported by both the frontend workspace and backend validators
 * so the block library stays in sync with puzzle + runtime capabilities.
 */

export const BLOCK_LIBRARY_VERSION = '1.0.0';

export type Direction = 'north' | 'east' | 'south' | 'west';

export type SymptomType = 'itchy' | 'sniffles' | 'injured' | 'dirty' | 'nervous';

export type ItemType =
  | 'treat'
  | 'brush'
  | 'ointment'
  | 'bandage'
  | 'medicine'
  | 'toy'
  | 'thermometer'
  | 'clipboard'
  | 'stethoscope';

export enum BlockCategory {
  Movement = 'movement',
  Actions = 'actions',
  Control = 'control',
  Logic = 'logic',
  Sensing = 'sensing',
  Utility = 'utility'
}

export enum BlockType {
  OnStart = 'core.onStart',
  MoveForward = 'movement.moveForward',
  MoveForwardSteps = 'movement.moveForwardSteps',
  TurnLeft = 'movement.turnLeft',
  TurnRight = 'movement.turnRight',
  FaceDirection = 'movement.faceDirection',
  PickUpItem = 'actions.pickUpItem',
  DropItem = 'actions.dropItem',
  BrushPet = 'actions.brushPet',
  CleanStation = 'actions.cleanStation',
  ApplyBandage = 'actions.applyBandage',
  GiveTreat = 'actions.giveTreat',
  ApplyOintment = 'actions.applyOintment',
  GiveMedicine = 'actions.giveMedicine',
  CheckVitals = 'actions.checkVitals',
  RepeatTimes = 'control.repeatTimes',
  RepeatUntil = 'control.repeatUntil',
  RepeatSequence = 'control.repeatSequence',
  IfCondition = 'logic.ifCondition',
  IfElseCondition = 'logic.ifElseCondition',
  Wait = 'utility.wait'
}

export type ArgumentType = 'number' | 'enum' | 'boolean' | 'condition' | 'direction' | 'item';

export interface BlockArgumentOption<T = string> {
  label: string;
  value: T;
}

export interface BlockArgument {
  name: string;
  label: string;
  type: ArgumentType;
  required?: boolean;
  description?: string;
  defaultValue?: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: BlockArgumentOption[];
}

export interface BlockChildSlot {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface BlockDefinition {
  type: BlockType;
  category: BlockCategory;
  label: string;
  description: string;
  args?: BlockArgument[];
  childSlots?: BlockChildSlot[];
  allowNext?: boolean;
}

export interface ConditionExpression {
  kind: 'symptom' | 'inventory' | 'location' | 'boolean';
  symptom?: SymptomType;
  item?: ItemType;
  location?: { x: number; y: number; targetId?: string };
  negate?: boolean;
  value?: boolean;
}

export interface ProgramBlockNode {
  id: string;
  type: BlockType;
  args?: Record<string, unknown>;
  next?: string | null;
  children?: Record<string, string | null>;
}

export interface ProgramGraph {
  rootId: string;
  nodes: Record<string, ProgramBlockNode>;
}

const movementBaseDescription = 'Moves the pet along the clinic grid, respecting walkable tiles.';

export const BLOCK_DEFINITIONS: Record<BlockType, BlockDefinition> = {
  [BlockType.OnStart]: {
    type: BlockType.OnStart,
    category: BlockCategory.Utility,
    label: 'On Start',
    description: 'Root entry block that wraps all player-authored logic.',
    allowNext: true
  },
  [BlockType.MoveForward]: {
    type: BlockType.MoveForward,
    category: BlockCategory.Movement,
    label: 'Walk 1 Step',
    description: `${movementBaseDescription} Advances exactly one tile forward.`,
    allowNext: true
  },
  [BlockType.MoveForwardSteps]: {
    type: BlockType.MoveForwardSteps,
    category: BlockCategory.Movement,
    label: 'Walk N Steps',
    description: `${movementBaseDescription} Repeats forward movement a fixed number of times.`,
    args: [
      {
        name: 'steps',
        label: 'Steps',
        type: 'number',
        defaultValue: 2,
        min: 1,
        max: 8
      }
    ],
    allowNext: true
  },
  [BlockType.TurnLeft]: {
    type: BlockType.TurnLeft,
    category: BlockCategory.Movement,
    label: 'Turn Left',
    description: 'Rotate the pet 90° counter-clockwise.',
    allowNext: true
  },
  [BlockType.TurnRight]: {
    type: BlockType.TurnRight,
    category: BlockCategory.Movement,
    label: 'Turn Right',
    description: 'Rotate the pet 90° clockwise.',
    allowNext: true
  },
  [BlockType.FaceDirection]: {
    type: BlockType.FaceDirection,
    category: BlockCategory.Movement,
    label: 'Face Direction',
    description: 'Instantly face a specific direction.',
    args: [
      {
        name: 'direction',
        label: 'Direction',
        type: 'direction',
        required: true,
        options: [
          { label: 'North', value: 'north' },
          { label: 'East', value: 'east' },
          { label: 'South', value: 'south' },
          { label: 'West', value: 'west' }
        ]
      }
    ],
    allowNext: true
  },
  [BlockType.PickUpItem]: {
    type: BlockType.PickUpItem,
    category: BlockCategory.Actions,
    label: 'Pick Up Item',
    description: 'Collect the item at the current tile and add it to inventory.',
    allowNext: true
  },
  [BlockType.DropItem]: {
    type: BlockType.DropItem,
    category: BlockCategory.Actions,
    label: 'Drop Item',
    description: 'Place the held item back onto the current tile or target.',
    args: [
      {
        name: 'item',
        label: 'Item',
        type: 'item',
        description: 'Optional hint for UI to show drop target.'
      }
    ],
    allowNext: true
  },
  [BlockType.BrushPet]: {
    type: BlockType.BrushPet,
    category: BlockCategory.Actions,
    label: 'Brush Pet',
    description: 'Use the brush to remove dirt or tangles.',
    allowNext: true
  },
  [BlockType.CleanStation]: {
    type: BlockType.CleanStation,
    category: BlockCategory.Actions,
    label: 'Clean Station',
    description: 'Clean items or exam stations at the current tile.',
    allowNext: true
  },
  [BlockType.ApplyBandage]: {
    type: BlockType.ApplyBandage,
    category: BlockCategory.Actions,
    label: 'Apply Bandage',
    description: 'Wrap an injured paw with a bandage.',
    allowNext: true
  },
  [BlockType.GiveTreat]: {
    type: BlockType.GiveTreat,
    category: BlockCategory.Actions,
    label: 'Give Treat',
    description: 'Give the pet a treat for comfort or reward.',
    allowNext: true
  },
  [BlockType.ApplyOintment]: {
    type: BlockType.ApplyOintment,
    category: BlockCategory.Actions,
    label: 'Apply Ointment',
    description: 'Soothe itchy skin with ointment.',
    allowNext: true
  },
  [BlockType.GiveMedicine]: {
    type: BlockType.GiveMedicine,
    category: BlockCategory.Actions,
    label: 'Give Medicine',
    description: 'Administer medicine for sniffles or fever.',
    allowNext: true
  },
  [BlockType.CheckVitals]: {
    type: BlockType.CheckVitals,
    category: BlockCategory.Actions,
    label: 'Check Vitals',
    description: 'Use tools to check temperature or heartbeat.',
    allowNext: true
  },
  [BlockType.RepeatTimes]: {
    type: BlockType.RepeatTimes,
    category: BlockCategory.Control,
    label: 'Repeat N Times',
    description: 'Run the enclosed blocks a fixed number of repetitions.',
    args: [
      {
        name: 'count',
        label: 'Count',
        type: 'number',
        required: true,
        min: 1,
        max: 16,
        defaultValue: 2
      }
    ],
    childSlots: [
      {
        name: 'body',
        label: 'Do'
      }
    ],
    allowNext: true
  },
  [BlockType.RepeatUntil]: {
    type: BlockType.RepeatUntil,
    category: BlockCategory.Control,
    label: 'Repeat Until',
    description: 'Loop until the condition becomes true or the guard limit is reached.',
    args: [
      {
        name: 'condition',
        label: 'Condition',
        type: 'condition',
        required: true
      }
    ],
    childSlots: [
      {
        name: 'body',
        label: 'Do'
      }
    ],
    allowNext: true
  },
  [BlockType.RepeatSequence]: {
    type: BlockType.RepeatSequence,
    category: BlockCategory.Control,
    label: 'Repeat Sequence',
    description: 'Loop over each station or tile defined by puzzle metadata.',
    args: [
      {
        name: 'count',
        label: 'Sequence Length',
        type: 'number',
        min: 1,
        max: 16,
        defaultValue: 3,
        description: 'Optional override for how many times to run the sequence.'
      }
    ],
    childSlots: [
      {
        name: 'body',
        label: 'Do'
      }
    ],
    allowNext: true
  },
  [BlockType.IfCondition]: {
    type: BlockType.IfCondition,
    category: BlockCategory.Logic,
    label: 'If',
    description: 'Run the enclosed blocks only when the condition is true.',
    args: [
      {
        name: 'condition',
        label: 'Condition',
        type: 'condition',
        required: true
      }
    ],
    childSlots: [
      {
        name: 'then',
        label: 'Then'
      }
    ],
    allowNext: true
  },
  [BlockType.IfElseCondition]: {
    type: BlockType.IfElseCondition,
    category: BlockCategory.Logic,
    label: 'If / Else',
    description: 'Choose between two sets of instructions depending on a condition.',
    args: [
      {
        name: 'condition',
        label: 'Condition',
        type: 'condition',
        required: true
      }
    ],
    childSlots: [
      {
        name: 'then',
        label: 'Then'
      },
      {
        name: 'else',
        label: 'Else'
      }
    ],
    allowNext: true
  },
  [BlockType.Wait]: {
    type: BlockType.Wait,
    category: BlockCategory.Utility,
    label: 'Pause',
    description: 'Insert a short pause (for animation pacing).',
    args: [
      {
        name: 'durationMs',
        label: 'Milliseconds',
        type: 'number',
        min: 0,
        max: 2000,
        defaultValue: 250
      }
    ],
    allowNext: true
  }
};

export const BLOCK_LIBRARY = Object.values(BLOCK_DEFINITIONS);
