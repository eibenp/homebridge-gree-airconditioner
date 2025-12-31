import dgram, { Socket } from 'dgram';
import crypto from './crypto.js';
import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { Categories } from 'homebridge';
import { networkInterfaces } from 'os';
import { readFileSync } from 'fs';

import { GreeAirConditioner } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME, UDP_SCAN_PORT, DEFAULT_DEVICE_CONFIG, MODIFY_VERTICAL_SWING_POSITION, ENCRYPTION_VERSION, TS_TYPE,
  DEF_SCAN_INTERVAL, TEMPERATURE_LIMITS, TEMPERATURE_STEPS, BINDING_TIMEOUT } from './settings.js';

import commands from './commands.js';
import { version } from './version.js';

// This is only required when using Custom Services and Characteristics not support by HomeKit
//import { EveHomeKitTypes } from 'homebridge-lib/EveHomeKitTypes';

export interface MyPlatformAccessory extends PlatformAccessory {
  bound?: boolean;
  registered?: boolean;
}

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class GreeACPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  private devices: Record<string, MyPlatformAccessory>;
  private processedDevices: Record<string, boolean>;
  private skippedDevices: Record<string, boolean>;
  private warningShown: Record<string, boolean>;
  private bridges: Record<string, {mac: string, key: string, bound: boolean}>;

  private socket: dgram.Socket;
  private pluginAddresses: Record<string, string> = {};
  public ports: number[] = [];
  private tempUnit: string;

  // This is only required when using Custom Services and Characteristics not support by HomeKit
   
  //public readonly CustomServices: any;
   
  //public readonly CustomCharacteristics: any;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // This is only required when using Custom Services and Characteristics not support by HomeKit
    //this.CustomServices = new EveHomeKitTypes(this.api).Services;
    //this.CustomCharacteristics = new EveHomeKitTypes(this.api).Characteristics;

    this.devices = {};
    this.processedDevices = {};
    this.skippedDevices = {};
    this.warningShown = {};
    this.bridges = {};

    // get temperature unit from Homebridge UI config
    const configPath = this.api.user.configPath();
    const cfg = JSON.parse(readFileSync(configPath).toString());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configPlatform = cfg?.platforms?.find((item: any) => item.platform === 'config') || {};
    this.tempUnit = configPlatform?.tempUnits || 'f';
    if (!['f', 'c'].includes(this.tempUnit)) {
      this.tempUnit = 'f';
    }
    this.log.debug(`Temperature display unit is ${this.tempUnit === 'f' ? 'Fahrenheit (°F)' : 'Celsius (°C)'}`);

    // log auto detection parameter
    if (this.config.disableAutoDetection === true) {
      this.log.debug('Auto detection disabled');
    }

    // network initialization
    this.pluginAddresses = this.getNetworkAddresses(cfg?.bridge?.bind);
    if (Object.entries(this.pluginAddresses).length > 0) {
      this.log.debug('Device detection address list {(address : netmask) pairs}:', this.pluginAddresses);
    } else {
      this.log.error('Error: Homebridge host has no IPv4 address');
    }
    // if no IPv4 address found we create socket for IPv6
    this.socket = dgram.createSocket({ type: (Object.entries(this.pluginAddresses).length > 0) ? 'udp4' : 'udp6', reuseAddr: true });
    this.socket.on('error', (err) => {
      this.log.error('Network - Error:', err.message);
    });
    this.socket.on('close', () => {
      this.log.debug('Network - Connection closed');
    });
    this.log.debug('Finished initializing platform');

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executing didFinishLaunching callback');
      if (Object.entries(this.pluginAddresses).length === 0) {
        this.socket.close();
        this.log.error('Network - Error: No IPv4 host address found');
      } else {
        this.socket.on('message', this.handleMessage);
        // run the method to discover / register your devices as accessories
        this.discoverDevices();
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: MyPlatformAccessory) {
    this.log.debug('Loading accessory from cache:', accessory.displayName, JSON.stringify(accessory.context.device));

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    if (accessory.context?.device?.mac) {
      if (!accessory.context.deviceType || accessory.context.deviceType === 'HeaterCooler') {
        accessory.bound = false;
      }
      accessory.registered = true;
      this.devices[accessory.context.device.mac] = accessory;
    }
    // clean all invalid accessories found in cache
    if (!accessory.context) {
      this.log.debug('Invalid accessory found in cache - deleting:', accessory.displayName, accessory.UUID);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
    // remove deprecated properties from cached accessory
    if (accessory.context?.bound !== undefined) {
      delete accessory.context.bound;
    }
  }

  /**
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */

  bindCallback() {
    this.log.success(`${PLATFORM_NAME} (${PLUGIN_NAME}) v%s is running on UDP port %d`, version, this.socket.address().port);
    this.ports.push(this.socket.address().port);
    this.socket.setBroadcast(true);
    this.sendScan();
    setInterval(() => {
      this.sendScan();
    }, (this.config.scanInterval || DEF_SCAN_INTERVAL) * 1000); // scanInterval in seconds (default = 60 sec)
  }

  discoverDevices() {
    if (this.config.port === undefined || (this.config.port !== undefined && typeof this.config.port === 'number' &&
      this.config.port === this.config.port && this.config.port >= 1025 && this.config.port <= 65535)) {
      this.socket.bind(this.config.port, undefined, () => this.bindCallback());
    } else {
      this.log.error('Error: Port is misconfigured (Valid port values: 1025~65535 or leave port empty to auto select)');
      this.socket.close();
    }
  }

  handleMessage = (msg: Buffer, rinfo: {address: string, family: string, port: number, size: number}) => {
    this.log.debug('handleMessage -> %s', msg.toString());
    try {
      let message;
      try{
        message = JSON.parse(msg.toString());
      } catch (e){
        this.log.debug('handleMessage - unknown message from %s - BASE64 encoded message: %s', rinfo.address,
          Buffer.from(msg).toString('base64'));
        return;
      }
      if (!message.pack) {
        this.log.debug('handleMessage - unknown response from %s: %j', rinfo.address, message);
        this.log.warn('Warning: handleMessage - unknown response from %s', rinfo.address);
        return;
      }
      let pack, encryptionVersion:number;
      if (message.tag === undefined) {
        this.log.debug('handleMessage -> Encryption version: 1');
        pack = crypto.decrypt_v1(message.pack, message.i === 1 ? undefined : this.bridges[rinfo.address]?.key);
        encryptionVersion = 1;
      } else {
        this.log.debug('handleMessage -> Encryption version: 2');
        pack = crypto.decrypt_v2(message.pack, message.tag, message.i === 1 ? undefined : this.bridges[rinfo.address]?.key);
        encryptionVersion = 2;
      }
      this.log.debug('handleMessage - Package -> %j', pack);
      if (encryptionVersion === 1 && pack.t === 'dev' && pack.ver && !pack.ver.toString().startsWith('V1.')) {
        // some devices respond to scan command with V1 encryption but binding requires V2 encryption
        // we set encryption to V2 if device version is not V1.x
        encryptionVersion = 2;
      }
      switch ((pack.t as string).toLowerCase()) {
      case 'dev': // package type is device information
        if (pack.subCnt === undefined) {
          // normal Wifi device
          if (this.config.disableAutoDetection !== true || this.config.devices?.find((item: { mac?: string }) => item.mac === pack.mac) !==
            undefined) {
            this.registerDevice({
              ...pack,
              address: rinfo.address,
              port: rinfo.port,
              encryptionVersion,
            });
          } else {
            if (this.config.disableAutoDetection === true && this.config.devices?.find((item: { mac?: string }) => item.mac === pack.mac) ===
              undefined) {
              if (this.skippedDevices[pack.mac] !== true) {
                this.log.debug(`Accessory ${pack.mac} skipped`);
                this.skippedDevices[pack.mac] = true;
              }
            }
          }
        } else {
          // bridge
          if (this.config.disableAutoDetection !== true || this.config.devices?.find((item: { mac?: string, disabled?: boolean }) =>
            item.mac?.endsWith(`@${pack.mac}`) && item.disabled !== true) !== undefined && this.skippedDevices[pack.mac] !== true) {
            if (pack.subCnt && pack.subCnt > 0) {
              if (this.bridges[rinfo.address]?.bound) {
                this.log.debug(`[${rinfo.address}] Device already bound`);
              } else {
                this.log.info(`[${rinfo.address}] Device is a bridge with %i subdevices`, pack.subCnt);
                const message = {
                  mac: pack.mac,
                  t: 'bind',
                  uid: 0,
                };
                this.log.debug(`[${rinfo.address}] Bind to device -> ${pack.mac}`);
                this.sendEncryptedMessage(message, pack.mac, rinfo.address, rinfo.port, encryptionVersion);
              }
            } else {
              this.log.warn(`[${rinfo.address}] Warning: Device is a bridge but no subdevices found`);
              this.skippedDevices[pack.mac] = true;
            }
          } else {
            this.log.debug(`Accessory ${pack.mac} skipped`);
            this.skippedDevices[pack.mac] = true;
          }
        }
        break;
      case 'bindok': // package type is binding confirmation
        this.log.debug(`[${rinfo.address}] Device binding in progress`);
        this.bridges[rinfo.address] = { mac: pack.mac, key: pack.key, bound: false };
        {
          const message = {
            mac: pack.mac,
            t: 'subDev',
            i: 0,
          };
          this.sendEncryptedMessage(message, pack.mac, rinfo.address, rinfo.port, encryptionVersion, this.bridges[rinfo.address]?.key);
        }
        break;
      case 'sublist': // package type is subdevice list
        if (!this.bridges[rinfo.address].bound) {
          this.bridges[rinfo.address].bound = true;
          this.log.success(`[${rinfo.address}] Device is bound -> ${this.bridges[rinfo.address].mac}`);
          if (pack.c && pack.c > 0 && pack.list && pack.list.length > 0) {
            // subdevices reported -> register them
            let i: number;
            for (i = 0; i < pack.c; i++) {
              const mac = `${pack.list[i].mac}@${this.bridges[rinfo.address].mac}`;
              if (this.config.disableAutoDetection !== true || this.config.devices?.find((item: { mac?: string }) => item.mac === mac)
                !== undefined) {
                this.registerDevice({
                  ...(pack.list[i]),
                  mac,
                  address: rinfo.address,
                  port: rinfo.port,
                  encryptionVersion,
                });
              } else {
                if (this.config.disableAutoDetection === true && this.config.devices?.find((item: { mac?: string }) => item.mac ===
                  mac) === undefined) {
                  if (this.skippedDevices[mac] !== true) {
                    this.log.debug(`Accessory ${mac} skipped`);
                    this.skippedDevices[mac] = true;
                  }
                }
              }
            }
          } else {
            this.log.warn(`[${rinfo.address}] Warning: No subdevices reported`);
            this.skippedDevices[this.bridges[rinfo.address].mac] = true;
          }
        }
        break;
      default:
        this.log.debug('handleMessage - unknown package from %s: %j', rinfo.address.toString(), pack);
        break;
      }
    } catch (err) {
      const msg = (err as Error).message;
      this.log.error('handleMessage (%s) - Error: %s', rinfo.address.toString(), msg);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerDevice = (deviceInfo: any) => {
    this.log.debug('registerDevice - deviceInfo:', JSON.stringify(deviceInfo));
    const devcfg = this.config.devices?.find((item: { mac?: string }) => item.mac === deviceInfo.mac) || { mac: deviceInfo.mac };
    const deviceConfig = {
      // parameters read from config
      ...devcfg,
      // fix incorrect values read from config but do not add any value if parameter is missing
      ...((devcfg.speedSteps && devcfg.speedSteps !== 3 && devcfg.speedSteps !== 5) || devcfg.speedSteps === 0 ?
        { speedSteps: DEFAULT_DEVICE_CONFIG.speedSteps } : {}),
      ...(devcfg.temperatureSensor && Object.values(TS_TYPE).includes((devcfg.temperatureSensor as string).toLowerCase()) ?
        { temperatureSensor: (devcfg.temperatureSensor as string).toLowerCase() }
        : (devcfg.temperatureSensor ? { temperatureSensor: DEFAULT_DEVICE_CONFIG.temperatureSensor } : {})),
      ...(devcfg.minimumTargetTemperature &&
        (devcfg.minimumTargetTemperature < Math.min(TEMPERATURE_LIMITS.coolingMinimum, TEMPERATURE_LIMITS.heatingMinimum) ||
        devcfg.minimumTargetTemperature > Math.max(TEMPERATURE_LIMITS.coolingMaximum, TEMPERATURE_LIMITS.heatingMaximum)) ?
        { minimumTargetTemperature: DEFAULT_DEVICE_CONFIG.minimumTargetTemperature } : {}),
      ...(devcfg.maximumTargetTemperature &&
        (devcfg.maximumTargetTemperature < Math.min(TEMPERATURE_LIMITS.coolingMinimum, TEMPERATURE_LIMITS.heatingMinimum) ||
        devcfg.maximumTargetTemperature > Math.max(TEMPERATURE_LIMITS.coolingMaximum, TEMPERATURE_LIMITS.heatingMaximum)) ?
        { maximumTargetTemperature: DEFAULT_DEVICE_CONFIG.maximumTargetTemperature } : {}),
      ...(devcfg.defaultVerticalSwing && ![commands.swingVertical.value.default, commands.swingVertical.value.fixedHighest,
        commands.swingVertical.value.fixedHigher, commands.swingVertical.value.fixedMiddle, commands.swingVertical.value.fixedLower,
        commands.swingVertical.value.fixedLowest].includes(devcfg.defaultVerticalSwing) ?
        { defaultVerticalSwing: DEFAULT_DEVICE_CONFIG.defaultVerticalSwing } : {}),
      ...(devcfg.defaultFanVerticalSwing && ![commands.swingVertical.value.default, commands.swingVertical.value.fixedHighest,
        commands.swingVertical.value.fixedHigher, commands.swingVertical.value.fixedMiddle, commands.swingVertical.value.fixedLower,
        commands.swingVertical.value.fixedLowest].includes(devcfg.defaultFanVerticalSwing) ?
        { defaultFanVerticalSwing: DEFAULT_DEVICE_CONFIG.defaultFanVerticalSwing } : {}),
      // overrideDefaultVerticalSwing remains here for compatibility reasons
      ...(devcfg.overrideDefaultVerticalSwing &&
        !Object.values(MODIFY_VERTICAL_SWING_POSITION).includes(devcfg.overrideDefaultVerticalSwing) ?
        { overrideDefaultVerticalSwing: DEFAULT_DEVICE_CONFIG.modifyVerticalSwingPosition } : {}),
      ...(devcfg.modifyVerticalSwingPosition &&
        !Object.values(MODIFY_VERTICAL_SWING_POSITION).includes(devcfg.modifyVerticalSwingPosition) ?
        { modifyVerticalSwingPosition: DEFAULT_DEVICE_CONFIG.modifyVerticalSwingPosition } : {}),
      ...(devcfg.encryptionVersion && !Object.values(ENCRYPTION_VERSION).includes(devcfg.encryptionVersion) ?
        { encryptionVersion: DEFAULT_DEVICE_CONFIG.encryptionVersion } : {}),
    };
    // assign customized default to missing parameters
    Object.entries(this.config.devices?.find((item: { mac?: string, disabled?: boolean }) => item.mac?.toLowerCase() === 'default' &&
      !item?.disabled) || {})
      .forEach(([key, value]) => {
        if (!['mac', 'name', 'ip', 'port', 'disabled'].includes(key) && deviceConfig[key] === undefined) {
          deviceConfig[key] = value;
        }
      });
    // try to assign temperatureStepSize from Homebridge UI if missing in configuration
    if (deviceConfig.temperatureStepSize === undefined && this.tempUnit === 'c') {
      deviceConfig.temperatureStepSize = TEMPERATURE_STEPS.celsius;
    }
    if (deviceConfig.temperatureStepSize === undefined && this.tempUnit === 'f') {
      deviceConfig.temperatureStepSize = TEMPERATURE_STEPS.fahrenheit;
    }
    if (deviceConfig.temperatureStepSize !== undefined && !Object.values(TEMPERATURE_STEPS).includes(deviceConfig.temperatureStepSize)) {
      this.log.warn(`Warning: Invalid temperature step size detected: ${deviceConfig.temperatureStepSize} ->`,
        `Accessory ${deviceInfo.mac} is using default value (0.5) instead of the configured one`);
      delete deviceConfig.temperatureStepSize;
    }
    // assign plugin default to missing parameters
    Object.entries(DEFAULT_DEVICE_CONFIG).forEach(([key, value]) => {
      if (deviceConfig[key] === undefined) {
        deviceConfig[key] = value;
      }
    });
    // check parameters and fix incorrect values (some of them are repeated checks because default device may also be incorrect)
    if ((deviceConfig.speedSteps && deviceConfig.speedSteps !== 3 && deviceConfig.speedSteps !== 5) || deviceConfig.speedSteps === 0) {
      deviceConfig.speedSteps = DEFAULT_DEVICE_CONFIG.speedSteps;
    }
    if (deviceConfig.temperatureSensor && Object.values(TS_TYPE).includes((deviceConfig.temperatureSensor as string).toLowerCase())) {
      deviceConfig.temperatureSensor = (deviceConfig.temperatureSensor as string).toLowerCase();
    } else {
      deviceConfig.temperatureSensor = DEFAULT_DEVICE_CONFIG.temperatureSensor;
    }
    if (deviceConfig.minimumTargetTemperature &&
      (deviceConfig.minimumTargetTemperature < Math.min(TEMPERATURE_LIMITS.coolingMinimum, TEMPERATURE_LIMITS.heatingMinimum) ||
      deviceConfig.minimumTargetTemperature > Math.max(TEMPERATURE_LIMITS.coolingMaximum, TEMPERATURE_LIMITS.heatingMaximum))) {
      deviceConfig.minimumTargetTemperature = DEFAULT_DEVICE_CONFIG.minimumTargetTemperature;
    }
    if (deviceConfig.maximumTargetTemperature &&
      (deviceConfig.maximumTargetTemperature < Math.min(TEMPERATURE_LIMITS.coolingMinimum, TEMPERATURE_LIMITS.heatingMinimum) ||
      deviceConfig.maximumTargetTemperature > Math.max(TEMPERATURE_LIMITS.coolingMaximum, TEMPERATURE_LIMITS.heatingMaximum))) {
      deviceConfig.maximumTargetTemperature = DEFAULT_DEVICE_CONFIG.maximumTargetTemperature;
    }
    if (deviceConfig.minimumTargetTemperature && deviceConfig.maximumTargetTemperature &&
      deviceConfig.minimumTargetTemperature > deviceConfig.maximumTargetTemperature) {
      deviceConfig.minimumTargetTemperature =
        Math.min(DEFAULT_DEVICE_CONFIG.minimumTargetTemperature, DEFAULT_DEVICE_CONFIG.maximumTargetTemperature);
      deviceConfig.maximumTargetTemperature =
        Math.max(DEFAULT_DEVICE_CONFIG.minimumTargetTemperature, DEFAULT_DEVICE_CONFIG.maximumTargetTemperature);
      this.log.warn('Warning: Invalid minimum and maximum target temperature values detected ->',
        `Accessory ${deviceInfo.mac} is using default values instead of the configured ones`);
    }
    if (deviceConfig.defaultVerticalSwing && ![commands.swingVertical.value.default, commands.swingVertical.value.fixedHighest,
      commands.swingVertical.value.fixedHigher, commands.swingVertical.value.fixedMiddle, commands.swingVertical.value.fixedLower,
      commands.swingVertical.value.fixedLowest].includes(deviceConfig.defaultVerticalSwing)) {
      deviceConfig.defaultVerticalSwing = DEFAULT_DEVICE_CONFIG.defaultVerticalSwing;
      this.log.warn('Warning: Invalid vertical position detected ->',
        `Accessory ${deviceInfo.mac} is using default value instead of the configured one`);
    }
    if (deviceConfig.defaultFanVerticalSwing && ![commands.swingVertical.value.default, commands.swingVertical.value.fixedHighest,
      commands.swingVertical.value.fixedHigher, commands.swingVertical.value.fixedMiddle, commands.swingVertical.value.fixedLower,
      commands.swingVertical.value.fixedLowest].includes(deviceConfig.defaultFanVerticalSwing)) {
      deviceConfig.defaultFanVerticalSwing = DEFAULT_DEVICE_CONFIG.defaultFanVerticalSwing;
      this.log.warn('Warning: Invalid vertical fan position detected ->',
        `Accessory ${deviceInfo.mac} is using default value instead of the configured one`);
    }
    // overrideDefaultVerticalSwing remains here for compatibility reasons
    if (deviceConfig.overrideDefaultVerticalSwing &&
      !Object.values(MODIFY_VERTICAL_SWING_POSITION).includes(deviceConfig.overrideDefaultVerticalSwing)) {
      deviceConfig.overrideDefaultVerticalSwing = DEFAULT_DEVICE_CONFIG.modifyVerticalSwingPosition;
    }
    if (deviceConfig.modifyVerticalSwingPosition &&
      !Object.values(MODIFY_VERTICAL_SWING_POSITION).includes(deviceConfig.modifyVerticalSwingPosition)) {
      deviceConfig.modifyVerticalSwingPosition = DEFAULT_DEVICE_CONFIG.modifyVerticalSwingPosition;
    }
    if (deviceConfig.encryptionVersion && !Object.values(ENCRYPTION_VERSION).includes(deviceConfig.encryptionVersion)) {
      deviceConfig.encryptionVersion = DEFAULT_DEVICE_CONFIG.encryptionVersion;
    }
    if (deviceConfig.port !== undefined && (typeof deviceConfig.port !== 'number' || deviceConfig.port !== deviceConfig.port ||
      (typeof deviceConfig.port === 'number' && (deviceConfig.port < 1025 || deviceConfig.port > 65535)))) {
      this.log.warn('Warning: Port is misconfigured (Valid port values: 1025~65535 or leave port empty to auto select) - ' +
        `Accessory ${deviceInfo.mac} listening port overridden: ${deviceConfig.port} -> auto`);
      delete deviceConfig.port;
    }
    // replace deprecated overrideDefaultVerticalSwing with new modifyVerticalSwingPosition
    if (deviceConfig.overrideDefaultVerticalSwing !== undefined && deviceConfig.modifyVerticalSwingPosition === undefined) {
      // found deprecated but missing new
      if (!this.warningShown[`${deviceInfo.mac}_overrideDefaultVerticalSwing`]) {
        this.log.warn('Deprecated configuration parameter found: overrideDefaultVerticalSwing - ' +
          `Accessory ${deviceInfo.mac} parameter value: ${deviceConfig.overrideDefaultVerticalSwing} -> use modifyVerticalSwingPosition`);
        this.warningShown[`${deviceInfo.mac}_overrideDefaultVerticalSwing`] = true;
      }
      deviceConfig.modifyVerticalSwingPosition = deviceConfig.overrideDefaultVerticalSwing;
      delete deviceConfig.overrideDefaultVerticalSwing;
    } else if (deviceConfig.overrideDefaultVerticalSwing !== undefined && deviceConfig.modifyVerticalSwingPosition !== undefined) {
      // found both deprecated and new -> keep new only
      if (!this.warningShown[`${deviceInfo.mac}_overrideDefaultVerticalSwing`]) {
        this.log.warn('Deprecated configuration parameter found: overrideDefaultVerticalSwing - ' +
          `Accessory ${deviceInfo.mac} parameter value: ${deviceConfig.overrideDefaultVerticalSwing} -> ignoring`);
        this.warningShown[`${deviceInfo.mac}_overrideDefaultVerticalSwing`] = true;
      }
      delete deviceConfig.overrideDefaultVerticalSwing;
    }
    // ignore invalid silentTimeRange
    if (deviceConfig.silentTimeRange) {
      const match =
        (deviceConfig.silentTimeRange as string).match(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]-(((0[0-9]|1[0-9]|2[0-3]):[0-5][0-9])|24:00)$/);
      if (!match || (match && deviceConfig.silentTimeRange !== match[0])) {
        // invalid parameter value (not in HH:MM-HH:MM format)
        if (!this.warningShown[`${deviceInfo.mac}_silentTimeRange`]) {
          this.log.warn('Invalid configuration parameter value found: silentTimeRange - ' +
            `Accessory ${deviceInfo.mac} parameter value: ${deviceConfig.silentTimeRange} -> ignoring`);
          this.warningShown[`${deviceInfo.mac}_silentTimeRange`] = true;
        }
        delete deviceConfig.silentTimeRange;
      }
    }
    // force encryption version if set in config
    if (deviceConfig.encryptionVersion !== ENCRYPTION_VERSION.auto) {
      deviceInfo.encryptionVersion = deviceConfig.encryptionVersion;
      this.log.debug(`Accessory ${deviceInfo.mac} encryption version forced:`, deviceInfo.encryptionVersion);
    }

    let accessory: MyPlatformAccessory | undefined = this.getAccessory(deviceInfo.mac);
    let accessory_ts: MyPlatformAccessory | undefined = this.getAccessory(deviceInfo.mac + '_ts');

    if (deviceConfig?.disabled || !/^[a-f0-9]{12}$/.test(deviceConfig?.mac.substring(deviceConfig?.mac.indexOf('@')+1) || '000000000000')) {
      //do not skip unconfigured devices
      if (!this.skippedDevices[deviceInfo.mac]) {
        this.log.info(`Accessory ${deviceInfo.mac} skipped`);
        this.skippedDevices[deviceInfo.mac] = true;
      } else {
        this.log.debug(`Accessory ${deviceInfo.mac} skipped`);
      }
      if (accessory) {
        delete this.devices[accessory.context.device.mac];
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.log.debug(`registerDevice - unregister (${devcfg.mac === undefined ? 'not configured' : 'disabled'}):`,
          accessory.displayName, accessory.UUID);
        accessory = undefined;
      }
      if (accessory_ts) {
        delete this.devices[accessory_ts.context.device.mac];
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory_ts]);
        this.log.debug(`registerDevice - unregister (${devcfg.mac === undefined ? 'not configured' : 'disabled'}):`,
          accessory_ts.displayName, accessory_ts.UUID);
        accessory_ts = undefined;
      }
      return;
    }

    // check device address change
    if (accessory && deviceInfo.address !== accessory.context.device.address) {
      this.log.info(`Device [${accessory.displayName} - ${accessory.context.device.mac}] address has changed: %s -> %s`,
        accessory.context.device.address, deviceInfo.address);
      accessory.context.device.address = deviceInfo.address;
    }
    if (accessory_ts && deviceInfo.address !== accessory_ts.context.device.address) {
      accessory_ts.context.device.address = deviceInfo.address;
    }

    if (accessory && this.processedDevices[accessory.UUID]) {
      // already initalized
      this.log.debug('registerDevice - already processed:', accessory.displayName, accessory.context.device.mac, accessory.UUID);
      return;
    }

    // create heatercooler accessory if not loaded from cache
    const deviceName = deviceConfig?.name ?? (deviceInfo.name || deviceInfo.mac);
    if (!accessory) {
      this.log.debug(`Creating new accessory ${deviceInfo.mac} with name ${deviceName} ...`);
      const uuid = this.api.hap.uuid.generate(deviceInfo.mac);
      accessory = new this.api.platformAccessory(deviceName, uuid, Categories.AIR_CONDITIONER);
      accessory.bound = false;
      accessory.registered = false;

      this.devices[deviceInfo.mac] = accessory;
    }

    // create temperaturesensor accessory if configured as separate and not loaded from cache
    const tsDeviceName = 'Temperature Sensor ' + (deviceConfig?.name ?? (deviceInfo.name || deviceInfo.mac));
    if (!accessory_ts && deviceConfig.temperatureSensor === TS_TYPE.separate) {
      this.log.debug(`Creating new accessory ${deviceInfo.mac}_ts with name ${tsDeviceName} ...`);
      const uuid = this.api.hap.uuid.generate(deviceInfo.mac + '_ts');
      accessory_ts = new this.api.platformAccessory(tsDeviceName, uuid, Categories.SENSOR);
      accessory_ts.registered = false;

      this.devices[deviceInfo.mac + '_ts'] = accessory_ts;
    }

    // unregister temperaturesensor accessory if configuration has changed from separate to any other
    if (accessory_ts && deviceConfig.temperatureSensor !== TS_TYPE.separate) {
      if (accessory_ts.registered === true) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory_ts]);
      }
      delete this.devices[deviceInfo.mac + '_ts'];
      this.log.debug('registerDevice - unregister:', accessory_ts.displayName, accessory_ts.UUID);
      accessory_ts = undefined;
    }

    if (accessory_ts && deviceConfig.temperatureSensor === TS_TYPE.separate) {
      // mark temperature sensor device as initialized
      accessory_ts.context.device = { ...deviceInfo };
      accessory_ts.context.device.mac = deviceInfo.mac + '_ts';
      accessory_ts.context.deviceType = 'TemperatureSensor';
      if (deviceConfig.model) {
        accessory_ts.context.device.model = deviceConfig.model;
      }
      this.processedDevices[accessory_ts.UUID] = true;
      this.log.debug(`registerDevice - ${accessory_ts.context.deviceType} created:`, accessory_ts.displayName,
        accessory_ts.context.device.mac, accessory_ts.UUID);
      // do not load temperature sensor accessory here (it will be loaded from heatercooler accessory)
    }

    if (accessory) {
      // mark heatercooler device as processed
      accessory.context.device = deviceInfo;
      accessory.context.deviceType = 'HeaterCooler';
      this.processedDevices[accessory.UUID] = true;
      this.log.debug(`registerDevice - ${accessory.context.deviceType} created:`, accessory.displayName,
        accessory.context.device.mac, accessory.UUID);
      // load heatercooler accessory
      const acsocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const ac = new GreeAirConditioner(this, accessory, deviceConfig, accessory_ts?.context.device.mac, acsocket);
      acsocket.on('error', (err) => {
        this.log.error(`[${ac.getDeviceLabel()}] Network - Error:`, err.message);
      });
      if (!ac.accessory.context.device.mac.includes('@')) {
        // normal device -> bind now
        acsocket.on('message', this.handleACMessage.bind(this, ac, acsocket));
      }
      acsocket.on('close', () => {
        this.log.error(`[${ac.getDeviceLabel()}] Network - Connection closed`);
      });
      if (this.ports.indexOf(deviceConfig.port || 0) >= 0) {
        this.log.warn(`[${ac.getDeviceLabel()}] Warning: Configured port (%i) is already used - replacing with auto assigned port`,
          deviceConfig.port);
        deviceConfig.port = undefined;
      }
      acsocket.bind(deviceConfig.port, undefined, () => {
        this.log.info(`[${ac.getDeviceLabel()}] Device handler is listening on UDP port %d`, acsocket.address().port);
        this.ports.push(acsocket.address().port);
        acsocket.setBroadcast(false);
        if (!ac.accessory.context.device.mac.includes('@')) {
          // normal device -> bind now
          this.sendBindRequest(ac);
          setTimeout(this.checkBindingStatus.bind(this, 1, ac), BINDING_TIMEOUT);
        } else {
          // bridged device -> bridge already bound
          this.log.debug(`[${ac.getDeviceLabel()}] Device binding in progress`);
          ac.key = this.bridges[ac.accessory.context.device.address]?.key;
          this.log.debug(`[${ac.getDeviceLabel()}] Device key ->`, ac.key);
          acsocket.on('message', ac.handleMessage);
          ac.accessory.bound = true;
          ac.initAccessory();
          this.log.success(`[${ac.getDeviceLabel()}] Device is bound -> ${ac.accessory.context.device.mac}`);
          ac.requestDeviceStatus();
          setInterval(ac.requestDeviceStatus.bind(ac), ac.deviceConfig.statusUpdateInterval * 1000);
        }
      });
    }
  };

  sendScan() {
    const message = Buffer.from(JSON.stringify({ t: 'scan' }));
    Object.entries(this.pluginAddresses).forEach((value) => {
      const addr = value[0];
      this.socket.send(message, 0, message.length, UDP_SCAN_PORT, addr, (error) => {
        if (this.pluginAddresses[addr] === '255.255.255.255') {
          this.log.debug(`Scanning for device (unicast) '${message}' ${addr}:${UDP_SCAN_PORT}`);
        } else {
          this.log.debug(`Scanning for devices (broadcast) '${message}' ${addr}:${UDP_SCAN_PORT}`);
        }
        if (error) {
          this.log.error('Device scan - Error:', error.message);
        }
      });
    });
  }

  sendEncryptedMessage(message: unknown, mac: string, address: string, port: number, encryptionVersion: number, key?: string) {
    this.log.debug(`[${address}] sendMessage - Package -> %j`, message);
    this.log.debug(`[${address}] sendMessage -> Encryption version: %i`, encryptionVersion);
    let pack:string, tag:string;
    if (encryptionVersion === 1) {
      pack = crypto.encrypt_v1(message, key);
      tag = '';
    } else if (encryptionVersion === 2) {
      const encrypted = crypto.encrypt_v2(message, key);
      pack = encrypted.pack;
      tag = encrypted.tag;
    } else {
      this.log.warn(`[${address}] Warning: sendMessage -> Unsupported encryption version`);
      return;
    }
    const payload = (tag === '') ? {
      tcid: mac,
      uid: 0,
      t: 'pack',
      pack,
      i: key === undefined ? 1 : 0,
      cid: 'app',
    } : {
      tcid: mac,
      uid: 0,
      t: 'pack',
      pack,
      i: key === undefined ? 1 : 0,
      tag,
      cid: 'app',
    };
    try {
      const msg = JSON.stringify(payload);
      this.log.debug(`[${address}] sendMessage`, msg);
      this.socket.send(
        msg,
        port,
        address,
      );
    } catch (err) {
      this.log.error(`[${address}] sendMessage - Error:`, (err as Error).message);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getNetworkAddresses(bindInterfaces: any) {
    this.log.debug('Checking network interfaces');
    const pluginAddresses: Record<string, string> = {};
    let allInterfaces;
    if (bindInterfaces !== null && bindInterfaces !== undefined && bindInterfaces.length > 0) {
      this.log.debug('Homebridge bound to:', bindInterfaces);
      const filteredEntries = Object.entries(networkInterfaces()).filter(([key]) => {
        return bindInterfaces.includes(key);
      });
      allInterfaces = Object.fromEntries(filteredEntries);
    } else {
      allInterfaces = networkInterfaces();
    }
    for (const name of Object.keys(allInterfaces)) {
      const nets = allInterfaces[name];
      if (nets) {
        for (const iface of nets) {
          // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
          const familyV4Value = typeof iface.family === 'string' ? 'IPv4' : 4;
          if (iface.family === familyV4Value && !iface.internal) {
            const addrParts = iface.address.split('.');
            const netmaskParts = iface.netmask.split('.');
            const broadcast = addrParts.map((e, i) => ((~Number(netmaskParts[i]) & 0xFF) | Number(e)).toString()).join('.');
            this.log.debug('Interface: \'%s\' Address: %s Netmask: %s Broadcast: %s', name, iface.address, iface.netmask, broadcast);
            if (pluginAddresses[broadcast] === undefined) {
              pluginAddresses[broadcast] = iface.netmask;
            }
          }
        }
      }
    }
    // Add IPs from configuration but only if at least one host address found (add only for valid mac addresses)
    if (Object.keys(pluginAddresses).length > 0) {
      const devcfgs:[] = this.config.devices?.filter((item: { ip?: string, disabled?: boolean, mac?: string }) =>
        item.ip && !item.disabled && /^[a-f0-9]{12}$/.test(item.mac || '')) || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      devcfgs.forEach((value: any) => {
        const ip: string = value.ip;
        const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})(\.(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})){3}$/;
        if (ipv4Pattern.test(ip)) {
          this.log.debug('Found AC Unit address in configuration:', ip);
          const addrParts = ip.split('.');
          const addresses: Record<string, boolean> = {};
          Object.keys(pluginAddresses).forEach((addr) => {
            const netmaskParts = pluginAddresses[addr].split('.');
            const broadcast = addrParts.map((e, i) => ((~Number(netmaskParts[i]) & 0xFF) | Number(e)).toString()).join('.');
            if (addr === broadcast) {
              addresses[ip] = true;
            }
          });
          const skipAddress = Object.keys(addresses).find((addr) => addr === ip);
          if (skipAddress === undefined) {
            pluginAddresses[ip] = '255.255.255.255';
          } else {
            this.log.debug('AC Unit (%s) is already on broadcast list - skipping', skipAddress);
          }
        } else {
          this.log.warn('Warning: Invalid IP address found in configuration: %s - skipping', ip);
        }
      });
    }
    return pluginAddresses;
  }

  public getAccessory(mac: string) {
    return this.devices[mac];
  }

  // accessory specific functions
  sendBindRequest(ac: GreeAirConditioner) {
    const message = {
      mac: ac.accessory.context.device.mac,
      t: 'bind',
      uid: 0,
    };
    this.log.debug(`[${ac.getDeviceLabel()}] Bind to device -> ${ac.accessory.context.device.mac}`);
    ac.sendMessage(message);
  }

  checkBindingStatus(bindNo: number, ac: GreeAirConditioner) {
    if (!ac.accessory.bound) {
      this.log.debug(`[${ac.getDeviceLabel()}] Device binding timeout`);
      switch (bindNo){
      case 1:
        // 1. timeout -> repeat bind request with alternate encryption version
        if (ac.accessory.context.device.encryptionVersion === 1) {
          ac.accessory.context.device.encryptionVersion = 2;
        } else {
          ac.accessory.context.device.encryptionVersion = 1;
        }
        this.sendBindRequest(ac);
        setTimeout(this.checkBindingStatus.bind(this, bindNo + 1, ac), BINDING_TIMEOUT);
        break;
      default:
        this.log.error(`[${ac.getDeviceLabel()}] Error: Device is not bound`,
          '(unknown device type or device is malfunctioning [turning the power supply off and on may help])',
          '- Restart homebridge when issue has fixed!');
        break;
      }
    }
  }

  handleACMessage = (ac: GreeAirConditioner, socket: Socket, msg: Buffer,
    rinfo: {address: string, family: string, port: number, size: number}) => {
    if (ac.accessory.context.device.address === rinfo.address) {
      this.log.debug(`[${ac.getDeviceLabel()}] handleMessage -> %s`, msg.toString());
      const message = JSON.parse(msg.toString());
      this.log.debug(`[${ac.getDeviceLabel()}] handleMessage -> Encryption version: %i`,
        ac.accessory.context.device.encryptionVersion);
      if (!message.pack) {
        this.log.debug(`[${ac.getDeviceLabel()}] handleMessage - Unknown message: %j`, message);
        this.log.warn(`[${ac.getDeviceLabel()}] Warning: handleMessage - Unknown response from device`);
        return;
      }
      let pack;
      if (ac.accessory.context.device.encryptionVersion === 1) {
        pack = crypto.decrypt_v1(message.pack, message.i === 1 ? undefined : ac.key);
      } else if (ac.accessory.context.device.encryptionVersion === 2 && message.tag !== undefined) {
        pack = crypto.decrypt_v2(message.pack, message.tag, message.i === 1 ? undefined : ac.key);
      } else {
        this.log.debug(`[${ac.getDeviceLabel()}] handleMessage - Unknown message: %j`, message);
        this.log.warn(`[${ac.getDeviceLabel()}] Warning: handleMessage - Unknown response from device`);
        return;
      }
      this.log.debug(`[${ac.getDeviceLabel()}] handleMessage - Package -> %j`, pack);
      switch ((pack.t as string).toLowerCase()) {
      case 'bindok': // package type is binding confirmation
        if(!ac.accessory.bound) {
          this.log.debug(`[${ac.getDeviceLabel()}] Device binding in progress`);
          ac.key = pack.key;
          this.log.debug(`[${ac.getDeviceLabel()}] Device key -> ${ac.key}`);
          ac.requestDeviceStatus();
        }
        break;
      case 'dat': // package type is device status
      case 'res': // package type is response
        if (!ac.accessory.bound) {
          ac.accessory.bound = true;
          ac.initAccessory();
          this.log.success(`[${ac.getDeviceLabel()}] Device is bound -> ${ac.accessory.context.device.mac}`);
          socket.on('message', ac.handleMessage);
          socket.off('message', this.handleACMessage);
          ac.requestDeviceStatus();
          setInterval(ac.requestDeviceStatus.bind(ac), ac.deviceConfig.statusUpdateInterval * 1000);
        }
        break;
      default:
        this.log.debug(`[${ac.getDeviceLabel()}] handleMessage - Unknown message: %j`, message);
        this.log.warn(`[${ac.getDeviceLabel()}] Warning: handleMessage - Unknown response from device`);
        break;
      }
    }
  };
}
