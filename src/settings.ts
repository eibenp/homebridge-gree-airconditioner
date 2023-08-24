/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'GREEAirConditioner';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = '@eibenp/homebridge-gree-airconditioner';

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
}

export const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  speedSteps: 5,
  statusUpdateInterval: 10,
  sensorOffset: 40,
  minimumTargetTemperature: 16,
  maximumTargetTemperature: 30,
  xFanEnabled: true,
  temperatureSensor: 'disabled',
};

export const UDP_SCAN_PORT = 7000;
