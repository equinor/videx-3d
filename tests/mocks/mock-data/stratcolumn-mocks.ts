import { StratColumn } from '../../../src/sdk'

const stratColumn: StratColumn = {
  id: 'a',
  name: "Test strat column",
  type: 'Test',
  units: [
    {
      id: "u1",
      name: "A",
      base: "A Base",
      top: "A Top",
      topAge: 0,
      baseAge: 10,
      color: "#ff0000",
      level: 1,
      parent: null,
      unitType: 'Test' 
    },
    {
      id: "u2",
      name: "B",
      base: "B Base",
      top: "B Top",
      topAge: 10,
      baseAge: 20,
      color: "#00ff00",
      level: 1,
      parent: null,
      unitType: 'Test' 
    },
    {
      id: "u3",
      name: "C",
      base: "C Base",
      top: "C Top",
      topAge: 20,
      baseAge: 30,
      color: "#0000ff",
      level: 1,
      parent: null,
      unitType: 'Test' 
    },
    {
      id: "u4",
      name: "D",
      base: "D Base",
      top: "D Top",
      topAge: 0,
      baseAge: 5,
      color: "#ffff00",
      level: 2,
      parent: 'A',
      unitType: 'Test' 
    },
    {
      id: "u5",
      name: "E",
      base: "E Base",
      top: "E Top",
      topAge: 5,
      baseAge: 10,
      color: "#ff00ff",
      level: 2,
      parent: 'A',
      unitType: 'Test' 
    },
    {
      id: "u6",
      name: "F",
      base: "F Base",
      top: "F Top",
      topAge: 10,
      baseAge: 15,
      color: "#00ff50",
      level: 2,
      parent: 'B',
      unitType: 'Test' 
    },
    {
      id: "u7",
      name: "G",
      base: "G Base",
      top: "G Top",
      topAge: 15,
      baseAge: 20,
      color: "#00ffff",
      level: 2,
      parent: 'B',
      unitType: 'Test' 
    },
    {
      id: "u8",
      name: "H",
      base: "H Base",
      top: "H Top",
      topAge: 20,
      baseAge: 22,
      color: "#ccff50",
      level: 2,
      parent: 'C',
      unitType: 'Test' 
    },
    {
      id: "u9",
      name: "I",
      base: "I Base",
      top: "I Top",
      topAge: 22,
      baseAge: 27,
      color: "#ccffff",
      level: 2,
      parent: 'C',
      unitType: 'Test' 
    },
    {
      id: "u10",
      name: "J",
      base: "J Base",
      top: "J Top",
      topAge: 27,
      baseAge: 30,
      color: "#ccff55",
      level: 2,
      parent: 'C',
      unitType: 'Test' 
    },
    {
      id: "u11",
      name: "K",
      base: "K Base",
      top: "K Top",
      topAge: 28,
      baseAge: 30,
      color: "#cc9955",
      level: 3,
      parent: 'J',
      unitType: 'Test' 
    }
  ]
}

export default {
  'a': stratColumn
}