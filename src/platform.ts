import dgram from 'dgram';
import crypto from './crypto';
import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic, Categories } from 'homebridge';
import { networkInterfaces } from 'os';
import { readFileSync } from 'fs';

import { PLATFORM_NAME, PLUGIN_NAME, UDP_SCAN_PORT, DEFAULT_DEVICE_CONFIG, MODIFY_VERTICAL_SWING_POSITION, ENCRYPTION_VERSION, TS_TYPE,
  DEF_SCAN_INTERVAL, TEMPERATURE_LIMITS, TEMPERATURE_STEPS} from './settings';
import { GreeAirConditioner } from './platformAccessory';
import commands from './commands';
import { version } from './version';

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
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  private devices: Record<string, MyPlatformAccessory>;
  private processedDevices: Record<string, boolean>;
  private skippedDevices: Record<string, boolean>;
  private socket: dgram.Socket;
  private pluginAddresses: Record<string, string> = {};
  public ports: number[] = [];
  private tempUnit: string;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.devices = {};
    this.processedDevices = {};
    this.skippedDevices = {};
    this.pluginAddresses = this.getNetworkAddresses();
    if (Object.entries(this.pluginAddresses).length > 0) {
      this.log.debug('Device detection address list {(address : netmask) pairs}:', this.pluginAddresses);
    } else {
      this.log.error('Error: Homebridge host has no IPv4 address');
    }
    // if no IPv4 address found we create socket for IPv6
    this.socket = dgram.createSocket({type: (Object.entries(this.pluginAddresses).length > 0) ? 'udp4' : 'udp6', reuseAddr: true});
    this.socket.on('error', (err) => {
      this.log.error('Network - Error:', err.message);
    });
    this.socket.on('close', () => {
      this.log.debug('Network - Connection closed');
    });
    // get temperature unit from Homebridge UI config
    const configPath = this.api.user.configPath();
    const cfg = JSON.parse(readFileSync(configPath).toString());
    const configPlatform = cfg?.platforms?.find((item) => item.platform === 'config') || {};
    this.tempUnit = configPlatform?.tempUnits || 'f';
    if (!['f', 'c'].includes(this.tempUnit)) {
      this.tempUnit = 'f';
    }
    this.log.debug(`Temperature display unit is ${this.tempUnit === 'f' ? 'Fahrenheit (°F)' : 'Celsius (°C)'}`);
    this.log.debug('Finished initializing platform');

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
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
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: MyPlatformAccessory) {
    this.log.debug('Loading accessory from cache:', accessory.displayName, JSON.stringify(accessory.context.device));

    // add the restored accessory to the accessories cache so we can track if it has already been registered
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

  handleMessage = (msg, rinfo) => {
    this.log.debug('handleMessage -> %s', msg.toString());
    try {
      let message;
      try{
        message = JSON.parse(msg.toString());
      } catch (e){
        this.log.debug('handleMessage - unknown message from %s - BASE64 encoded message: %s', rinfo.address.toString(),
          Buffer.from(msg).toString('base64'));
        return;
      }
      if (message.i !== 1 || message.t !== 'pack') {
        this.log.debug('handleMessage - unknown response from %s: %j', rinfo.address.toString(), message);
        return;
      }
      let pack, encryptionVersion:number;
      if (message.tag === undefined) {
        this.log.debug('handleMessage -> Encryption version: 1');
        pack = crypto.decrypt_v1(message.pack);
        encryptionVersion = 1;
      } else {
        this.log.debug('handleMessage -> Encryption version: 2');
        pack = crypto.decrypt_v2(message.pack, message.tag);
        encryptionVersion = 2;
      }
      this.log.debug('handleMessage - Package -> %j', pack);
      if (encryptionVersion === 1 && pack.t === 'dev' && pack.ver && !pack.ver.toString().startsWith('V1.')) {
        // some devices respond to scan command with V1 encryption but binding requires V2 encryption
        // we set encryption to V2 if device version is not V1.x
        encryptionVersion = 2;
      }
      if (pack.t === 'dev') {
        this.registerDevice({
          ...pack,
          address: rinfo.address,
          port: rinfo.port,
          encryptionVersion,
        });
      } else {
        this.log.debug('handleMessage - unknown package from %s: %j', rinfo.address.toString(), pack);
      }
    } catch (err) {
      const msg = (err as Error).message;
      this.log.error('handleMessage (%s) - Error: %s', rinfo.address.toString(), msg);
    }
  };

  registerDevice = (deviceInfo) => {
    this.log.debug('registerDevice - deviceInfo:', JSON.stringify(deviceInfo));
    const devcfg = this.config.devices?.find((item) => item.mac === deviceInfo.mac) || {};
    const deviceConfig = {
      // parameters read from config
      ...devcfg,
      // fix incorrect values read from config but do not add any value if parameter is missing
      ...((devcfg.speedSteps && devcfg.speedSteps !== 3 && devcfg.speedSteps !== 5) || devcfg.speedSteps === 0 ?
        {speedSteps: DEFAULT_DEVICE_CONFIG.speedSteps} : {}),
      ...(devcfg.temperatureSensor && Object.values(TS_TYPE).includes((devcfg.temperatureSensor as string).toLowerCase()) ?
        {temperatureSensor: (devcfg.temperatureSensor as string).toLowerCase()}
        : (devcfg.temperatureSensor ? {temperatureSensor: DEFAULT_DEVICE_CONFIG.temperatureSensor} : {})),
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
    Object.entries(this.config.devices?.find((item) => item.mac?.toLowerCase() === 'default' && !item.disabled) || {})
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
    if (deviceConfig.overrideDefaultVerticalSwing !== undefined && !deviceConfig.modifyVerticalSwingPosition) {
      // found deprecated but missing new
      this.log.warn('Deprecated configuration parameter found: overrideDefaultVerticalSwing - ' +
        `Accessory ${deviceInfo.mac} parameter value: ${deviceConfig.overrideDefaultVerticalSwing} -> use modifyVerticalSwingPosition`);
      deviceConfig.modifyVerticalSwingPosition = deviceConfig.overrideDefaultVerticalSwing;
      delete deviceConfig.overrideDefaultVerticalSwing;
    } else if (deviceConfig.overrideDefaultVerticalSwing !== undefined && deviceConfig.modifyVerticalSwingPosition !== undefined) {
      // found both deprecated and new -> keep new only
      this.log.warn('Deprecated configuration parameter found: overrideDefaultVerticalSwing - ' +
        `Accessory ${deviceInfo.mac} parameter value: ${deviceConfig.overrideDefaultVerticalSwing} -> ignoring`);
      delete deviceConfig.overrideDefaultVerticalSwing;
    }
    // force encryption version if set in config
    if (deviceConfig.encryptionVersion !== ENCRYPTION_VERSION.auto) {
      deviceInfo.encryptionVersion = deviceConfig.encryptionVersion;
      this.log.debug(`Accessory ${deviceInfo.mac} encryption version forced:`, deviceInfo.encryptionVersion);
    }

    let accessory: MyPlatformAccessory | undefined = this.devices[deviceInfo.mac];
    let accessory_ts: MyPlatformAccessory | undefined = this.devices[deviceInfo.mac + '_ts'];

    if (deviceConfig?.disabled || !/^[a-f0-9]{12}$/.test(deviceConfig?.mac || '000000000000')) { //do not skip unconfigured devices
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
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory_ts]);
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
      new GreeAirConditioner(this, accessory, deviceConfig, accessory_ts?.context.device.mac);
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

  getNetworkAddresses() {
    this.log.debug('Checking network interfaces');
    const pluginAddresses = {};
    const allInterfaces = networkInterfaces();
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
    // Add IPs from configuration but only if at least one host address found
    if (Object.keys(pluginAddresses).length > 0) {
      const devcfgs:[] = this.config.devices?.filter((item) => item.ip && !item.disabled) || [];
      devcfgs.forEach((value) => {
        const ip: string = value['ip'];
        const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})(\.(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})){3}$/;
        if (ipv4Pattern.test(ip)) {
          this.log.debug('Found AC Unit address in configuration:', ip);
          const addrParts = ip.split('.');
          const addresses = {};
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
}
