import dgram from 'dgram';
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { GreeACPlatform } from './platform';
import { DeviceConfig } from './settings';
import { GreeAirConditionerTS } from './tsAccessory';
import crypto from './crypto';
import commands from './commands';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class GreeAirConditioner {
  private HeaterCooler: Service;
  private TemperatureSensor: Service | undefined;
  private socket: dgram.Socket;
  private key: string | undefined;
  private cols: Array<string> | undefined;
  private bound: boolean;
  private status: object;
  private updateTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly platform: GreeACPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceConfig: DeviceConfig,
    private readonly port: number,
    private readonly platform_ts: GreeAirConditionerTS,
  ) {
    this.platform.log.debug(`[${this.getDeviceLabel()}] deviceConfig -> %j`, deviceConfig);
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, this.accessory.context.device.brand || 'Gree')
      .setCharacteristic(this.platform.Characteristic.Model,
        this.deviceConfig?.model || this.accessory.context.device.model || this.accessory.context.device.name || 'Air Conditioner')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.mac)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision,
        this.accessory.context.device.hid && this.accessory.context.device.hid.lastIndexOf('V') >= 0 &&
        this.accessory.context.device.hid.lastIndexOf('V') < this.accessory.context.device.hid.lastIndexOf('.') ?
          this.accessory.context.device.hid.substring(this.accessory.context.device.hid.lastIndexOf('V') + 1,
            this.accessory.context.device.hid.lastIndexOf('.')) : '1.0.0')
      .setCharacteristic(this.platform.Characteristic.HardwareRevision,
        this.accessory.context.device.ver ?
          this.accessory.context.device.ver.substring(this.accessory.context.device.ver.lastIndexOf('V') + 1) : '1.0.0');

    // get the HeaterCooler service if it exists, otherwise create a new  HeaterCooler service
    // we don't use subtype because we add only one service with this type
    this.HeaterCooler = this.accessory.getService(this.platform.Service.HeaterCooler) ||
      this.accessory.addService(this.platform.Service.HeaterCooler, this.accessory.displayName, undefined);
    this.HeaterCooler.displayName = this.accessory.displayName;

    if (deviceConfig.temperatureSensor === 'child') {
      this.platform.log.debug(`[${this.getDeviceLabel()}] Add Temperature Sensor child service`);
      this.TemperatureSensor = this.accessory.getService(this.platform.Service.TemperatureSensor) ||
        this.accessory.addService(this.platform.Service.TemperatureSensor, 'Temperature Sensor - ' + this.accessory.displayName, undefined);
      this.TemperatureSensor.displayName = 'Temperature Sensor - ' + this.accessory.displayName;
    } else {
      const ts = this.accessory.getService(this.platform.Service.TemperatureSensor);
      this.platform.log.debug(`[${this.getDeviceLabel()}] Temperature Sensor child service not allowed (%s)`, ts?.displayName);
      if (ts !== undefined) {
        this.platform.log.debug(`[${this.getDeviceLabel()}] Remove Temperature Sensor child service (%s)`, ts.displayName);
        this.accessory.removeService(ts);
      }
    }

    this.HeaterCooler.setPrimaryService(true);
    this.TemperatureSensor?.setPrimaryService(false);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/HeaterCooler

    // register handlers for the Active Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    // register handlers for the Current Heater-Cooler State Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));

    // register handlers for the Target Heater-Cooler State Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onGet(this.getTargetHeaterCoolerState.bind(this))
      .onSet(this.setTargetHeaterCoolerState.bind(this));

    // register handlers for the Current Temperature Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this, 'Heater Cooler'));
    this.TemperatureSensor?.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this, 'Temperature Sensor'));

    // register handlers for the Cooling Threshold Temperature Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .setProps({
        minValue: this.deviceConfig.minimumTargetTemperature,
        maxValue: this.deviceConfig.maximumTargetTemperature,
        minStep: 1.0 })
      .onGet(this.getTargetTemperature.bind(this, 'CoolingThresholdTemperature'))
      .onSet(this.setTargetTemperature.bind(this));

    // register handlers for the Heating Threshold Temperature Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .setProps({
        minValue: this.deviceConfig.minimumTargetTemperature,
        maxValue: this.deviceConfig.maximumTargetTemperature,
        minStep: 1.0 })
      .onGet(this.getTargetTemperature.bind(this, 'HeatingThresholdTemperature'))
      .onSet(this.setTargetTemperature.bind(this));

    // register handlers for the Temperature Display Units Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.getTemperatureDisplayUnits.bind(this))
      .onSet(this.setTemperatureDisplayUnits.bind(this));

    // register handlers for the Swing Mode Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.SwingMode)
      .onGet(this.getSwingMode.bind(this))
      .onSet(this.setSwingMode.bind(this));

    // register handlers for the Rotation Speed Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: this.deviceConfig.speedSteps + 3,
        minStep: 1 })
      .onGet(this.getRotationSpeed.bind(this))
      .onSet(this.setRotationSpeed.bind(this));

    // initialize communication with device
    this.status = {};
    this.bound = false;
    this.socket = dgram.createSocket({type: 'udp4', reuseAddr: true});
    this.socket.on('error', (err) => {
      this.platform.log.error(`[${this.getDeviceLabel()}] Network error ->`, err.message);
    });
    this.socket.on('message', this.handleMessage);
    this.socket.bind(this.port + parseInt(this.accessory.context.device.address.split('.')[3]) + 1,
      '0.0.0.0', () => {
        this.socket.setBroadcast(false);
        this.sendBindRequest();
      });
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory
   */
  async setActive(value: CharacteristicValue) {
    const powerValue = (value === this.platform.Characteristic.Active.ACTIVE);
    this.platform.log.debug(`[${this.getDeviceLabel()}] Set Active ->`, powerValue ? 'ACTIVE' : 'INACTIVE');
    this.power = powerValue;
  }

  async setTargetHeaterCoolerState(value: CharacteristicValue) {
    let modeValue = commands.mode.value.auto;
    let logValue = 'AUTO';
    switch (value) {
      case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
        modeValue = commands.mode.value.cool;
        logValue = 'COOL';
        break;
      case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
        modeValue = commands.mode.value.heat;
        logValue = 'HEAT';
        break;
    }
    this.platform.log.debug(`[${this.getDeviceLabel()}] Set TargetHeaterCoolerState ->`, logValue);
    this.mode = modeValue;
  }

  async setTargetTemperature(value: CharacteristicValue) {
    this.platform.log.debug(`[${this.getDeviceLabel()}] Set ThresholdTemperature ->`, value);
    this.targetTemperature = value as number;
  }

  async setTemperatureDisplayUnits(value: CharacteristicValue) {
    const logValue = (value === this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS) ? 'CELSIUS' : 'FAHRENHEIT';
    this.platform.log.debug(`[${this.getDeviceLabel()}] Set TemperatureDisplayUnits ->`, logValue);
    this.units = (value === this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS) ?
      commands.units.value.celsius : commands.units.value.fahrenheit;
  }

  async setSwingMode(value: CharacteristicValue) {
    const logValue = (value === this.platform.Characteristic.SwingMode.SWING_ENABLED) ? 'ENABLED' : 'DISABLED';
    this.platform.log.debug(`[${this.getDeviceLabel()}] Set SwingMode ->`, logValue);
    this.swingMode = (value === this.platform.Characteristic.SwingMode.SWING_ENABLED) ?
      commands.swingVertical.value.full : commands.swingVertical.value.default;
  }

  async setRotationSpeed(value: CharacteristicValue) {
    switch (value) {
      case 1: // quiet
        this.platform.log.debug(`[${this.getDeviceLabel()}] Set RotationSpeed ->`, value + ' (quiet)');
        this.quietMode = commands.quietMode.value.on;
        break;
      case 2: // auto
        this.platform.log.debug(`[${this.getDeviceLabel()}] Set RotationSpeed ->`, value +
          ' (' + this.getKeyName(commands.speed.value, commands.speed.value.auto) + ')');
        this.speed = commands.speed.value.auto;
        break;
      case 3: // low
        this.platform.log.debug(`[${this.getDeviceLabel()}] Set RotationSpeed ->`, value +
          ' (' + this.getKeyName(commands.speed.value, commands.speed.value.low) + ')');
        this.speed = commands.speed.value.low;
        break;
      case 4: // mediumLow / medium
        this.platform.log.debug(`[${this.getDeviceLabel()}] Set RotationSpeed ->`, value + ' (' +
          this.getKeyName(commands.speed.value,
            (this.deviceConfig.speedSteps === 5) ? commands.speed.value.mediumLow : commands.speed.value.medium) + ')');
        this.speed = (this.deviceConfig.speedSteps === 5) ? commands.speed.value.mediumLow : commands.speed.value.medium;
        break;
      case 5: // medium / high
        this.platform.log.debug(`[${this.getDeviceLabel()}] Set RotationSpeed ->`, value + ' (' +
          this.getKeyName(commands.speed.value,
            (this.deviceConfig.speedSteps === 5) ? commands.speed.value.medium : commands.speed.value.high) + ')');
        this.speed = (this.deviceConfig.speedSteps === 5) ? commands.speed.value.medium : commands.speed.value.high;
        break;
      case 6: // mediumHigh / powerful
        if (this.deviceConfig.speedSteps === 5) {
          // mediumHigh
          this.platform.log.debug(`[${this.getDeviceLabel()}] Set RotationSpeed ->`, value +
            ' (' + this.getKeyName(commands.speed.value, commands.speed.value.mediumHigh) + ')');
          this.speed = commands.speed.value.mediumHigh;
        } else {
          // powerful
          this.platform.log.debug(`[${this.getDeviceLabel()}] Set RotationSpeed ->`, value + ' (powerful)');
          this.powerfulMode = commands.powerfulMode.value.on;
        }
        break;
      case 7: // high
        this.platform.log.debug(`[${this.getDeviceLabel()}] Set RotationSpeed ->`, value +
          ' (' + this.getKeyName(commands.speed.value, commands.speed.value.high) + ')');
        this.speed = commands.speed.value.high;
        break;
      case 8: // powerful
        this.platform.log.debug(`[${this.getDeviceLabel()}] Set RotationSpeed ->`, value + ' (powerful)');
        this.powerfulMode = commands.powerfulMode.value.on;
        break;
      default: // auto
        this.platform.log.debug(`[${this.getDeviceLabel()}] Set RotationSpeed ->`, value +
          ' (' + this.getKeyName(commands.speed.value, commands.speed.value.auto) + ')');
        this.speed = commands.speed.value.auto;
        break;
    }
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)

   * if you need to return an error to show the device as "Not Responding" in the Home app:
   * throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  */
  async getActive(): Promise<CharacteristicValue> {
    const currentPower = this.power;
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get Active ->`,
      currentPower ? 'ACTIVE' : 'INACTIVE');
    return currentPower ?
      this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
  }

  async getCurrentHeaterCoolerState(): Promise<CharacteristicValue> {
    if (this.power) {
      switch (this.mode) {
        case commands.mode.value.cool:
          this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState ->`,
            'COOLING');
          return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
        case commands.mode.value.heat:
          this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState ->`,
            'HEATING');
          return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
        case commands.mode.value.fan:
        case commands.mode.value.dry:
          this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState ->`,
            'IDLE');
          return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
        case commands.mode.value.auto:
          if (this.currentTemperature > this.status[commands.targetTemperature.code]) {
            this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState ->`,
              'COOLING');
            return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
          }
          if (this.currentTemperature < this.status[commands.targetTemperature.code]) {
            this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState ->`,
              'HEATING');
            return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
          }
          this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState ->`,
            'IDLE');
          return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
      }
    }
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState ->`,
      'INACTIVE');
    return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
  }

  async getTargetHeaterCoolerState(): Promise<CharacteristicValue> {
    switch (this.mode) {
      case commands.mode.value.cool:
        this.platform.log.debug(`[${this.getDeviceLabel()}] Get TargetHeaterCoolerState ->`,
          'COOL');
        return this.platform.Characteristic.TargetHeaterCoolerState.COOL;
      case commands.mode.value.heat:
        this.platform.log.debug(`[${this.getDeviceLabel()}] Get TargetHeaterCoolerState ->`,
          'HEAT');
        return this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
    }
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get TargetHeaterCoolerState ->`,
      'AUTO');
    return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
  }

  async getCurrentTemperature(service: string): Promise<CharacteristicValue> {
    const currentValue = this.currentTemperature;
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get ${service} CurrentTemperature ->`,
      currentValue);
    return currentValue;
  }

  async getTargetTemperature(target: string): Promise<CharacteristicValue> {
    const currentValue = this.targetTemperature;
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get ${target} ->`,
      currentValue);
    return currentValue;
  }

  async getTemperatureDisplayUnits(): Promise<CharacteristicValue> {
    const currentValue = (this.units === commands.units.value.celsius) ?
      this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS : this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get TemperatureDisplayUnits ->`,
      (currentValue === this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS) ? 'CELSIUS' : 'FAHRENHEIT');
    return currentValue;
  }

  async getSwingMode(): Promise<CharacteristicValue> {
    switch (this.swingMode || commands.swingVertical.value.default) {
      case commands.swingVertical.value.default:
      case commands.swingVertical.value.fixedHighest:
      case commands.swingVertical.value.fixedHigher:
      case commands.swingVertical.value.fixedMiddle:
      case commands.swingVertical.value.fixedLower:
      case commands.swingVertical.value.fixedLowest:
        this.platform.log.debug(`[${this.getDeviceLabel()}] Get SwingMode ->`, 'DISABLED');
        return this.platform.Characteristic.SwingMode.SWING_DISABLED;
    }
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get SwingMode ->`, 'ENABLED');
    return this.platform.Characteristic.SwingMode.SWING_ENABLED;
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {
    if (this.quietMode === commands.quietMode.value.on) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get RotationSpeed -> 1 (quiet)`);
      return 1;
    }
    if (this.powerfulMode === commands.powerfulMode.value.on) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get RotationSpeed ->`, (this.deviceConfig.speedSteps + 3) + ' (powerful)');
      return this.deviceConfig.speedSteps + 3;
    }
    let value = 2; // default to auto
    let logValue = this.getKeyName(commands.speed.value, commands.speed.value.auto);
    switch (this.speed) {
      case commands.speed.value.low:
        value = 3;
        logValue = this.getKeyName(commands.speed.value, commands.speed.value.low);
        break;
      case commands.speed.value.mediumLow:
        value = 4;
        logValue = this.getKeyName(commands.speed.value,
          (this.deviceConfig.speedSteps === 5) ? commands.speed.value.mediumLow : commands.speed.value.medium);
        break;
      case commands.speed.value.medium:
        value = (this.deviceConfig.speedSteps === 5) ? 5 : 4;
        logValue = this.getKeyName(commands.speed.value, commands.speed.value.medium);
        break;
      case commands.speed.value.mediumHigh:
        value = (this.deviceConfig.speedSteps === 5) ? 6 : 4;
        logValue = this.getKeyName(commands.speed.value,
          (this.deviceConfig.speedSteps === 5) ? commands.speed.value.mediumHigh : commands.speed.value.medium);
        break;
      case commands.speed.value.high:
        value = (this.deviceConfig.speedSteps === 5) ? 7 : 5;
        logValue = this.getKeyName(commands.speed.value, commands.speed.value.high);
        break;
    }
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get RotationSpeed ->`, value + ' (' + logValue + ')');
    return value;
  }

  // helper functions
  getDeviceLabel() {
    return `${this.accessory.displayName} -- ${this.accessory.context.device.address}:${this.accessory.context.device.port}`;
  }

  getCols() {
    if (!this.cols) {
      this.cols = Object.keys(commands).map((k) => commands[k].code);
    }
    return this.cols;
  }

  getKeyName(obj, value, subkey?): string {
    let name = '';
    if (subkey === undefined) {
      Object.entries(obj).find(([key, val]) => {
        if (val === value) {
          name = key;
          return true;
        }
        return false;
      });
    } else {
      Object.entries(obj).find(([key, val]) => {
        const v = val as Array<unknown>;
        if (v[subkey] === value) {
          name = key;
          return true;
        }
        return false;
      });
    }
    return name;
  }

  // device functions
  get power() {
    return (this.status[commands.power.code] === commands.power.value.on);
  }

  set power(value) {
    if (value === this.power) {
      return;
    }
    const powerValue = value ? commands.power.value.on : commands.power.value.off;
    const command: Record<string, unknown> = { [commands.power.code]: powerValue };
    let logValue = 'power -> ' + this.getKeyName(commands.power.value, powerValue);
    if (powerValue === commands.power.value.on) {
      switch (this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value) {
        case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
          if (this.status[commands.mode.code] !== commands.mode.value.cool) {
            command[commands.mode.code] = commands.mode.value.cool;
            logValue += ', mode -> ' + this.getKeyName(commands.mode.value, commands.mode.value.cool);
            if (this.deviceConfig.xFanEnabled && (this.status[commands.xFan.code] || commands.xFan.value.off) !== commands.xFan.value.on) {
              // turn on xFan in Cool mode if xFan is enabled for this device
              logValue += ', xFan -> ' + this.getKeyName(commands.xFan.value, commands.xFan.value.on);
              command[commands.xFan.code] = commands.xFan.value.on;
            }
          }
          break;
        case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
          if (this.status[commands.mode.code] !== commands.mode.value.heat) {
            command[commands.mode.code] = commands.mode.value.heat;
            logValue += ', mode -> ' + this.getKeyName(commands.mode.value, commands.mode.value.heat);
          }
          break;
        case this.platform.Characteristic.TargetHeaterCoolerState.AUTO:
          if (this.status[commands.mode.code] !== commands.mode.value.auto) {
            command[commands.mode.code] = commands.mode.value.auto;
            logValue += ', mode -> ' + this.getKeyName(commands.mode.value, commands.mode.value.auto);
          }
          break;
      }
    }
    this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
    this.sendCommand(command);
  }

  get mode() {
    return this.status[commands.mode.code] || commands.mode.value.auto;
  }

  set mode(value) {
    if (value === this.mode) {
      return;
    }
    let logValue = 'mode -> ' + this.getKeyName(commands.mode.value, value);
    const command: Record<string, unknown> = { [commands.mode.code]: value };
    if (this.deviceConfig.xFanEnabled && (this.status[commands.xFan.code] || commands.xFan.value.off) !== commands.xFan.value.on &&
      (value === commands.mode.value.cool || value === commands.mode.value.dry)) {
      // turn on xFan in Cool and Dry mode if xFan is enabled for this device
      logValue += ', xFan -> ' + this.getKeyName(commands.xFan.value, commands.xFan.value.on);
      command[commands.xFan.code] = commands.xFan.value.on;
    }
    this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
    this.sendCommand(command);
  }

  get currentTemperature() {
    return this.status[commands.temperature.code] - (this.deviceConfig.sensorOffset) || 25;
  }

  get targetTemperature() {
    return Math.max(Math.min((this.status[commands.targetTemperature.code] || 25) + (this.status[commands.temperatureOffset.code] || 1) - 1,
      (this.deviceConfig.maximumTargetTemperature)), (this.deviceConfig.minimumTargetTemperature));
  }

  set targetTemperature(value) {
    if (value === this.targetTemperature) {
      return;
    }
    const command: Record<string, unknown> = { [commands.targetTemperature.code]: value };
    let logValue = 'targetTemperature -> ' + value;
    const displayUnits = this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits).value;
    const deviceDisplayUnits = (displayUnits === this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS) ?
      commands.units.value.celsius : commands.units.value.fahrenheit;
    if (deviceDisplayUnits !== this.units) {
      command[commands.units.code] = deviceDisplayUnits;
      logValue += ', units -> ' + this.getKeyName(commands.units.value, deviceDisplayUnits);
    }
    this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
    this.sendCommand(command);
  }

  get units() {
    return this.status[commands.units.code] || commands.units.value.celsius;
  }

  set units(value) {
    if (value === this.units) {
      return;
    }
    const command: Record<string, unknown> = { [commands.units.code]: value };
    this.platform.log.info(`[${this.getDeviceLabel()}] units ->`, this.getKeyName(commands.units.value, value));
    this.sendCommand(command);
  }

  get swingMode() {
    return this.status[commands.swingVertical.code] || commands.swingVertical.value.default;
  }

  set swingMode(value) {
    if (value === this.swingMode) {
      return;
    }
    const command: Record<string, unknown> = { [commands.swingVertical.code]: value };
    this.platform.log.info(`[${this.getDeviceLabel()}] swingVertical ->`, this.getKeyName(commands.swingVertical.value, value));
    this.sendCommand(command);
  }

  get speed() {
    return this.status[commands.speed.code] || commands.speed.value.auto;
  }

  set speed(value) {
    if (value === this.speed) {
      return;
    }
    const command: Record<string, unknown> = { [commands.speed.code]: value };
    command[commands.quietMode.code] = commands.quietMode.value.off;
    command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
    this.platform.log.info(`[${this.getDeviceLabel()}] speed ->`, this.getKeyName(commands.speed.value, value) +
      ', quietMode -> ' + this.getKeyName(commands.quietMode.value, commands.quietMode.value.off) +
      ', powerfulMode -> ' + this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off));
    this.sendCommand(command);
  }

  get quietMode() {
    return this.status[commands.quietMode.code] || commands.quietMode.value.off;
  }

  set quietMode(value) {
    if (value === this.quietMode) {
      return;
    }
    const command: Record<string, unknown> = { [commands.quietMode.code]: value };
    let logValue = 'quietMode -> ' + this.getKeyName(commands.quietMode.value, value);
    if (value === commands.quietMode.value.on) {
      command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
      logValue += ', powerfulMode -> ' + this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
      command[commands.speed.code] = commands.speed.value.low;
      logValue += ', speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.low);
    } else {
      command[commands.speed.code] = commands.speed.value.auto;
      logValue += ', speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.auto);
    }
    this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
    this.sendCommand(command);
  }

  get powerfulMode() {
    return this.status[commands.powerfulMode.code] || commands.powerfulMode.value.off;
  }

  set powerfulMode(value) {
    if (value === this.powerfulMode) {
      return;
    }
    let logValue = 'powerfulMode -> ' + this.getKeyName(commands.powerfulMode.value, value);
    const command: Record<string, unknown> = { [commands.powerfulMode.code]: value };
    if (value === commands.powerfulMode.value.on) {
      command[commands.quietMode.code] = commands.quietMode.value.off;
      logValue += ', quietMode -> ' + this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
      command[commands.speed.code] = commands.speed.value.high;
      logValue += ', speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.high);
    } else {
      command[commands.speed.code] = commands.speed.value.auto;
      logValue += ', speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.auto);
    }
    this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
    this.sendCommand(command);
  }

  updateStatus(props: string[]) {
    this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus -> %j`, props);
    // Active
    if (props.includes(commands.power.code)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Active) ->`, this.power ? 'ACTIVE' : 'INACTIVE');
      this.HeaterCooler.getCharacteristic(this.platform.Characteristic.Active)
        .updateValue(this.power ?
          this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);
    }
    // Current Heater-Cooler State
    if (props.includes(commands.mode.code)) {
      if (this.power) {
        switch (this.mode) {
          case commands.mode.value.cool:
            this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> COOLING`);
            this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
              .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.COOLING);
            break;
          case commands.mode.value.heat:
            this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> HEATING`);
            this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
              .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
            break;
          case commands.mode.value.fan:
          case commands.mode.value.dry:
            this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> IDLE`);
            this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
              .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
            break;
          case commands.mode.value.auto:
            if (this.currentTemperature > this.targetTemperature) {
              this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> COOLING`);
              this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.COOLING);
            }
            if (this.currentTemperature < this.targetTemperature) {
              this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> HEATING`);
              this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
            }
            if (this.currentTemperature === this.targetTemperature) {
              this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> IDLE`);
              this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
            }
            break;
        }
      } else {
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> INACTIVE`);
        this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
          .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE);
      }
    }
    // Target Heater-Cooler State
    if (props.includes(commands.mode.code) && this.power) {
      switch (this.mode) {
        case commands.mode.value.cool:
          this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Target Heater-Cooler State) -> COOL`);
          this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
            .updateValue(this.platform.Characteristic.TargetHeaterCoolerState.COOL);
          break;
        case commands.mode.value.heat:
          this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Target Heater-Cooler State) -> HEAT`);
          this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
            .updateValue(this.platform.Characteristic.TargetHeaterCoolerState.HEAT);
          break;
        default:
          this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Target Heater-Cooler State) -> AUTO`);
          this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
            .updateValue(this.platform.Characteristic.TargetHeaterCoolerState.AUTO);
      }
    }
    // Current Temperature
    if (props.includes(commands.temperature.code)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Temperature) ->`, this.currentTemperature);
      this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(this.currentTemperature);
      this.TemperatureSensor?.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(this.currentTemperature);
      this.platform_ts?.setCurrentTemperature(this.currentTemperature);
      this.platform_ts?.TemperatureSensor.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(this.currentTemperature);
    } else if (props.includes(commands.targetTemperature.code) && this.TemperatureSensor === undefined) {
      // temperature is not accessible -> targetTemperature is saved as currentTemperature
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Temperature) ->`, this.currentTemperature);
      this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(this.currentTemperature);
    }
    // Cooling Threshold Temperature
    if (props.includes(commands.targetTemperature.code) && this.power &&
      (this.mode === commands.mode.value.cool || this.mode === commands.mode.value.auto)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Cooling Threshold Temperature) ->`, this.targetTemperature);
      this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
        .updateValue(this.targetTemperature);
    }
    // Heating Threshold Temperature
    if (props.includes(commands.targetTemperature.code) && this.power &&
      (this.mode === commands.mode.value.heat || this.mode === commands.mode.value.auto)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Heating Threshold Temperature) ->`, this.targetTemperature);
      this.HeaterCooler.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
        .updateValue(this.targetTemperature);
    }
    // Temperature Display Units
    if (props.includes(commands.units.code)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Temperature Display Units) ->`,
        this.units === commands.units.value.celsius ? 'CELSIUS' : 'FAHRENHEIT');
      this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
        .updateValue(this.units === commands.units.value.celsius ?
          this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS : this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
    }
    // Swing Mode
    if (props.includes(commands.swingVertical.code) && this.power) {
      let swing = this.platform.Characteristic.SwingMode.SWING_ENABLED;
      let logValue = 'ENABLED';
      switch (this.swingMode){
        case commands.swingVertical.value.default:
        case commands.swingVertical.value.fixedHighest:
        case commands.swingVertical.value.fixedHigher:
        case commands.swingVertical.value.fixedMiddle:
        case commands.swingVertical.value.fixedLower:
        case commands.swingVertical.value.fixedLowest:
          swing = this.platform.Characteristic.SwingMode.SWING_DISABLED;
          logValue = 'DISABLED';
          break;
      }
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Swing Mode) ->`, logValue);
      this.HeaterCooler.getCharacteristic(this.platform.Characteristic.SwingMode)
        .updateValue(swing);
    }
    // Rotation Speed
    if (this.power) {
      let logValue = '2 (auto)';
      if (props.includes(commands.quietMode.code) && this.quietMode === commands.quietMode.value.on) {
        // quietMode -> on
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Rotation Speed) -> 1 (quiet)`);
        this.HeaterCooler.getCharacteristic(this.platform.Characteristic.RotationSpeed)
          .updateValue(1);
      } else if (props.includes(commands.powerfulMode.code) && this.powerfulMode === commands.powerfulMode.value.on) {
        // powerfulMode -> on
        logValue = `${this.deviceConfig.speedSteps + 3} (powerful)`;
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Rotation Speed) ->`, logValue);
        this.HeaterCooler.getCharacteristic(this.platform.Characteristic.RotationSpeed)
          .updateValue(this.deviceConfig.speedSteps + 3);
      } else if (props.includes(commands.speed.code)) {
        // speed
        let speedValue = 2; // default: auto
        switch (this.speed) {
          case commands.speed.value.low:
            logValue = '3 (low)';
            speedValue = 3;
            break;
          case commands.speed.value.mediumLow:
            logValue = '4 (mediumLow)';
            speedValue = 4;
            break;
          case commands.speed.value.medium:
            logValue = ((this.deviceConfig.speedSteps === 5) ? '5' : '4') + ' (medium)';
            speedValue = (this.deviceConfig.speedSteps === 5) ? 5 : 4;
            break;
          case commands.speed.value.mediumHigh:
            logValue = ((this.deviceConfig.speedSteps === 5) ? '6' : '4') + ' (mediumHigh)';
            speedValue = (this.deviceConfig.speedSteps === 5) ? 6 : 4;
            break;
          case commands.speed.value.high:
            logValue = ((this.deviceConfig.speedSteps === 5) ? '7' : '5') + ' (high)';
            speedValue = (this.deviceConfig.speedSteps === 5) ? 7 : 5;
            break;
        }
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Rotation Speed) ->`, logValue);
        this.HeaterCooler.getCharacteristic(this.platform.Characteristic.RotationSpeed)
          .updateValue(speedValue);
      }
    }
  }

  // device communication functions
  handleMessage = (msg, rinfo) => {
    if (this.accessory.context.device.address === rinfo.address) {
      const message = JSON.parse(msg.toString());
      this.platform.log.debug(`[${this.getDeviceLabel()}] handleMessage -> %j`, message);
      const pack = crypto.decrypt(
        message.pack,
        message.i === 1 ? undefined : this.key,
      );
      switch (pack.t) {
        case 'bindok': // package type is binding confirmation
          this.key = pack.key;
          this.bound = true;
          this.platform.log.debug(`[${this.getDeviceLabel()}] Package (Device binding) -> %j`, pack);
          this.platform.log.info(`[${this.getDeviceLabel()}] Device is bound -> ${this.key}`);
          if (this.updateTimer){
            clearInterval(this.updateTimer);
          }
          this.requestDeviceStatus();
          this.updateTimer = setInterval(this.requestDeviceStatus.bind(this),
            this.deviceConfig.statusUpdateInterval * 1000); // statusUpdateInterval in seconds
          break;
        case 'dat': // package type is device status
          if (this.bound){
            pack.cols.forEach((col, i) => {
              this.status[col] = pack.dat[i];
            });
            this.platform.log.debug(`[${this.getDeviceLabel()}] Package (Device status) -> %j`, pack);
            if (!(pack.cols as [string]).includes(commands.temperature.code) &&
              (pack.cols as [string]).includes(commands.targetTemperature.code)) {
              // temperature is not accessible -> use targetTemperature
              this.status[commands.temperature.code] = this.status[commands.targetTemperature.code] + this.deviceConfig.sensorOffset;
              if (this.TemperatureSensor !== undefined) {
                this.accessory.removeService(this.TemperatureSensor);
                this.TemperatureSensor = undefined;
                this.platform.log.debug(`[${this.getDeviceLabel()}] temperature is not accessible -> Temperature Sensor removed`);
              }
            }
            this.updateStatus(pack.cols as string[]);
          }
          break;
        case 'res': // package type is response
          if (this.bound){
            this.platform.log.debug(`[${this.getDeviceLabel()}] Package (Device response) -> %j`, pack);
            const updatedParams = [] as Array<string>;
            pack.opt.forEach((opt, i) => {
              const value = pack.p !== undefined ? pack.p[i] : pack.val[i];
              if (this.status[opt] !== value) {
                updatedParams.push(`${this.getKeyName(commands, opt, 'code')}: ${this.status[opt]} -> ${value}`);
              }
              this.status[opt] = value;
            });
            if (updatedParams.length > 0) {
              this.platform.log.info(`[${this.getDeviceLabel()}] Device updated (%j)`, updatedParams);
            }
          }
          break;
      }
    }
  };

  sendMessage(message) {
    const pack = crypto.encrypt(message, this.key);
    const payload = {
      cid: 'app',
      i: this.key === undefined ? 1 : 0,
      t: 'pack',
      uid: 0,
      tcid: this.accessory.context.device.mac,
      pack,
    };
    try {
      this.socket.send(
        JSON.stringify(payload),
        this.accessory.context.device.port,
        this.accessory.context.device.address,
      );
    } catch (err) {
      this.platform.log.error((err as Error).message);
    }
  }

  sendBindRequest() {
    const message = {
      mac: this.accessory.context.device.mac,
      t: 'bind',
      uid: 0,
    };
    this.platform.log.debug(`[${this.getDeviceLabel()}] Bind to device -> ${this.accessory.context.device.mac}`);
    this.sendMessage(message);
  }

  sendCommand(cmd) {
    this.platform.log.debug(`[${this.getDeviceLabel()}] Send commands -> %j`, cmd);
    const keys = Object.keys(cmd);
    const values = keys.map((k) => cmd[k]);
    const message = {
      t: 'cmd',
      opt: keys,
      p: values,
    };
    this.sendMessage(message);
  }

  requestDeviceStatus() {
    const message = {
      mac: this.accessory.context.device.mac,
      t: 'status',
      cols: this.getCols(),
    };
    this.sendMessage(message);
  }
}
