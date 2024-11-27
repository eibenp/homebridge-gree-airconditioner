import commands from './commands';
/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'GREEAirConditioner';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-gree-ac';

export const OVERRIDE_DEFAULT_SWING = {
  never: 0,
  powerOn: 1,
  always: 2,
};

export const ENCRYPTION_VERSION = {
  auto: 0,
  v1: 1,
  v2: 2,
};

export const TS_TYPE = {
  disabled: 'disabled',
  separate: 'separate',
  child: 'child',
};

export const TEMPERATURE_STEPS = {
  celsius: 1,
  fahrenheit: 0.5,
};

export interface DeviceConfig {
  name?: string;
  model?: string;
  speedSteps: number;
  statusUpdateInterval: number;
  sensorOffset: number;
  minimumTargetTemperature: number;
  maximumTargetTemperature: number;
  xFanEnabled: boolean;
  temperatureSensor: string;
  temperatureStepSize?: number;
  disabled?: boolean;
  defaultVerticalSwing?: number;
  overrideDefaultVerticalSwing?: number;
  encryptionVersion?: number;
  port?: number;
  ip?: string;
}

export const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  speedSteps: 5,
  statusUpdateInterval: 10,
  sensorOffset: 40,
  minimumTargetTemperature: 16,
  maximumTargetTemperature: 30,
  xFanEnabled: true,
  temperatureSensor: TS_TYPE.disabled,
  temperatureStepSize: TEMPERATURE_STEPS.fahrenheit,
  defaultVerticalSwing: commands.swingVertical.value.default,
  overrideDefaultVerticalSwing: OVERRIDE_DEFAULT_SWING.never,
  encryptionVersion: ENCRYPTION_VERSION.auto,
};

export const TEMPERATURE_LIMITS = {
  coolingMinimum: 16,
  coolingMaximum: 30,
  heatingMinimum: 8,
  heatingMaximum: 30,
};

export const UDP_SCAN_PORT = 7000;

export const TEMPERATURE_TABLE = {
  //key: 1/2°C     °F °F->°C
  '8,0': 8,     // 46  7.77
  '8,1': 8.5,   // 47  8.33
  '9,0': 9,     // 48  8.88
  '9,1': 9.5,   // 49  9.44
  '10,0': 10,   // 50 10
  '11,0': 10.5, // 51 10.55
  '11,1': 11,   // 52 11.11
  '12,0': 11.5, // 53 11.66
  '12,1': 12,   // 54 12.22
  '13,0': 13,   // 55 12.77
  '13,1': 13.5, // 56 13.33
  '14,0': 14,   // 57 13.88
  '14,1': 14.5, // 58 14.44
  '15,0': 15,   // 59 15
  '15,1': 15.5, // 60 15.55
  '16,0': 16,   // 61 16.11
  '17,0': 16.5, // 62 16.66
  '17,1': 17,   // 63 17.22
  '18,0': 18,   // 64 17.77
  '18,1': 18.5, // 65 18.33
  '19,0': 19,   // 66 18.88
  '19,1': 19.5, // 67 19.44
  '20,0': 20,   // 68 20
  '21,0': 20.5, // 69 20.55
  '21,1': 21,   // 70 21.11
  '22,0': 21.5, // 71 21.66
  '22,1': 22,   // 72 22.22
  '23,0': 23,   // 73 22.77
  '23,1': 23.5, // 74 23.33
  '24,0': 24,   // 75 23.88
  '24,1': 24.5, // 76 24.44
  '25,0': 25,   // 77 25
  '26,0': 25.5, // 78 25.55
  '26,1': 26,   // 79 26.11
  '27,0': 26.5, // 80 26.66
  '27,1': 27,   // 81 27.22
  '28,0': 28,   // 82 27.77
  '28,1': 28.5, // 83 28.33
  '29,0': 29,   // 84 28.88
  '29,1': 29.5, // 85 29.44
  '30,0': 30,   // 86 30
};

export const DEF_SCAN_INTERVAL = 60; // seconds

export const BINDING_TIMEOUT = 60000; // milliseconds
