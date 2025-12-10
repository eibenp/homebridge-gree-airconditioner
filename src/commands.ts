type CommandValueMap = Record<string, number>;

interface CommandWithValue {
  code: string;
  value: CommandValueMap;
}

interface CommandWithoutValue {
  code: string;
}

interface Commands {
  power: CommandWithValue;
  mode: CommandWithValue;
  targetTemperature: CommandWithoutValue;
  temperature: CommandWithoutValue;
  units: CommandWithValue;
  temperatureOffset: CommandWithoutValue;
  speed: CommandWithValue;
  swingHorizontal: CommandWithValue;
  swingVertical: CommandWithValue;
  xFan: CommandWithValue;
  light: CommandWithValue;
  quietMode: CommandWithValue;
  powerfulMode: CommandWithValue;
  HeatCoolType: CommandWithoutValue;
  energySaving: CommandWithValue;
  sleepMode: CommandWithValue;
  sleep: CommandWithValue;
  time: CommandWithoutValue;
  air: CommandWithValue;
  health: CommandWithValue;
  nofrost: CommandWithValue;
  buzzer: CommandWithValue;
}

export type { CommandValueMap, Commands };

const commands: Commands = {
  power: {
    code: 'Pow',
    value: {
      off: 0,
      on: 1,
    },
  },
  mode: {
    code: 'Mod',
    value: {
      auto: 0,
      cool: 1,
      dry: 2,
      fan: 3,
      heat: 4,
    },
  },
  targetTemperature: {
    code: 'SetTem',
  },
  temperature: {
    code: 'TemSen',
  },
  units: {
    code: 'TemUn',
    value: {
      celsius: 0,
      fahrenheit: 1,
    },
  },
  temperatureOffset: {
    code: 'TemRec',
  },
  speed: {
    code: 'WdSpd',
    value: {
      auto: 0,
      low: 1,
      mediumLow: 2, // not available on 3-speed units
      medium: 3,
      mediumHigh: 4, // not available on 3-speed units
      high: 5,
    },
  },
  swingHorizontal: {
    code: 'SwingLfRig',
    value: {
      default: 0,
      full: 1,
      left: 2,
      centerLeft: 3,
      center: 4,
      centerRight: 5,
      right: 6,
    },
  },
  swingVertical: {
    code: 'SwUpDn',
    value: {
      default: 0,
      full: 1, // swing in full range
      fixedHighest: 2, // fixed in the upmost position (1/5)
      fixedHigher: 3, // fixed in the middle-up position (2/5)
      fixedMiddle: 4, // fixed in the middle position (3/5)
      fixedLower: 5, // fixed in the middle-low position (4/5)
      fixedLowest: 6, // fixed in the lowest position (5/5)
      swingLowest: 7, // swing in the downmost region (5/5)
      swingLower: 8, // swing in the middle-low region (4/5)
      swingMiddle: 9, // swing in the middle region (3/5)
      swingHigher: 10, // swing in the middle-up region (2/5)
      swingHighest: 11, // swing in the upmost region (1/5)
    },
  },
  xFan: {
    code: 'Blo',
    value: {
      off: 0,
      on: 1,
    },
  },
  light: {
    code: 'Lig',
    value: {
      off: 0,
      on: 1,
    },
  },
  quietMode: {
    code: 'Quiet',
    value: {
      off: 0,
      on: 2,
    },
  },
  powerfulMode: {
    code: 'Tur',
    value: {
      off: 0,
      on: 1,
    },
  },
  HeatCoolType: {
    code: 'HeatCoolType',
  },
  energySaving: {
    code: 'SvSt',
    value: {
      off: 0,
      on: 1,
    },
  },
  // sleepMode and sleep should be syncronized (to turn on set both to 1 / to turn off set both to 0)
  sleepMode: {
    code: 'SwhSlp',
    value: {
      off: 0,
      on: 1,
    },
  },
  sleep: {
    code: 'SlpMod',
    value: {
      off: 0,
      on: 1,
    },
  },
  time: {
    code: 'time',
  },
  air: {
    code: 'Air',
    value: {
      off: 0,
      on: 1,
    },
  },
  health: {
    code: 'Health',
    value: {
      off: 0,
      on: 1,
    },
  },
  nofrost: { // nofrost on = heating to 8 ℃
    code: 'StHt',
    value: {
      off: 0,
      on: 1,
    },
  },
  buzzer: { // this is not persistent, AC does not remember it, but value = 1 can be used to send a command without a confirmation beep
    code: 'Buzzer_ON_OFF',
    value: {
      off: 1,
      on: 0,
    },
  },
};

export default commands;