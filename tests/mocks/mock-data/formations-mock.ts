import { Formation } from '../../../src/sdk';

const stratColumnId = 'x';
const wellboreId = 'x';
const color = 'black';

const xxFormations: Formation[] = [
  {
    stratColumnId,
    wellboreId,
    color,
    name: 'A',
    level: 1,
    entry: {
      mdMsl: 100,
    },
    exit: {
      mdMsl: 700,
    },
  },
  {
    stratColumnId,
    wellboreId,
    color,
    name: 'B',
    level: 1,
    entry: {
      mdMsl: 700,
    },
    exit: {
      mdMsl: 1000,
    },
  },
  {
    stratColumnId,
    wellboreId,
    color,
    name: 'C',
    level: 2,
    entry: {
      mdMsl: 200,
    },
    exit: {
      mdMsl: 300,
    },
  },
  {
    stratColumnId,
    wellboreId,
    color,
    name: 'D',
    level: 2,
    entry: {
      mdMsl: 500,
    },
    exit: {
      mdMsl: 700,
    },
  },
  {
    stratColumnId,
    wellboreId,
    color,
    name: 'E',
    level: 2,
    entry: {
      mdMsl: 700,
    },
    exit: {
      mdMsl: 800,
    },
  },
  {
    stratColumnId,
    wellboreId,
    color,
    name: 'F',
    level: 2,
    entry: {
      mdMsl: 800,
    },
    exit: {
      mdMsl: 1000,
    },
  },
  {
    stratColumnId,
    wellboreId,
    color,
    name: 'G',
    level: 3,
    entry: {
      mdMsl: 600,
    },
    exit: {
      mdMsl: 650,
    },
  },
  {
    stratColumnId,
    wellboreId,
    color,
    name: 'H',
    level: 3,
    entry: {
      mdMsl: 700,
    },
    exit: {
      mdMsl: 800,
    },
  },
  {
    stratColumnId,
    wellboreId,
    color,
    name: 'I',
    level: 3,
    entry: {
      mdMsl: 900,
    },
    exit: {
      mdMsl: 1000,
    },
  },
];

export const formations = {
  x: xxFormations,
};
