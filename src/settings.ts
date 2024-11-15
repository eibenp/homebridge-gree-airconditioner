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
  defaultVerticalSwing: commands.swingVertical.value.default,
  overrideDefaultVerticalSwing: OVERRIDE_DEFAULT_SWING.never,
  encryptionVersion: ENCRYPTION_VERSION.auto,
};

export const UDP_SCAN_PORT = 7000;

export const TEMPERATURE_TABLE = {
  '16,0': 16,
  '17,0': 16.5,
  '17,1': 17,
  '18,0': 18,
  '18,1': 18.5,
  '19,0': 19,
  '19,1': 19.5,
  '20,0': 20,
  '21,0': 20.5,
  '21,1': 21,
  '22,0': 21.5,
  '22,1': 22,
  '23,0': 23,
  '23,1': 23.5,
  '24,0': 24,
  '24,1': 24.5,
  '25,0': 25,
  '26,0': 25.5,
  '26,1': 26,
  '27,0': 26.5,
  '27,1': 27,
  '28,0': 28,
  '28,1': 28.5,
  '29,0': 29,
  '29,1': 29.5,
  '30,0': 30,
};

export const DEF_SCAN_INTERVAL = 60; // seconds

export const BINDING_TIMEOUT = 60000; // milliseconds
