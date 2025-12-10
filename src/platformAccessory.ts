import dgram from 'dgram';
import type { CharacteristicValue, Service } from 'homebridge';

import type { GreeACPlatform, MyPlatformAccessory } from './platform.js';
import { PLATFORM_NAME, PLUGIN_NAME, DeviceConfig, TEMPERATURE_TABLE, MODIFY_VERTICAL_SWING_POSITION, TS_TYPE, BINDING_TIMEOUT,
  TEMPERATURE_LIMITS, DEFAULT_DEVICE_CONFIG } from './settings.js';
import { GreeAirConditionerTS } from './tsAccessory.js';
import crypto from './crypto.js';
import type { CommandValueMap, Commands } from './commands.js';
import commands from './commands.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class GreeAirConditioner {
  private HeaterCooler?: Service;
  private TemperatureSensor?: Service;
  private Fan?: Service;
  private socket: dgram.Socket;
  private key?: string;
  private cols?: Array<string>;
  private status: { [key: string]: unknown };
  private tsAccessory: GreeAirConditionerTS | null = null;
  private powerPending = -1;
  private modePending = -1;
  private silentTimeRanges?: [number, number][];

  constructor(
    private readonly platform: GreeACPlatform,
    private readonly accessory: MyPlatformAccessory,
    private readonly deviceConfig: DeviceConfig,
    private readonly tsAccessoryMac: string,
  ) {
    // platform, accessory and service initialization is implemented in a separate funcion (initAccessory), because
    // it should be made only on successful binding with network device
    this.platform.log.debug(`[${this.getDeviceLabel()}] deviceConfig -> %j`, deviceConfig);

    // calculate silent time ranges
    if (deviceConfig.silentTimeRange) {
      const time1:number = +(deviceConfig.silentTimeRange.substring(0, 5).replace(':', ''));
      const time2:number = +(deviceConfig.silentTimeRange.substring(6).replace(':', ''));
      if (time1 < time2) {
        this.silentTimeRanges = [[time1, time2 < 2400 ? time2 + 1 : time2]];
      } else if (time1 > time2) {
        this.silentTimeRanges = [[time1, 2400], [0, time2 < 2400 ? time2 + 1 : time2]];
      }
      this.platform.log.debug(`[${this.getDeviceLabel()}] silentTimeRanges:`, this.silentTimeRanges ??
        'Zero length silentTimeRange is defined - ignoring');
    } else {
      this.platform.log.debug(`[${this.getDeviceLabel()}] silentTimeRanges: No silentTimeRange is defined`);
    }

    // initialize communication with device
    this.status = {};
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('error', (err) => {
      this.platform.log.error(`[${this.getDeviceLabel()}] Network - Error:`, err.message);
    });
    this.socket.on('message', this.handleMessage);
    this.socket.on('close', () => {
      this.platform.log.error(`[${this.getDeviceLabel()}] Network - Connection closed`);
    });
    if (this.platform.ports.indexOf(this.deviceConfig.port || 0) >= 0) {
      this.platform.log.warn(`[${this.getDeviceLabel()}] Warning: Configured port (%i) is already used - replacing with auto assigned port`,
        this.deviceConfig.port);
      this.deviceConfig.port = undefined;
    }
    this.socket.bind(this.deviceConfig.port, undefined, () => {
      this.platform.log.info(`[${this.getDeviceLabel()}] Device handler is listening on UDP port %d`, this.socket.address().port);
      this.platform.ports.push(this.socket.address().port);
      this.socket.setBroadcast(false);
      this.sendBindRequest();
      setTimeout(this.checkBindingStatus.bind(this, 1), BINDING_TIMEOUT);
    });
  }

  initCharacteristics() {
    // these characteristic properties are not updated by HomeKit, they are initialized only once

    // Cooling Threshold Temperature Characteristic
    // minValue / maxValue usually generates error messages in debug log:
    // "Characteristic 'Cooling Threshold Temperature': characteristic was supplied illegal value ..."
    // this is not a problem, this is information only that GREE is more restricitive than Apple's default
    this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .setProps({
        minStep: this.deviceConfig.temperatureStepSize,
        minValue: Math.max(this.deviceConfig.minimumTargetTemperature, TEMPERATURE_LIMITS.coolingMinimum),
        maxValue: Math.min(this.deviceConfig.maximumTargetTemperature, TEMPERATURE_LIMITS.coolingMaximum),
      });
    this.platform.log.debug(`[${this.getDeviceLabel()}] CoolingThresholdTemperature - minValue: %s, maxValue: %s, minStep: %s`,
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).props.minValue?.toString(),
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).props.maxValue?.toString(),
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).props.minStep?.toString());
    // Heating Threshold Temperature Characteristic
    // minValue / maxValue usually generates error messages in debug log:
    // "Characteristic 'Heating Threshold Temperature': characteristic was supplied illegal value ..."
    // this is not a problem, this is information only that GREE is more restricitive than Apple's default
    this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .setProps({
        minStep: this.deviceConfig.temperatureStepSize,
        minValue: Math.max(this.deviceConfig.minimumTargetTemperature, TEMPERATURE_LIMITS.heatingMinimum),
        maxValue: Math.min(this.deviceConfig.maximumTargetTemperature, TEMPERATURE_LIMITS.heatingMaximum),
      });
    this.platform.log.debug(`[${this.getDeviceLabel()}] HeatingThresholdTemperature - minValue: %s, maxValue: %s, minStep: %s`,
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).props.minValue?.toString(),
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).props.maxValue?.toString(),
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).props.minStep?.toString());
    // Rotation Speed Characteristic
    this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: this.deviceConfig.speedSteps + 3,
        minStep: 1 });
    this.platform.log.debug(`[${this.getDeviceLabel()}] RotationSpeed - minValue: %s, maxValue: %s, minStep: %s`,
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.minValue?.toString(),
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.maxValue?.toString(),
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.minStep?.toString());
  }

  // All platform, accessory and service initialization is made in initAccessory function
  initAccessory() {
    // register accessory in homebridge by api if not registered before
    if (!this.accessory.registered) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] Registering new accessory in homebridge:`, this.accessory.context.device.mac,
        this.accessory.UUID);
      this.platform.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.accessory]);
      // set static accessory information
      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, this.accessory.context.device.brand || 'Gree')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.mac)
        .setCharacteristic(this.platform.Characteristic.Model,
          this.deviceConfig?.model || this.accessory.context.device.model || this.accessory.context.device.name || 'Air Conditioner')
        .setCharacteristic(this.platform.Characteristic.HardwareRevision,
          this.accessory.context.device.ver ?
            this.accessory.context.device.ver.substring(this.accessory.context.device.ver.lastIndexOf('V') + 1) : '1.0.0')
        .setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);
      // get the HeaterCooler service if it exists, otherwise create a new  HeaterCooler service
      // we don't use subtype because we add only one service with this type
      this.HeaterCooler = this.accessory.getService(this.platform.Service.HeaterCooler) ||
        this.accessory.addService(this.platform.Service.HeaterCooler, this.accessory.displayName, undefined);
      // set static characeristics
      this.initCharacteristics();
    }
    if (this.tsAccessoryMac) {
      this.tsAccessory = new GreeAirConditionerTS(this.platform, this.platform.getAccessory(this.accessory.context.device.mac + '_ts'));
    }

    // init TargetHeaterCoolerState default value
    if (!this.accessory.context.TargetHeaterCoolerState) {
      this.accessory.context.TargetHeaterCoolerState =
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value ||
        this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    }

    // init HeaterCoolerRotationSpeed default value
    if (this.accessory.context.HeaterCoolerRotationSpeed === undefined) {
      this.accessory.context.HeaterCoolerRotationSpeed =
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).value ||
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.minValue || 0;
    }

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision,
        this.accessory.context.device.hid && this.accessory.context.device.hid.lastIndexOf('V') >= 0 &&
        this.accessory.context.device.hid.lastIndexOf('V') < this.accessory.context.device.hid.lastIndexOf('.') ?
          this.accessory.context.device.hid.substring(this.accessory.context.device.hid.lastIndexOf('V') + 1,
            this.accessory.context.device.hid.lastIndexOf('.')) : '1.0.0');

    // get the HeaterCooler service if it exists, otherwise create a new  HeaterCooler service
    // we don't use subtype because we add only one service with this type
    if (!this.HeaterCooler) {
      this.HeaterCooler = this.accessory.getService(this.platform.Service.HeaterCooler);
      if (!this.HeaterCooler) {
        this.platform.log.debug(`[${this.getDeviceLabel()}] HeaterCooler service doesn't exist - adding service`);
        this.HeaterCooler = this.accessory.addService(this.platform.Service.HeaterCooler, this.accessory.displayName);
        // set static characeristics
        this.initCharacteristics();
      }
    }

    // TemperatureSensor service
    // we don't use subtype because we add only one service with this type
    const tss = this.accessory.getService(this.platform.Service.TemperatureSensor);
    if (this.deviceConfig.temperatureSensor === TS_TYPE.child) {
      if (tss) {
        this.TemperatureSensor = tss;
      } else {
        this.platform.log.debug(`[${this.getDeviceLabel()}] Add Temperature Sensor child service`);
        this.TemperatureSensor =
          this.accessory.addService(this.platform.Service.TemperatureSensor, 'Temperature Sensor ' + this.HeaterCooler.displayName);
      }
    } else {
      this.platform.log.debug(`[${this.getDeviceLabel()}] Temperature Sensor child service not allowed`,
        tss?.displayName !== undefined ? '(' + tss?.displayName + ')' : '');
      if (tss !== undefined) {
        this.platform.log.debug(`[${this.getDeviceLabel()}] Remove Temperature Sensor child service (%s)`, tss.displayName);
        this.accessory.removeService(tss);
      }
    }

    // Fan service
    // we don't use subtype because we add only one service with this type
    const fs = this.accessory.getService(this.platform.Service.Fanv2);
    if (this.deviceConfig.fanControlEnabled) {
      if (fs) {
        this.Fan = fs;
      } else {
        this.platform.log.debug(`[${this.getDeviceLabel()}] Add Fan child service`);
        this.Fan =
          this.accessory.addService(this.platform.Service.Fanv2, 'Fan ' + this.HeaterCooler.displayName);
        // set static characeristics
        this.Fan?.getCharacteristic(this.platform.Characteristic.RotationSpeed)
          .setProps({
            minValue: 0,
            maxValue: 100,
            minStep: 100 / (this.deviceConfig.speedSteps + 1) });
        this.platform.log.debug(`[${this.getDeviceLabel()}] Fan RotationSpeed - minValue: %s, maxValue: %s, minStep: %s`,
          this.Fan?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.minValue?.toString(),
          this.Fan?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.maxValue?.toString(),
          this.Fan?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.minStep?.toString());
      }
    } else {
      this.platform.log.debug(`[${this.getDeviceLabel()}] Fan child service not allowed`,
        fs?.displayName !== undefined ? '(' + fs?.displayName + ')' : '');
      if (fs !== undefined) {
        this.platform.log.debug(`[${this.getDeviceLabel()}] Remove Fan child service (%s)`, fs.displayName);
        this.accessory.removeService(fs);
      }
    }

    this.HeaterCooler.setPrimaryService(true);
    this.TemperatureSensor?.setPrimaryService(false);
    this.Fan?.setPrimaryService(false);

    this.platform.api.updatePlatformAccessories([this.accessory]);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/HeaterCooler

    // register handlers for the Active Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));
    this.Fan?.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setFanActive.bind(this))
      .onGet(this.getFanActive.bind(this));

    // register handlers for the Current Heater-Cooler State Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));

    // register handlers for the Current Fan State Characteristic
    this.Fan?.getCharacteristic(this.platform.Characteristic.CurrentFanState)
      .onGet(this.getCurrentFanState.bind(this));

    // register handlers for the Target Heater-Cooler State Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onGet(this.getTargetHeaterCoolerState.bind(this))
      .onSet(this.setTargetHeaterCoolerState.bind(this));

    // register handlers for the Current Temperature Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this, 'Heater-Cooler'));
    this.TemperatureSensor?.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this, 'Temperature Sensor'));

    // register handlers for the Cooling Threshold Temperature Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .onGet(this.getTargetTemperature.bind(this, 'CoolingThresholdTemperature'))
      .onSet(this.setTargetTemperature.bind(this));

    // register handlers for the Heating Threshold Temperature Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
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
    this.Fan?.getCharacteristic(this.platform.Characteristic.SwingMode)
      .onGet(this.getSwingMode.bind(this))
      .onSet(this.setFanSwingMode.bind(this));

    // register handlers for the Rotation Speed Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.getRotationSpeed.bind(this))
      .onSet(this.setRotationSpeed.bind(this));
    this.Fan?.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.getFanRotationSpeed.bind(this))
      .onSet(this.setFanRotationSpeed.bind(this));

    // register handlers for the Name Characteristic
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.Name)
      .onGet(this.getName.bind(this));
  }

  // this function is a callback to check the status of binding after timeout period has ellapsed
  checkBindingStatus(bindNo: number) {
    if (!this.accessory.bound) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] Device binding timeout`);
      switch (bindNo) {
      case 1: {
        // 1. timeout -> repeat bind request with alternate encryption version
        if (this.accessory.context.device.encryptionVersion === 1) {
          this.accessory.context.device.encryptionVersion = 2;
        } else {
          this.accessory.context.device.encryptionVersion = 1;
        }
        this.sendBindRequest();
        setTimeout(this.checkBindingStatus.bind(this, bindNo + 1), BINDING_TIMEOUT);
        break;
      }
      default: {
        this.platform.log.error(`[${this.getDeviceLabel()}] Error: Device is not bound`,
          '(unknown device type or device is malfunctioning [turning the power supply off and on may help])',
          '- Restart homebridge when issue has fixed!');
      }
      }
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setActive(value: CharacteristicValue) {
    const powerValue = (value === this.platform.Characteristic.Active.ACTIVE);
    this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler Active ->`, powerValue ? 'ACTIVE' : 'INACTIVE');
    this.power = powerValue;
    if (powerValue &&
      this.Fan?.getCharacteristic(this.platform.Characteristic.Active).value === this.platform.Characteristic.Active.ACTIVE) {
      this.Fan?.getCharacteristic(this.platform.Characteristic.Active).updateValue(this.platform.Characteristic.Active.INACTIVE);
    }
  }

  async setFanActive(value: CharacteristicValue) {
    const powerValue = (value === this.platform.Characteristic.Active.ACTIVE);
    this.platform.log.debug(`[${this.getDeviceLabel()}] Set Fan Active ->`, powerValue ? 'ACTIVE' : 'INACTIVE');
    this.fanpower = powerValue;
    if (powerValue &&
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.Active).value === this.platform.Characteristic.Active.ACTIVE) {
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.Active).updateValue(this.platform.Characteristic.Active.INACTIVE);
    }
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
    this.accessory.context.TargetHeaterCoolerState = value;
    this.platform.api.updatePlatformAccessories([this.accessory]);
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
    this.swingMode = (value === this.platform.Characteristic.SwingMode.SWING_ENABLED) ?
      commands.swingVertical.value.full : ([MODIFY_VERTICAL_SWING_POSITION.overrideDefPowerOnOscDisable,
        MODIFY_VERTICAL_SWING_POSITION.setPowerOnOscDisable].includes(this.deviceConfig.modifyVerticalSwingPosition ||
        DEFAULT_DEVICE_CONFIG.modifyVerticalSwingPosition) ? this.deviceConfig.defaultVerticalSwing ||
        DEFAULT_DEVICE_CONFIG.defaultVerticalSwing : DEFAULT_DEVICE_CONFIG.defaultVerticalSwing);
    this.platform.log.debug(`[${this.getDeviceLabel()}] Set SwingMode ->`, logValue + (logValue === 'DISABLED' ?
      ` (Position: ${this.getKeyName(commands.swingVertical.value, this.swingMode)})` : ''));
  }

  async setFanSwingMode(value: CharacteristicValue) {
    const logValue = (value === this.platform.Characteristic.SwingMode.SWING_ENABLED) ? 'ENABLED' : 'DISABLED';
    this.swingMode = (value === this.platform.Characteristic.SwingMode.SWING_ENABLED) ?
      commands.swingVertical.value.full : (this.deviceConfig.modifyVerticalSwingPosition ===
        MODIFY_VERTICAL_SWING_POSITION.overrideDefPowerOnOscDisable ? this.deviceConfig.defaultVerticalSwing ||
        DEFAULT_DEVICE_CONFIG.defaultVerticalSwing : (this.deviceConfig.modifyVerticalSwingPosition ===
        MODIFY_VERTICAL_SWING_POSITION.setPowerOnOscDisable ? this.deviceConfig.defaultFanVerticalSwing ||
        DEFAULT_DEVICE_CONFIG.defaultFanVerticalSwing : DEFAULT_DEVICE_CONFIG.defaultFanVerticalSwing));
    this.platform.log.debug(`[${this.getDeviceLabel()}] Set Fan SwingMode ->`, logValue + (logValue === 'DISABLED' ?
      ` (Position: ${this.getKeyName(commands.swingVertical.value, this.swingMode)})` : ''));
  }

  async setRotationSpeed(value: CharacteristicValue) {
    const maxSpeed = this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.maxValue ||
        this.deviceConfig.speedSteps + 3;
    switch (value) {
    case 0: // inactive -> rotation speed change not needed
      return;
    case 1: // quiet
      this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler RotationSpeed ->`, value + ' (quiet)');
      this.quietMode = commands.quietMode.value.on;
      break;
    case 2: // auto
      this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler RotationSpeed ->`, value +
          ' (' + this.getKeyName(commands.speed.value, commands.speed.value.auto) + ')');
      this.speed = commands.speed.value.auto;
      break;
    case 3: // low
      this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler RotationSpeed ->`, value +
          ' (' + this.getKeyName(commands.speed.value, commands.speed.value.low) + ')');
      this.speed = commands.speed.value.low;
      break;
    case 4: // mediumLow / medium
      this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler RotationSpeed ->`, value + ' (' +
          this.getKeyName(commands.speed.value,
            (maxSpeed === 8) ? commands.speed.value.mediumLow : commands.speed.value.medium) + ')');
      this.speed = (maxSpeed === 8) ? commands.speed.value.mediumLow : commands.speed.value.medium;
      break;
    case 5: // medium / high
      this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler RotationSpeed ->`, value + ' (' +
          this.getKeyName(commands.speed.value,
            (maxSpeed === 8) ? commands.speed.value.medium : commands.speed.value.high) + ')');
      this.speed = (maxSpeed === 8) ? commands.speed.value.medium : commands.speed.value.high;
      break;
    case 6: // mediumHigh / powerful
      if (maxSpeed === 8) {
        // mediumHigh
        this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler RotationSpeed ->`, value +
            ' (' + this.getKeyName(commands.speed.value, commands.speed.value.mediumHigh) + ')');
        this.speed = commands.speed.value.mediumHigh;
      } else {
        // powerful
        this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler RotationSpeed ->`, value + ' (powerful)');
        this.powerfulMode = commands.powerfulMode.value.on;
      }
      break;
    case 7: // high
      this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler RotationSpeed ->`, value +
          ' (' + this.getKeyName(commands.speed.value, commands.speed.value.high) + ')');
      this.speed = commands.speed.value.high;
      break;
    case 8: // powerful
      this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler RotationSpeed ->`, value + ' (powerful)');
      this.powerfulMode = commands.powerfulMode.value.on;
      break;
    default: // auto
      this.platform.log.debug(`[${this.getDeviceLabel()}] Set Heater-Cooler RotationSpeed ->`, value +
          ' (' + this.getKeyName(commands.speed.value, commands.speed.value.auto) + ')');
      this.speed = commands.speed.value.auto;
      break;
    }
    this.accessory.context.HeaterCoolerRotationSpeed = value;
    this.platform.api.updatePlatformAccessories([this.accessory]);
  }

  async setFanRotationSpeed(value: CharacteristicValue) {
    if (value !== 0 &&
      this.Fan?.getCharacteristic(this.platform.Characteristic.Active).value !== this.platform.Characteristic.Active.ACTIVE) {
      this.Fan?.getCharacteristic(this.platform.Characteristic.Active).setValue(this.platform.Characteristic.Active.ACTIVE);
    }
    let logMsg = `[${this.getDeviceLabel()}] Set Fan RotationSpeed -> ${Math.round(value as number)}%`;
    switch(Math.round(value as number)) {
    case 0: // inactive -> rotation speed change not needed
      return;
    case 17: // low - 5 step model
    case 25: // low - 3 step model
      logMsg += ` (${this.getKeyName(commands.speed.value, commands.speed.value.low)})`;
      this.speed = commands.speed.value.low;
      break;
    case 33: // mediumLow
      logMsg += ` (${this.getKeyName(commands.speed.value, commands.speed.value.mediumLow)})`;
      this.speed = commands.speed.value.mediumLow;
      break;
    case 50: // medium
      logMsg += ` (${this.getKeyName(commands.speed.value, commands.speed.value.medium)}) - ${Math.round(value as number)}%`;
      this.speed = commands.speed.value.medium;
      break;
    case 67: // mediumHigh
      logMsg += ` (${this.getKeyName(commands.speed.value, commands.speed.value.mediumHigh)}) - ${Math.round(value as number)}%`;
      this.speed = commands.speed.value.mediumHigh;
      break;
    case 75: // high - 3 step model
    case 83: // high - 5 step model
      logMsg += ` (${this.getKeyName(commands.speed.value, commands.speed.value.high)}) - ${Math.round(value as number)}%`;
      this.speed = commands.speed.value.high;
      break;
    default: // auto
      logMsg += ` (${this.getKeyName(commands.speed.value, commands.speed.value.auto)}) - ${Math.round(value as number)}%`;
      this.speed = commands.speed.value.auto;
      break;
    }
    this.platform.log.debug(logMsg);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possible. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.
   * In this case, you may decide not to implement `onGet` handlers, which may speed up
   * the responsiveness of your device in the Home app.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getActive(): Promise<CharacteristicValue> {
    const currentPower = this.power && [commands.mode.value.cool, commands.mode.value.heat, commands.mode.value.auto].includes(this.mode);
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get Heater-Cooler Active ->`, currentPower ? 'ACTIVE' : 'INACTIVE');
    return currentPower ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
  }

  async getFanActive(): Promise<CharacteristicValue> {
    const currentPower = this.power && this.mode === commands.mode.value.fan;
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get Fan Active ->`, currentPower ? 'ACTIVE' : 'INACTIVE');
    return currentPower ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
  }

  async getCurrentHeaterCoolerState(): Promise<CharacteristicValue> {
    if (this.power) {
      switch (this.mode) {
      case commands.mode.value.cool:
        this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState -> COOLING`);
        return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
      case commands.mode.value.heat:
        this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState -> HEATING`);
        return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
      case commands.mode.value.auto:
        if (this.currentTemperature > (this.status[commands.targetTemperature.code] as number)) {
          this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState -> COOLING`);
          return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
        }
        if (this.currentTemperature < (this.status[commands.targetTemperature.code] as number)) {
          this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState -> HEATING`);
          return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
        }
        this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState -> IDLE`);
        return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
      }
    }
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentHeaterCoolerState -> INACTIVE`);
    return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
  }

  async getCurrentFanState(): Promise<CharacteristicValue> {
    if (this.power && this.mode === commands.mode.value.fan) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentFanState -> BLOWING_AIR`);
      return this.platform.Characteristic.CurrentFanState.BLOWING_AIR;
    }
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentFanState -> INACTIVE`);
    return this.platform.Characteristic.CurrentFanState.INACTIVE;
  }

  async getTargetHeaterCoolerState(): Promise<CharacteristicValue> {
    switch (this.mode) {
    case commands.mode.value.cool:
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get TargetHeaterCoolerState -> COOL`);
      return this.platform.Characteristic.TargetHeaterCoolerState.COOL;
    case commands.mode.value.heat:
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get TargetHeaterCoolerState -> HEAT`);
      return this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
    case commands.mode.value.auto:
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get TargetHeaterCoolerState -> AUTO`);
      return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    }
    // not in heating-cooling mode (e.g. fan mode)
    switch (this.accessory.context.TargetHeaterCoolerState) {
    case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get TargetHeaterCoolerState -> COOL`);
      break;
    case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get TargetHeaterCoolerState -> HEAT`);
      break;
    case this.platform.Characteristic.TargetHeaterCoolerState.AUTO:
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get TargetHeaterCoolerState -> AUTO`);
      break;
    }
    return this.accessory.context.TargetHeaterCoolerState;
  }

  async getCurrentTemperature(service: string): Promise<CharacteristicValue> {
    const currentValue = this.currentTemperature;
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get ${service} CurrentTemperature ->`, currentValue);
    return currentValue;
  }

  async getTargetTemperature(target: string): Promise<CharacteristicValue> {
    const currentValue = this.targetTemperature;
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get ${target} ->`, currentValue);
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
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get SwingMode -> DISABLED`);
      return this.platform.Characteristic.SwingMode.SWING_DISABLED;
    }
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get SwingMode -> ENABLED`);
    return this.platform.Characteristic.SwingMode.SWING_ENABLED;
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {
    const maxSpeed = this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.maxValue ||
        this.deviceConfig.speedSteps + 3;
    if (this.quietMode === commands.quietMode.value.on) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get Heater-Cooler RotationSpeed -> 1 (quiet)`);
      return 1;
    }
    if (this.powerfulMode === commands.powerfulMode.value.on) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] Get Heater-Cooler RotationSpeed -> ${maxSpeed} (powerful)`);
      return maxSpeed;
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
        (maxSpeed === 8) ? commands.speed.value.mediumLow : commands.speed.value.medium);
      break;
    case commands.speed.value.medium:
      value = (maxSpeed === 8) ? 5 : 4;
      logValue = this.getKeyName(commands.speed.value, commands.speed.value.medium);
      break;
    case commands.speed.value.mediumHigh:
      value = (maxSpeed === 8) ? 6 : 4;
      logValue = this.getKeyName(commands.speed.value,
        (maxSpeed === 8) ? commands.speed.value.mediumHigh : commands.speed.value.medium);
      break;
    case commands.speed.value.high:
      value = (maxSpeed === 8) ? 7 : 5;
      logValue = this.getKeyName(commands.speed.value, commands.speed.value.high);
      break;
    }
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get Heater-Cooler RotationSpeed ->`, value + ' (' + logValue + ')');
    return value;
  }

  async getFanRotationSpeed(): Promise<CharacteristicValue> {
    const minStep = this.Fan?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.minStep ||
        100 / (this.deviceConfig.speedSteps + 1);
    let value = 100; // default to auto
    let logValueName = this.getKeyName(commands.speed.value, commands.speed.value.auto);
    switch (this.speed) {
    case commands.speed.value.low:
      value = minStep;
      logValueName = this.getKeyName(commands.speed.value, commands.speed.value.low);
      break;
    case commands.speed.value.mediumLow:
      value = 2 * minStep;
      logValueName = this.getKeyName(commands.speed.value,
        (minStep !== 25) ? commands.speed.value.mediumLow : commands.speed.value.medium);
      break;
    case commands.speed.value.medium:
      value = (minStep !== 25 ? 3 : 2) * minStep;
      logValueName = this.getKeyName(commands.speed.value, commands.speed.value.medium);
      break;
    case commands.speed.value.mediumHigh:
      value = (minStep !== 25 ? 4 : 2) * minStep;
      logValueName = this.getKeyName(commands.speed.value,
        (minStep !== 25) ? commands.speed.value.mediumHigh : commands.speed.value.medium);
      break;
    case commands.speed.value.high:
      value = (minStep !== 25 ? 5 : 3) * minStep;
      logValueName = this.getKeyName(commands.speed.value, commands.speed.value.high);
      break;
    }
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get Fan RotationSpeed -> ${Math.round(value as number)}% (${logValueName})`);
    return value;
  }

  async getName(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get Name ->`, this.accessory.displayName);
    return this.accessory.displayName;
  }

  // helper functions

  isSilentTime(): boolean {
    const currentTime: Date = new Date();
    const currentTimeNum: number = currentTime.getHours() * 100 + currentTime.getMinutes();
    return (this.silentTimeRanges !== undefined &&
      this.silentTimeRanges.find((element) => element[0] <= currentTimeNum && currentTimeNum < element[1]) !== undefined);
  }

  getDeviceLabel() {
    return `${this.accessory.displayName} -- ${this.accessory.context.device.address}`;
  }

  getCols() {
    if (!this.cols) {
      this.cols = (Object.keys(commands) as Array<keyof Commands>).map((k) => commands[k].code);
    }
    return this.cols;
  }

  getKeyName(obj: CommandValueMap, value: number): string {
    let name = '';
    if (obj !== undefined) {
      Object.entries(obj).find(([key, val]) => {
        if (val === value) {
          name = key;
          return true;
        }
        return false;
      });
    }
    return name;
  }

  getValueName(obj: Commands, code: string, value: number): string | undefined {
    let name;
    if (obj !== undefined) {
      const command = Object.values(obj).find(c => c.code === code);
      if (command && command.value !== undefined) {
        Object.entries(command.value).find(([key, val]) => {
          if (val === value) {
            name = key;
            return true;
          }
          return false;
        });
      }
    }
    return name;
  }

  getCommandName(obj: Commands, code: string): string | undefined {
    let name;
    if (obj !== undefined) {
      Object.entries(obj).find(([key, val]) => {
        if (val && val.code === code) {
          name = key;
          return true;
        }
        return false;
      });
    }
    return name;
  }

  calcDeviceTargetTemp(temp: number, unit?: number): number {
    if (unit === commands.units.value.celsius ||
      (unit === undefined && this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits).value ===
      this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS)
    ) {
      return Math.floor(temp);
    }
    if (temp >= 15.25 && temp < 15.75) {
      // execption
      return 15;
    }
    const baseTemp = Math.round(temp);
    const baseFahrenheit = temp * 9 / 5 + 32;
    const baseFahrenheitDecimalPart = baseFahrenheit - Math.floor(baseFahrenheit);
    const correction = (baseFahrenheitDecimalPart >= 0.05 && baseFahrenheitDecimalPart < 0.15) ||
      (baseFahrenheitDecimalPart >= 0.25 && baseFahrenheitDecimalPart < 0.35) ? 1 : 0;
    return baseTemp - correction;
  }

  calcDeviceTargetOffset(temp: number, unit?: number): number {
    if (unit === commands.units.value.celsius ||
      (unit === undefined && this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits).value ===
      this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS)
    ) {
      return 0;
    }
    if (temp === 16) {
      // exception
      return 0;
    }
    const baseFahrenheit = temp * 9 / 5 + 32;
    const baseFahrenheitDecimalPart = baseFahrenheit - Math.floor(baseFahrenheit);
    const offset = (((baseFahrenheitDecimalPart >= 0.05 && baseFahrenheitDecimalPart < 0.15) ||
    (baseFahrenheitDecimalPart >= 0.25 && baseFahrenheitDecimalPart < 0.35) ||
    (baseFahrenheitDecimalPart >= 0.55 && baseFahrenheitDecimalPart < 0.65) ||
    (baseFahrenheitDecimalPart >= 0.75 && baseFahrenheitDecimalPart < 0.85)) ? 1 : 0);
    return temp >= 15.25 && temp < 16.25 ? 1 - offset : offset;
  }

  getTargetTempFromDevice(temp: number, offset: number, unit: number): number {
    let targetValue: number;
    const heatingTargetValue: number =
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).value as number | undefined || 25;
    const coolingTargetValue: number =
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).value as number | undefined || 25;
    switch (this.mode) {
    case commands.mode.value.heat:
      targetValue = heatingTargetValue;
      break;
    case commands.mode.value.cool:
      targetValue = coolingTargetValue;
      break;
    default:
      targetValue = (coolingTargetValue + heatingTargetValue) / 2;
      break;
    }
    if (unit === commands.units.value.celsius) {
      if (Math.floor(targetValue) === +temp && targetValue !== +temp) {
        this.platform.log.debug(`[${this.getDeviceLabel()}] TargetTemperature FIX: %f -> %f`, +temp, targetValue);
        return targetValue;
      }
      return +temp;
    }
    const key = temp.toString() + ',' + offset.toString();
    const value = TEMPERATURE_TABLE[key];
    if (value === undefined) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] TargetTemperature FIX: invalid -> %f`, +temp);
      return +temp; // invalid temperature-offset pair received from device -> return temperature value
    }
    // some temperature values are the same on the physical AC unit -> fix this issue:
    if ((targetValue === 12.5 && value === 13) || (targetValue === 17.5 && value === 18) ||
      (targetValue === 22.5 && value === 23) || (targetValue === 27.5 && value === 28)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] TargetTemperature FIX: %f -> %f`, value, targetValue);
      return targetValue;
    }
    // no fix needed, return original value
    return value;
  }

  // device functions

  get power(): boolean {
    return (this.status[commands.power.code] === commands.power.value.on);
  }

  set power(value: boolean) {
    if ((value === this.power && [commands.mode.value.cool, commands.mode.value.heat, commands.mode.value.auto].includes(this.mode)) ||
      this.powerPending !== -1 || this.modePending !== -1) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] power -> no change (${this.power}, ${this.powerPending}, ${this.mode},`,
        `${this.modePending})`);
      return;
    }
    if (!value && ![commands.mode.value.cool, commands.mode.value.heat, commands.mode.value.auto].includes(this.mode)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] power -> set inactive but no power off (${this.mode})`);
      return;
    }
    const powerValue = value ? commands.power.value.on : commands.power.value.off;
    const command: Record<string, unknown> = {};
    let logValue = '';
    if (value !== this.power) {
      command[commands.power.code] = powerValue;
      logValue += (logValue ? ', ' : '') + 'power -> ' + this.getKeyName(commands.power.value, powerValue);
    }
    if (powerValue === commands.power.value.on) {
      switch (this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value ||
        this.accessory.context.TargetHeaterCoolerState) {
      case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
        if (this.mode !== commands.mode.value.cool) {
          command[commands.mode.code] = commands.mode.value.cool;
          logValue += (logValue ? ', ' : '') + 'mode -> ' + this.getKeyName(commands.mode.value, commands.mode.value.cool);
          if (this.deviceConfig.xFanEnabled && (this.status[commands.xFan.code] || commands.xFan.value.off) !== commands.xFan.value.on) {
            // turn on xFan in Cool mode if xFan is enabled for this device
            logValue += (logValue ? ', ' : '') + 'xFan -> ' + this.getKeyName(commands.xFan.value, commands.xFan.value.on);
            command[commands.xFan.code] = commands.xFan.value.on;
          }
        }
        break;
      case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
        if (this.mode !== commands.mode.value.heat) {
          command[commands.mode.code] = commands.mode.value.heat;
          logValue += (logValue ? ', ' : '') + 'mode -> ' + this.getKeyName(commands.mode.value, commands.mode.value.heat);
          if (this.deviceConfig.xFanEnabled && (this.status[commands.xFan.code] || commands.xFan.value.on) !== commands.xFan.value.off) {
            // turn off xFan in unsupported modes (only Cool and Dry modes support xFan)
            logValue += (logValue ? ', ' : '') + 'xFan -> ' + this.getKeyName(commands.xFan.value, commands.xFan.value.off);
            command[commands.xFan.code] = commands.xFan.value.off;
          }
        }
        break;
      case this.platform.Characteristic.TargetHeaterCoolerState.AUTO:
        if (this.mode !== commands.mode.value.auto) {
          command[commands.mode.code] = commands.mode.value.auto;
          logValue += (logValue ? ', ' : '') + 'mode -> ' + this.getKeyName(commands.mode.value, commands.mode.value.auto);
          if (this.deviceConfig.xFanEnabled && (this.status[commands.xFan.code] || commands.xFan.value.on) !== commands.xFan.value.off) {
            // turn off xFan in unsupported modes (only Cool and Dry modes support xFan)
            logValue += (logValue ? ', ' : '') + 'xFan -> ' + this.getKeyName(commands.xFan.value, commands.xFan.value.off);
            command[commands.xFan.code] = commands.xFan.value.off;
          }
        }
        break;
      }
    }
    if (logValue) {
      if (powerValue === commands.power.value.on) {
        if (this.accessory.context.HeaterCoolerRotationSpeed !== 0) {
          // restore rotation speed on power on
          const maxSpeed = this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.maxValue ||
            this.deviceConfig.speedSteps + 3;
          switch (this.accessory.context.HeaterCoolerRotationSpeed) {
          case 1: // quiet
            if ([this.platform.Characteristic.TargetHeaterCoolerState.COOL, this.platform.Characteristic.TargetHeaterCoolerState.HEAT]
              .includes(this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value ||
                this.accessory.context.TargetHeaterCoolerState)) {
              command[commands.quietMode.code] = commands.quietMode.value.on;
              logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
                  this.getKeyName(commands.quietMode.value, commands.quietMode.value.on);
            } else {
              command[commands.quietMode.code] = commands.quietMode.value.off;
              logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
                  this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
            }
            command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
            logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
            command[commands.speed.code] = commands.speed.value.low;
            logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.low);
            break;
          case 2: // auto
            if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
              command[commands.quietMode.code] = commands.quietMode.value.off;
              logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
                  this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
              command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
              logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                  this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
            }
            command[commands.speed.code] = commands.speed.value.auto;
            logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.auto);
            break;
          case 3: // low
            if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
              command[commands.quietMode.code] = commands.quietMode.value.off;
              logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
                  this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
              command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
              logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                  this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
            }
            command[commands.speed.code] = commands.speed.value.low;
            logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.low);
            break;
          case 4: // mediumLow / medium
            if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
              command[commands.quietMode.code] = commands.quietMode.value.off;
              logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
                  this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
              command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
              logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                  this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
            }
            command[commands.speed.code] = maxSpeed === 8 ? commands.speed.value.mediumLow : commands.speed.value.medium;
            logValue += (logValue ? ', ' : '') + 'speed -> ' +
              this.getKeyName(commands.speed.value, (command[commands.speed.code] as number));
            break;
          case 5: // medium / high
            if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
              command[commands.quietMode.code] = commands.quietMode.value.off;
              logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
                  this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
              command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
              logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                  this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
            }
            command[commands.speed.code] = maxSpeed === 8 ? commands.speed.value.medium : commands.speed.value.high;
            logValue += (logValue ? ', ' : '') + 'speed -> ' +
              this.getKeyName(commands.speed.value, (command[commands.speed.code] as number));
            break;
          case 6: // mediumHigh / powerful
            if (maxSpeed === 8) {
              if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
                command[commands.quietMode.code] = commands.quietMode.value.off;
                logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
                    this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
                command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
                logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                    this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
              }
              command[commands.speed.code] = commands.speed.value.mediumHigh;
              logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.mediumHigh);
            } else {
              command[commands.quietMode.code] = commands.quietMode.value.off;
              logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
                  this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
              if ([this.platform.Characteristic.TargetHeaterCoolerState.COOL, this.platform.Characteristic.TargetHeaterCoolerState.HEAT]
                .includes(this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value ||
                  this.accessory.context.TargetHeaterCoolerState)) {
                command[commands.powerfulMode.code] = commands.powerfulMode.value.on;
                logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                    this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.on);
              } else {
                command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
                logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                    this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
              }
              command[commands.speed.code] = commands.speed.value.high;
              logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.high);
            }
            break;
          case 7: // high
            if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
              command[commands.quietMode.code] = commands.quietMode.value.off;
              logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
                  this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
              command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
              logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                  this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
            }
            command[commands.speed.code] = commands.speed.value.high;
            logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.high);
            break;
          case 8: // powerful
            command[commands.quietMode.code] = commands.quietMode.value.off;
            logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
                this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
            if ([this.platform.Characteristic.TargetHeaterCoolerState.COOL, this.platform.Characteristic.TargetHeaterCoolerState.HEAT]
              .includes(this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value ||
                this.accessory.context.TargetHeaterCoolerState)) {
              command[commands.powerfulMode.code] = commands.powerfulMode.value.on;
              logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                  this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.on);
            } else {
              command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
              logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                  this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
            }
            command[commands.speed.code] = commands.speed.value.high;
            logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.high);
            break;
          }
        }
        if (([MODIFY_VERTICAL_SWING_POSITION.overrideDefPowerOnOscDisable, MODIFY_VERTICAL_SWING_POSITION.overrideDefPowerOn].includes(
          this.deviceConfig.modifyVerticalSwingPosition || DEFAULT_DEVICE_CONFIG.modifyVerticalSwingPosition) &&
          this.swingMode === commands.swingVertical.value.default) || ([MODIFY_VERTICAL_SWING_POSITION.setPowerOnOscDisable,
          MODIFY_VERTICAL_SWING_POSITION.setPowerOn].includes(this.deviceConfig.modifyVerticalSwingPosition ||
          DEFAULT_DEVICE_CONFIG.modifyVerticalSwingPosition))) {
          const value = this.deviceConfig.defaultVerticalSwing || DEFAULT_DEVICE_CONFIG.defaultVerticalSwing;
          command[commands.swingVertical.code] = value;
          logValue += (logValue ? ', ' : '') + 'swingVertical -> ' + this.getKeyName(commands.swingVertical.value, value);
        }
      }
      this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
      this.sendCommand(command);
    }
  }

  set fanpower(value: boolean) {
    if (this.powerPending !== -1 || this.modePending !== -1) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] fanpower -> no change (${this.powerPending}, ${this.modePending})`);
      return;
    }
    if (!value && this.mode !== commands.mode.value.fan) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] fanpower -> set inactive but no power off (${this.mode})`);
      return;
    }
    const powerValue = value ? commands.power.value.on : commands.power.value.off;
    const command: Record<string, unknown> = {};
    let logValue = '';
    if (value !== this.power) {
      command[commands.power.code] = powerValue;
      logValue += (logValue ? ', ' : '') + 'power -> ' + this.getKeyName(commands.power.value, powerValue);
    }
    if (powerValue === commands.power.value.on && this.mode !== commands.mode.value.fan) {
      command[commands.mode.code] = commands.mode.value.fan;
      logValue += (logValue ? ', ' : '') + 'mode -> ' + this.getKeyName(commands.mode.value, commands.mode.value.fan);
    }
    if (logValue) {
      if (powerValue === commands.power.value.on) {
        command[commands.quietMode.code] = commands.quietMode.value.off;
        logValue += (logValue ? ', ' : '') + 'quietMode -> ' + this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
        command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
        logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
        this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
        if ([MODIFY_VERTICAL_SWING_POSITION.overrideDefPowerOnOscDisable, MODIFY_VERTICAL_SWING_POSITION.overrideDefPowerOn].includes(
          this.deviceConfig.modifyVerticalSwingPosition || DEFAULT_DEVICE_CONFIG.modifyVerticalSwingPosition) &&
          this.swingMode === commands.swingVertical.value.default) {
          const value = this.deviceConfig.defaultVerticalSwing || DEFAULT_DEVICE_CONFIG.defaultVerticalSwing;
          command[commands.swingVertical.code] = value;
          logValue += (logValue ? ', ' : '') + 'swingVertical -> ' + this.getKeyName(commands.swingVertical.value, value);
        } else if ([MODIFY_VERTICAL_SWING_POSITION.setPowerOnOscDisable, MODIFY_VERTICAL_SWING_POSITION.setPowerOn].includes(
          this.deviceConfig.modifyVerticalSwingPosition || DEFAULT_DEVICE_CONFIG.modifyVerticalSwingPosition)) {
          const value = this.deviceConfig.defaultFanVerticalSwing || DEFAULT_DEVICE_CONFIG.defaultFanVerticalSwing;
          command[commands.swingVertical.code] = value;
          logValue += (logValue ? ', ' : '') + 'swingVertical -> ' + this.getKeyName(commands.swingVertical.value, value);
        }
      }
      this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
      this.sendCommand(command);
    }
  }

  get mode(): number {
    return (this.status[commands.mode.code] as number) || commands.mode.value.auto;
  }

  set mode(value: number) {
    if (value === this.mode || this.modePending !== -1) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] mode -> no change (${value}, ${this.modePending})`);
      return;
    }
    let logValue = 'mode -> ' + this.getKeyName(commands.mode.value, value);
    const command: Record<string, unknown> = { [commands.mode.code]: value };
    if (this.deviceConfig.xFanEnabled && (this.status[commands.xFan.code] || commands.xFan.value.off) !== commands.xFan.value.on &&
      [commands.mode.value.cool, commands.mode.value.dry].includes(value)) {
      // turn on xFan in Cool and Dry mode if xFan is enabled for this device
      logValue += ', xFan -> ' + this.getKeyName(commands.xFan.value, commands.xFan.value.on);
      command[commands.xFan.code] = commands.xFan.value.on;
    } else if (this.deviceConfig.xFanEnabled && (this.status[commands.xFan.code] || commands.xFan.value.on) !== commands.xFan.value.off &&
      ![commands.mode.value.cool, commands.mode.value.dry].includes(value)) {
      // turn off xFan in unsupported modes (only Cool and Dry modes support xFan)
      logValue += ', xFan -> ' + this.getKeyName(commands.xFan.value, commands.xFan.value.off);
      command[commands.xFan.code] = commands.xFan.value.off;
    }
    if (this.accessory.context.HeaterCoolerRotationSpeed !== 0 &&
      [commands.mode.value.cool, commands.mode.value.heat, commands.mode.value.auto].includes(value)) {
      // restore rotation speed on mode change
      const maxSpeed = this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.maxValue ||
        this.deviceConfig.speedSteps + 3;
      switch (this.accessory.context.HeaterCoolerRotationSpeed) {
      case 1: // quiet
        command[commands.quietMode.code] = value === commands.mode.value.auto ? commands.quietMode.value.off :
          commands.quietMode.value.on;
        logValue += (logValue ? ', ' : '') + 'quietMode -> ' + this.getKeyName(commands.quietMode.value,
          value === commands.mode.value.auto ? commands.quietMode.value.off : commands.quietMode.value.on);
        command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
        logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
            this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
        command[commands.speed.code] = commands.speed.value.low;
        logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.low);
        break;
      case 2: // auto
        if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
          command[commands.quietMode.code] = commands.quietMode.value.off;
          logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
              this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
          command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
          logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
              this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
        }
        command[commands.speed.code] = commands.speed.value.auto;
        logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.auto);
        break;
      case 3: // low
        if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
          command[commands.quietMode.code] = commands.quietMode.value.off;
          logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
              this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
          command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
          logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
              this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
        }
        command[commands.speed.code] = commands.speed.value.low;
        logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.low);
        break;
      case 4: // mediumLow / medium
        if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
          command[commands.quietMode.code] = commands.quietMode.value.off;
          logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
              this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
          command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
          logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
              this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
        }
        command[commands.speed.code] = maxSpeed === 8 ? commands.speed.value.mediumLow : commands.speed.value.medium;
        logValue += (logValue ? ', ' : '') + 'speed -> ' +
          this.getKeyName(commands.speed.value, (command[commands.speed.code] as number));
        break;
      case 5: // medium / high
        if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
          command[commands.quietMode.code] = commands.quietMode.value.off;
          logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
              this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
          command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
          logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
              this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
        }
        command[commands.speed.code] = maxSpeed === 8 ? commands.speed.value.medium : commands.speed.value.high;
        logValue += (logValue ? ', ' : '') + 'speed -> ' +
          this.getKeyName(commands.speed.value, (command[commands.speed.code] as number));
        break;
      case 6: // mediumHigh / powerful
        if (maxSpeed === 8) {
          if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
            command[commands.quietMode.code] = commands.quietMode.value.off;
            logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
                this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
            command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
            logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
                this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
          }
          command[commands.speed.code] = commands.speed.value.mediumHigh;
          logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.mediumHigh);
        } else {
          command[commands.quietMode.code] = commands.quietMode.value.off;
          logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
              this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
          command[commands.powerfulMode.code] = value === commands.mode.value.auto ? commands.powerfulMode.value.off :
            commands.powerfulMode.value.on;
          logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
              this.getKeyName(commands.powerfulMode.value, value === commands.mode.value.auto ? commands.powerfulMode.value.off :
                commands.powerfulMode.value.on);
          command[commands.speed.code] = commands.speed.value.high;
          logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.high);
        }
        break;
      case 7: // high
        if (this.quietMode !== commands.quietMode.value.off || this.powerfulMode !== commands.powerfulMode.value.off) {
          command[commands.quietMode.code] = commands.quietMode.value.off;
          logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
              this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
          command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
          logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
              this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
        }
        command[commands.speed.code] = commands.speed.value.high;
        logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.high);
        break;
      case 8: // powerful
        if ([commands.mode.value.cool, commands.mode.value.heat].includes(value)) {
          command[commands.quietMode.code] = commands.quietMode.value.off;
          logValue += (logValue ? ', ' : '') + 'quietMode -> ' +
              this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
          command[commands.powerfulMode.code] = value === commands.mode.value.auto ? commands.powerfulMode.value.off :
            commands.powerfulMode.value.on;
          logValue += (logValue ? ', ' : '') + 'powerfulMode -> ' +
              this.getKeyName(commands.powerfulMode.value, value === commands.mode.value.auto ? commands.powerfulMode.value.off :
                commands.powerfulMode.value.on,
              );
        }
        command[commands.speed.code] = commands.speed.value.high;
        logValue += (logValue ? ', ' : '') + 'speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.high);
        break;
      }
    }
    this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
    this.sendCommand(command);
  }

  get currentTemperature(): number {
    return (this.status[commands.temperature.code] as number) - (this.deviceConfig.sensorOffset) || 25;
  }

  get targetTemperature(): number {
    let minValue = this.deviceConfig.minimumTargetTemperature;
    let maxValue = this.deviceConfig.maximumTargetTemperature;
    switch (this.mode) {
    case commands.mode.value.cool:
      minValue = Math.max(this.deviceConfig.minimumTargetTemperature,
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).props.minValue || 10);
      maxValue = Math.min(this.deviceConfig.maximumTargetTemperature,
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).props.maxValue || 35);
      break;
    case commands.mode.value.heat:
      minValue = Math.max(this.deviceConfig.minimumTargetTemperature,
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).props.minValue || 0);
      maxValue = Math.min(this.deviceConfig.maximumTargetTemperature,
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).props.maxValue || 25);
      break;
    case commands.mode.value.auto:
      minValue = Math.max(this.deviceConfig.minimumTargetTemperature, Math.min(
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).props.minValue || 10,
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).props.minValue || 0));
      maxValue = Math.min(this.deviceConfig.maximumTargetTemperature, Math.max(
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).props.maxValue || 35,
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).props.maxValue || 25));
    }
    return Math.max(Math.min(this.getTargetTempFromDevice((this.status[commands.targetTemperature.code] as number) || 25,
      (this.status[commands.temperatureOffset.code] as number) || 0,
      (this.status[commands.units.code] as number)), maxValue), minValue);
  }

  set targetTemperature(value: number) {
    if (value === this.targetTemperature) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] targetTemperature -> no change (${value})`);
      return;
    }
    const tempValue = this.calcDeviceTargetTemp(value);
    const command: Record<string, unknown> = { [commands.targetTemperature.code]: tempValue };
    let logValue = 'targetTemperature -> ' + tempValue.toString();
    const tempOffset = this.calcDeviceTargetOffset(value);
    command[commands.temperatureOffset.code] = tempOffset;
    logValue += ', temperatureOffset -> ' + tempOffset.toString();
    const displayUnits = this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits).value;
    const deviceDisplayUnits = (displayUnits === this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS) ?
      commands.units.value.celsius : commands.units.value.fahrenheit;
    if (deviceDisplayUnits === commands.units.value.fahrenheit) {
      logValue += ' (-> ' + Math.round(value * 9 / 5 + 32).toString() + ' °F)';
    } else {
      logValue += ' (-> ' + value.toString() + ' °C)';
    }
    if (deviceDisplayUnits !== this.units) {
      command[commands.units.code] = deviceDisplayUnits;
      logValue += ', units -> ' + this.getKeyName(commands.units.value, deviceDisplayUnits);
    }
    this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
    this.sendCommand(command);
  }

  get units(): number {
    return (this.status[commands.units.code] as number) || commands.units.value.celsius;
  }

  set units(value: number) {
    if (value === this.units) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] units -> no change (${value})`);
      return;
    }
    const command: Record<string, unknown> = { [commands.units.code]: value };
    let logValue = 'units -> ' + this.getKeyName(commands.units.value, value);
    // convert target temperature to new unit
    const actTemp = this.getTargetTempFromDevice((this.status[commands.targetTemperature.code] as number),
      (this.status[commands.temperatureOffset.code] as number), this.units);
    const tempValue = this.calcDeviceTargetTemp(actTemp, value);
    if (tempValue !== this.status[commands.targetTemperature.code]) {
      command[commands.targetTemperature.code] = tempValue;
      logValue += ', targetTemperature -> ' + tempValue.toString();
    }
    const tempOffset = this.calcDeviceTargetOffset(actTemp, value);
    if (tempOffset !== this.status[commands.temperatureOffset.code]) {
      command[commands.temperatureOffset.code] = tempOffset;
      logValue += ', temperatureOffset -> ' + tempOffset.toString();
    }
    this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
    this.sendCommand(command);
  }

  get swingMode(): number {
    return (this.status[commands.swingVertical.code] as number) || commands.swingVertical.value.default;
  }

  set swingMode(value: number) {
    if (value === this.swingMode) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] swingMode -> no change (${value})`);
      return;
    }
    const command: Record<string, unknown> = { [commands.swingVertical.code]: value };
    this.platform.log.info(`[${this.getDeviceLabel()}] swingVertical ->`, this.getKeyName(commands.swingVertical.value, value));
    this.sendCommand(command);
  }

  get speed(): number {
    return (this.status[commands.speed.code] as number) || commands.speed.value.auto;
  }

  set speed(value: number) {
    if (value === this.speed && this.quietMode === commands.quietMode.value.off && this.powerfulMode === commands.powerfulMode.value.off) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] speed -> no change (${value}, ${this.quietMode}, ${this.powerfulMode})`);
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

  get quietMode(): number {
    return (this.status[commands.quietMode.code] as number) || commands.quietMode.value.off;
  }

  set quietMode(value: number) {
    if (value === this.quietMode || value !== commands.quietMode.value.on) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] quietMode -> not turning on (${value})`);
      return;
    }
    let logValue = '';
    const command: Record<string, unknown> = {};
    if ([this.platform.Characteristic.TargetHeaterCoolerState.COOL, this.platform.Characteristic.TargetHeaterCoolerState.HEAT]
      .includes(this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value ||
      this.accessory.context.TargetHeaterCoolerState)) {
      command[commands.quietMode.code] = value;
      logValue += 'quietMode -> ' + this.getKeyName(commands.quietMode.value, value);
    } else {
      // quiet mode is supported only in heating and cooling mode
      command[commands.quietMode.code] = commands.quietMode.value.off;
      logValue += 'quietMode -> ' + this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
    }
    if (value === commands.quietMode.value.on) {
      command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
      logValue += ', powerfulMode -> ' + this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
      command[commands.speed.code] = commands.speed.value.low;
      logValue += ', speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.low);
      this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
      this.sendCommand(command);
    }
  }

  get powerfulMode(): number {
    return (this.status[commands.powerfulMode.code] as number) || commands.powerfulMode.value.off;
  }

  set powerfulMode(value: number) {
    if (value === this.powerfulMode || value !== commands.powerfulMode.value.on) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] powerfulMode -> not turning on (${value})`);
      return;
    }
    let logValue = '';
    const command: Record<string, unknown> = {};
    if ([this.platform.Characteristic.TargetHeaterCoolerState.COOL, this.platform.Characteristic.TargetHeaterCoolerState.HEAT]
      .includes(this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value ||
      this.accessory.context.TargetHeaterCoolerState)) {
      command[commands.powerfulMode.code] = value;
      logValue += 'powerfulMode -> ' + this.getKeyName(commands.powerfulMode.value, value);
    } else {
      // powerful mode is supported only in heating and cooling mode
      command[commands.powerfulMode.code] = commands.powerfulMode.value.off;
      logValue += 'powerfulMode -> ' + this.getKeyName(commands.powerfulMode.value, commands.powerfulMode.value.off);
    }
    if (value === commands.powerfulMode.value.on) {
      command[commands.quietMode.code] = commands.quietMode.value.off;
      logValue += ', quietMode -> ' + this.getKeyName(commands.quietMode.value, commands.quietMode.value.off);
      command[commands.speed.code] = commands.speed.value.high;
      logValue += ', speed -> ' + this.getKeyName(commands.speed.value, commands.speed.value.high);
      this.platform.log.info(`[${this.getDeviceLabel()}]`, logValue);
      this.sendCommand(command);
    }
  }

  updateStatus(props: string[]) {
    this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus -> %j`, props);
    const hcActive = this.power && [commands.mode.value.cool, commands.mode.value.heat, commands.mode.value.auto].includes(this.mode);
    const fanActive = this.power && this.mode === commands.mode.value.fan;
    // Heater-Cooler Active
    if (props.includes(commands.power.code) || props.includes(commands.mode.code)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Heater-Cooler Active) ->`, hcActive ? 'ACTIVE' : 'INACTIVE');
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.Active)
        .updateValue(hcActive ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);
    }
    // Fan Active
    if (this.Fan && (props.includes(commands.power.code) || props.includes(commands.mode.code))) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Fan Active) ->`, fanActive ? 'ACTIVE' : 'INACTIVE');
      this.Fan?.getCharacteristic(this.platform.Characteristic.Active)
        .updateValue(fanActive ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);
    }
    // Current Heater-Cooler State
    if (props.includes(commands.mode.code)) {
      if (this.power) {
        switch (this.mode) {
        case commands.mode.value.cool:
          this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> COOLING`);
          this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.COOLING);
          break;
        case commands.mode.value.heat:
          this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> HEATING`);
          this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
          break;
        case commands.mode.value.auto:
          if (this.currentTemperature > this.targetTemperature + 1.5) {
            this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> COOLING`);
            this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
              .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.COOLING);
          } else if (this.currentTemperature < this.targetTemperature - 1.5) {
            this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> HEATING`);
            this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
              .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
          } else {
            this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> IDLE`);
            this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
              .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
          }
          break;
        }
      } else {
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Heater-Cooler State) -> INACTIVE`);
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
          .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE);
      }
    }
    // Current Fan State
    if (this.Fan && props.includes(commands.mode.code)) {
      if (this.power && this.mode === commands.mode.value.fan) {
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Fan State) -> BLOWING_AIR`);
        this.Fan?.getCharacteristic(this.platform.Characteristic.CurrentFanState)
          .updateValue(this.platform.Characteristic.CurrentFanState.BLOWING_AIR);
      } else {
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Fan State) -> INACTIVE`);
        this.Fan?.getCharacteristic(this.platform.Characteristic.CurrentFanState)
          .updateValue(this.platform.Characteristic.CurrentFanState.INACTIVE);
      }
    }
    // Target Heater-Cooler State
    if (props.includes(commands.mode.code) && this.power &&
      [commands.mode.value.cool, commands.mode.value.heat, commands.mode.value.auto].includes(this.mode)) {
      switch (this.mode) {
      case commands.mode.value.cool:
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Target Heater-Cooler State) -> COOL`);
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
          .updateValue(this.platform.Characteristic.TargetHeaterCoolerState.COOL);
        this.accessory.context.TargetHeaterCoolerState = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
        break;
      case commands.mode.value.heat:
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Target Heater-Cooler State) -> HEAT`);
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
          .updateValue(this.platform.Characteristic.TargetHeaterCoolerState.HEAT);
        this.accessory.context.TargetHeaterCoolerState = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
        break;
      case commands.mode.value.auto:
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Target Heater-Cooler State) -> AUTO`);
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
          .updateValue(this.platform.Characteristic.TargetHeaterCoolerState.AUTO);
        this.accessory.context.TargetHeaterCoolerState = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
        break;
      }
      this.platform.api.updatePlatformAccessories([this.accessory]);
    }
    // Current Temperature
    if (props.includes(commands.temperature.code)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Temperature) ->`, this.currentTemperature);
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(this.currentTemperature);
      this.TemperatureSensor?.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(this.currentTemperature);
      this.tsAccessory?.setCurrentTemperature(this.currentTemperature);
      this.tsAccessory?.TemperatureSensor.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(this.currentTemperature);
    } else if (props.includes(commands.targetTemperature.code) && this.TemperatureSensor === undefined) {
      // temperature is not accessible -> targetTemperature is saved as currentTemperature
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Temperature) ->`, this.currentTemperature);
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(this.currentTemperature);
    }
    // Cooling Threshold Temperature
    if (props.includes(commands.targetTemperature.code) && this.power &&
      (this.mode === commands.mode.value.cool || this.mode === commands.mode.value.auto)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Cooling Threshold Temperature) ->`, this.targetTemperature);
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
        .updateValue(this.targetTemperature);
    }
    // Heating Threshold Temperature
    if (props.includes(commands.targetTemperature.code) && this.power &&
      (this.mode === commands.mode.value.heat || this.mode === commands.mode.value.auto)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Heating Threshold Temperature) ->`, this.targetTemperature);
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
        .updateValue(this.targetTemperature);
    }
    // Temperature Display Units
    if (props.includes(commands.units.code)) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Temperature Display Units) ->`,
        this.units === commands.units.value.celsius ? 'CELSIUS' : 'FAHRENHEIT');
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
        .updateValue(this.units === commands.units.value.celsius ?
          this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS : this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
    }
    // Swing Mode
    if (props.includes(commands.swingVertical.code) && this.power) {
      let swing = this.platform.Characteristic.SwingMode.SWING_ENABLED;
      let logValue = 'ENABLED';
      if ([commands.swingVertical.value.full, commands.swingVertical.value.swingHigher,
        commands.swingVertical.value.swingHighest, commands.swingVertical.value.swingLower, commands.swingVertical.value.swingLowest,
        commands.swingVertical.value.swingMiddle].includes(this.swingMode)) {
        logValue += ` (type: ${this.getKeyName(commands.swingVertical.value, this.swingMode)})`;
      }
      switch (this.swingMode){
      case commands.swingVertical.value.default:
      case commands.swingVertical.value.fixedHighest:
      case commands.swingVertical.value.fixedHigher:
      case commands.swingVertical.value.fixedMiddle:
      case commands.swingVertical.value.fixedLower:
      case commands.swingVertical.value.fixedLowest:
        swing = this.platform.Characteristic.SwingMode.SWING_DISABLED;
        logValue = `DISABLED (position: ${this.getKeyName(commands.swingVertical.value, this.swingMode)})`;
        break;
      }
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Swing Mode) ->`, logValue);
      this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.SwingMode)
        .updateValue(swing);
    }
    // Heater-Cooler Rotation Speed
    if (hcActive) {
      const maxSpeed = this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.maxValue ||
        this.deviceConfig.speedSteps + 3;
      if (props.includes(commands.quietMode.code) && this.quietMode === commands.quietMode.value.on) {
        // quietMode -> on
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Heater-Cooler Rotation Speed) -> 1 (quiet)`);
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(1);
        this.accessory.context.HeaterCoolerRotationSpeed = 1;
      } else if (props.includes(commands.powerfulMode.code) && this.powerfulMode === commands.powerfulMode.value.on) {
        // powerfulMode -> on
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Heater-Cooler Rotation Speed) ->`,
          `${maxSpeed.toString()} (powerful)`);
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(maxSpeed);
        this.accessory.context.HeaterCoolerRotationSpeed = maxSpeed;
      } else if (props.includes(commands.speed.code)) {
        let speedValue = 2; // default: auto
        switch (this.speed) {
        case commands.speed.value.low:
          speedValue = 3;
          break;
        case commands.speed.value.mediumLow:
          speedValue = 4;
          break;
        case commands.speed.value.medium:
          speedValue = (maxSpeed === 8) ? 5 : 4;
          break;
        case commands.speed.value.mediumHigh:
          speedValue = (maxSpeed === 8) ? 6 : 4;
          break;
        case commands.speed.value.high:
          speedValue = (maxSpeed === 8) ? 7 : 5;
          break;
        }
        const speedName = this.getKeyName(commands.speed.value, this.speed);
        this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Heater-Cooler Rotation Speed) ->`,
          `${speedValue.toString()} (${speedName})`);
        this.HeaterCooler?.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(speedValue);
        this.accessory.context.HeaterCoolerRotationSpeed = speedValue;
      }
      this.platform.api.updatePlatformAccessories([this.accessory]);
    }
    // Fan Rotation Speed
    if (fanActive) {
      const minStep = this.Fan?.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.minStep ||
        100 / (this.deviceConfig.speedSteps + 1);
      let fanSpeedValue = 100; // default: auto
      switch (this.speed) {
      case commands.speed.value.low:
        fanSpeedValue = minStep;
        break;
      case commands.speed.value.mediumLow:
        fanSpeedValue = 2 * minStep;
        break;
      case commands.speed.value.medium:
        fanSpeedValue = (minStep !== 25 ? 3 : 2) * minStep;
        break;
      case commands.speed.value.mediumHigh:
        fanSpeedValue = (minStep !== 25 ? 4 : 2) * minStep;
        break;
      case commands.speed.value.high:
        fanSpeedValue = (minStep !== 25 ? 5 : 3) * minStep;
        break;
      }
      const speedName = this.getKeyName(commands.speed.value, this.speed);
      this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Fan Rotation Speed) ->`,
        `${Math.round(fanSpeedValue as number)}% (${speedName})`);
      this.Fan?.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(fanSpeedValue);
    }
  }

  // device communication functions

  handleMessage = (msg: Buffer, rinfo: {address: string, family: string, port: number, size: number}) => {
    if (this.accessory.context.device.address === rinfo.address) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] handleMessage -> %s`, msg.toString());
      this.platform.log.debug(`[${this.getDeviceLabel()}] handleMessage -> Encryption version: %i`,
        this.accessory.context.device.encryptionVersion);
      const message = JSON.parse(msg.toString());
      if (!message.pack) {
        this.platform.log.debug(`[${this.getDeviceLabel()}] handleMessage - Unknown message: %j`, message);
        this.platform.log.warn(`[${this.getDeviceLabel()}] Warning: handleMessage - Unknown response from device`);
        return;
      }
      let pack;
      if (this.accessory.context.device.encryptionVersion === 1) {
        pack = crypto.decrypt_v1(message.pack, message.i === 1 ? undefined : this.key);
      } else if (this.accessory.context.device.encryptionVersion === 2 && message.tag !== undefined) {
        pack = crypto.decrypt_v2(message.pack, message.tag, message.i === 1 ? undefined : this.key);
      } else {
        this.platform.log.debug(`[${this.getDeviceLabel()}] handleMessage - Unknown message: %j`, message);
        this.platform.log.warn(`[${this.getDeviceLabel()}] Warning: handleMessage - Unknown response from device`);
        return;
      }
      this.platform.log.debug(`[${this.getDeviceLabel()}] handleMessage - Package -> %j`, pack);
      switch ((pack.t as string).toLowerCase()) {
      case 'bindok': // package type is binding confirmation
        if(!this.accessory.bound) {
          this.platform.log.debug(`[${this.getDeviceLabel()}] Device binding in progress`);
          this.key = pack.key;
          this.initAccessory();
          this.accessory.bound = true;
          this.platform.log.success(`[${this.getDeviceLabel()}] Device is bound -> ${pack.mac} (`,
            (this.accessory.context.device.uid ?? 0).toString(), ')');
          this.platform.log.debug(`[${this.getDeviceLabel()}] Device key -> ${this.key}`);
          this.requestDeviceStatus();
          setInterval(this.requestDeviceStatus.bind(this),
            this.deviceConfig.statusUpdateInterval * 1000); // statusUpdateInterval in seconds
        } else {
          this.platform.log.debug(`[${this.getDeviceLabel()}] Binding response received from already bound device`);
        }
        break;
      case 'dat': // package type is device status
        if (this.accessory.bound){
          let invalidTempFromDevice = false;
          pack.cols.forEach((col: string, i: number) => {
            if (col === commands.temperature.code && (pack.dat[i] <= 0 || pack.dat[i] >= 100)) {
              // temperature value outside of valid range (1-99 -> -39°C - +59°C) should be ignored (means: no sensor data)
              invalidTempFromDevice = true;
            } else {
              this.status[col] = pack.dat[i];
            }
            if (col === commands.power.code) {
              // power status received -> no more power change pending state
              this.powerPending = -1;
            }
            if (col === commands.mode.code) {
              // mode status received -> no more mode change pending state
              this.modePending = -1;
            }
            if (col === commands.buzzer.code && pack.dat[i] !== commands.buzzer.value.off && pack.dat[i] !== commands.buzzer.value.on &&
                this.silentTimeRanges !== undefined) {
              // invalid buzzer status -> disable silent time
              this.platform.log.warn(`[${this.getDeviceLabel()}] Warning: Device does not support command muting`);
              delete this.silentTimeRanges;
            }
          });
          if (this.silentTimeRanges !== undefined && pack.cols.find((col: string) => col === commands.buzzer.code) === undefined) {
            // status pack does not contain buzzer status -> disable silent time
            this.platform.log.warn(`[${this.getDeviceLabel()}] Warning: Device does not support command muting`);
            delete this.silentTimeRanges;
          }
          this.platform.log.debug(`[${this.getDeviceLabel()}] Device status -> %j`, this.status);
          if (!(pack.cols as [string]).includes(commands.temperature.code) || invalidTempFromDevice) {
            // temperature is not accessible -> use targetTemperature
            const targetTemp: number = this.status[commands.targetTemperature.code] !== undefined ?
              (this.status[commands.targetTemperature.code] as number) : 25; // use default if target temperature is also unknown
            this.status[commands.temperature.code] = targetTemp + this.deviceConfig.sensorOffset;
            this.platform.log.debug(`[${this.getDeviceLabel()}] Current temperature not available`,
              '- Threshold temperature is used as current (' + commands.targetTemperature.code + '->' + commands.temperature.code + ')');
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
        if (this.accessory.bound){
          this.platform.log.debug(`[${this.getDeviceLabel()}] Device response`, pack.opt, pack.p || pack.val);
          const updatedParams = [] as Array<string>;
          pack.opt.forEach((opt: string, i: number) => {
            const value: number = pack.p !== undefined ? pack.p[i] : pack.val[i];
            if (this.status[opt] !== value) {
              const cmd = this.getCommandName(commands, opt) || opt;
              const oldval = this.getValueName(commands, opt, (this.status[opt] as number)) || this.status[opt];
              const newval = this.getValueName(commands, opt, value) || value;
              updatedParams.push(`${cmd}: ${oldval} -> ${newval}`);
            }
            this.status[opt] = value;
            if (opt === commands.power.code) {
              // response to power command -> no more power change pending state
              this.powerPending = -1;
            }
            if (opt === commands.mode.code) {
              // response to mode command -> no more mode change pending state
              this.modePending = -1;
            }
          });
          if (updatedParams.length > 0) {
            this.platform.log.info(`[${this.getDeviceLabel()}] Device updated (%j)`, updatedParams);
          }
          this.updateStatus(pack.opt as string[]);
        }
        break;
      default:
        this.platform.log.debug(`[${this.getDeviceLabel()}] handleMessage - Unknown message: %j`, message);
        this.platform.log.warn(`[${this.getDeviceLabel()}] Warning: handleMessage - Unknown response from device`);
        break;
      }
    }
  };

  sendMessage(message: unknown) {
    this.platform.log.debug(`[${this.getDeviceLabel()}] sendMessage - Package -> %j`, message);
    this.platform.log.debug(`[${this.getDeviceLabel()}] sendMessage -> Encryption version: %i`,
      this.accessory.context.device.encryptionVersion);
    let pack:string, tag:string;
    if (this.accessory.context.device.encryptionVersion === 1) {
      pack = crypto.encrypt_v1(message, this.key);
      tag = '';
    } else if (this.accessory.context.device.encryptionVersion === 2) {
      const encrypted = crypto.encrypt_v2(message, this.key);
      pack = encrypted.pack;
      tag = encrypted.tag;
    } else {
      this.platform.log.warn(`[${this.getDeviceLabel()}] Warning: sendMessage -> Unsupported encryption version`);
      return;
    }
    const payload = (tag === '') ? {
      tcid: this.accessory.context.device.mac.substring(this.accessory.context.device.mac.indexOf('@')+1),
      uid: this.accessory.context.device.uid ?? 0,
      t: 'pack',
      pack,
      i: this.key === undefined ? 1 : 0,
      cid: 'app',
    } : {
      tcid: this.accessory.context.device.mac.substring(this.accessory.context.device.mac.indexOf('@')+1),
      uid: this.accessory.context.device.uid ?? 0,
      t: 'pack',
      pack,
      i: this.key === undefined ? 1 : 0,
      tag,
      cid: 'app',
    };
    try {
      const msg = JSON.stringify(payload);
      this.platform.log.debug(`[${this.getDeviceLabel()}] sendMessage`, msg);
      this.socket.send(
        msg,
        this.accessory.context.device.port,
        this.accessory.context.device.address,
      );
    } catch (err) {
      this.platform.log.error(`[${this.getDeviceLabel()}] sendMessage - Error:`, (err as Error).message);
    }
  }

  sendBindRequest() {
    const message = {
      mac: this.accessory.context.device.mac.substring(this.accessory.context.device.mac.indexOf('@')+1),
      t: 'bind',
      uid: this.accessory.context.device.mac.indexOf('@') < 0 ? 0 :
        this.accessory.context.device.mac.substring(0, this.accessory.context.device.mac.indexOf('@')),
    };
    this.platform.log.debug(`[${this.getDeviceLabel()}] Bind to device -> ${this.accessory.context.device.mac}`);
    this.sendMessage(message);
  }

  sendCommand(cmd: Record<string, unknown>) {
    if (this.isSilentTime()) {
      // add buzzer off command if current time is in silent time range
      cmd[commands.buzzer.code] = commands.buzzer.value.off;
    }
    this.platform.log.debug(`[${this.getDeviceLabel()}] Send commands -> %j`, cmd);
    const keys = Object.keys(cmd);
    const values = keys.map((k) => cmd[k]);
    const message = {
      t: 'cmd',
      opt: keys,
      p: values,
    };
    if (keys.includes(commands.power.code)) {
      this.powerPending = (values[keys.indexOf(commands.power.code)] as number);
    }
    if (keys.includes(commands.mode.code)) {
      this.modePending = (values[keys.indexOf(commands.mode.code)] as number);
    }
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
