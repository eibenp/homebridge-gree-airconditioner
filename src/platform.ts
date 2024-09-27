import dgram from 'dgram';
import crypto from './crypto';
import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic, Categories } from 'homebridge';
import { networkInterfaces } from 'os';

import { PLATFORM_NAME, PLUGIN_NAME, UDP_SCAN_PORT, DEFAULT_DEVICE_CONFIG, OVERRIDE_DEFAULT_SWING, ENCRYPTION_VERSION } from './settings';
import { GreeAirConditioner } from './platformAccessory';
import { GreeAirConditionerTS } from './tsAccessory';
import commands from './commands';
import { version } from './version';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class GreeACPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  private devices: Record<string, PlatformAccessory>;
  private initializedDevices: Record<string, boolean>;
  private skippedDevices: Record<string, boolean>;
  private socket: dgram.Socket;
  private timer: NodeJS.Timeout | undefined;
  private scanCount: number;
  private pluginAddresses: Record<string, string> = {};

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.devices = {};
    this.initializedDevices = {};
    this.skippedDevices = {};
    this.scanCount = 0;
    this.pluginAddresses = this.getNetworkAddresses();
    if (Object.entries(this.pluginAddresses).length > 0) {
      this.log.debug('Homebridge host addresses: ', this.pluginAddresses);
    } else {
      this.log.error('Error: Homebridge host has no IPv4 address');
    }
    // if no IPv4 address found we create socket for IPv6
    this.socket = dgram.createSocket({type: (Object.entries(this.pluginAddresses).length > 0) ? 'udp4' : 'udp6', reuseAddr: true});
    this.log.debug('Finished initializing platform');

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      if (Object.entries(this.pluginAddresses).length === 0) {
        this.socket.close();
        this.cleanAccessories(true);
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
  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug('Loading accessory from cache:', accessory.displayName, accessory.context.device);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    if (accessory.context.device?.mac) {
      accessory.context.bound = false;
      this.devices[accessory.context.device.mac] = accessory;
    }
    // clean all invalid accessories found in cache
    if (!accessory.context) {
      this.log.debug('Invalid accessory found in cache - deleting:', accessory.displayName, accessory.UUID);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  /**
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  cleanAccessories(err = false) {
    // remove accessories not found on network or not responding to bind request
    Object.entries(this.devices).forEach(([key, value]) => {
      if (value && ((!value.context.bound && this.initializedDevices[value.UUID]) || err) &&
        (value.context.deviceType === 'HeaterCooler' || value.context.deviceType === undefined)) {
        if (!err) {
          this.log.warn('Warning: Device not bound: %s [%s -- %s:%s]', value.context.device.mac, value.displayName,
            value.context.device.address, value.context.device.port);
        } else {
          this.log.debug('Cleanup -> Previous error started cleanup of', value.displayName, key, value.UUID);
        }
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [value]);
        this.log.debug('Cleanup -> unregisterPlatformAccessories', value.displayName, key, value.UUID);
        delete this.initializedDevices[value.UUID];
      }
      if (value && ((!value.context.bound && this.initializedDevices[value.UUID]) || err) &&
        value.context.deviceType === 'TemperatureSensor') {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [value]);
        this.log.debug('Cleanup -> unregisterPlatformAccessories', value.displayName, key, value.UUID);
        delete this.initializedDevices[value.UUID];
      }
      if (value && !value.context && this.initializedDevices[value.UUID]) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [value]);
        this.log.debug('Cleanup -> unregisterPlatformAccessories', value.displayName, key, value.UUID);
        delete this.initializedDevices[value.UUID];
      }
      if (value && !this.initializedDevices[value.UUID]) {
        this.log.debug('Cleanup -> Remove', value.displayName, key, value.UUID);
        delete this.devices[key];
      }
    });
  }

  bindCallback() {
    this.log.info(`${PLATFORM_NAME} (${PLUGIN_NAME}) v%s is running on UDP port %d`, version, this.socket.address().port);
    this.socket.setBroadcast(true);
    this.timer = setInterval(() => {
      this.scanCount += 1;
      if (this.scanCount > this.config.scanCount && this.timer) {
        this.log.info('Scan finished.');
        clearInterval(this.timer);
        this.socket.close();
        this.cleanAccessories(false);
      } else {
        this.broadcastScan();
      }
    }, this.config.scanTimeout * 1000); // scanTimeout in seconds
  }

  discoverDevices() {
    if (this.config.port === undefined || (this.config.port !== undefined && typeof this.config.port === 'number' &&
      this.config.port === this.config.port && this.config.port >= 0 && this.config.port <= 65279)) {
      this.socket.bind(this.config.port, undefined, () => this.bindCallback());
    } else {
      this.log.error('Error: Port is misconfigured (Valid port values: 1025~65279 or leave port empty to auto select)');
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
      if (encryptionVersion === 1 && pack.t === 'dev' && pack.ver && pack.ver.toString().startsWith('V2.')) {
        // first V2 version responded to scan command with V1 encryption but binding requires V2 encryption
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
    this.log.debug('registerDevice - deviceInfo:', deviceInfo);
    const devcfg = this.config.devices.find((item) => item.mac === deviceInfo.mac) || {};
    const deviceConfig = {
      ...devcfg,
      ...((devcfg.speedSteps && devcfg.speedSteps !== 3 && devcfg.speedSteps !== 5) || devcfg.speedSteps === 0 ?
        {speedSteps: 5} : {}),
      ...((devcfg.temperatureSensor && ['disabled', 'child', 'separate'].includes((devcfg.temperatureSensor as string).toLowerCase())) ?
        {temperatureSensor: (devcfg.temperatureSensor as string).toLowerCase()} : {temperatureSensor: 'disabled'}),
      ...(devcfg.minimumTargetTemperature && (devcfg.minimumTargetTemperature < DEFAULT_DEVICE_CONFIG.minimumTargetTemperature ||
        devcfg.minimumTargetTemperature > DEFAULT_DEVICE_CONFIG.maximumTargetTemperature) ?
        { minimumTargetTemperature: DEFAULT_DEVICE_CONFIG.minimumTargetTemperature } : {}),
      ...(devcfg.maximumTargetTemperature && (devcfg.maximumTargetTemperature < DEFAULT_DEVICE_CONFIG.minimumTargetTemperature ||
        devcfg.maximumTargetTemperature > DEFAULT_DEVICE_CONFIG.maximumTargetTemperature) ?
        { maximumTargetTemperature: DEFAULT_DEVICE_CONFIG.maximumTargetTemperature } : {}),
      ...((devcfg.defaultVerticalSwing && ![commands.swingVertical.value.default, commands.swingVertical.value.fixedHighest,
        commands.swingVertical.value.fixedHigher, commands.swingVertical.value.fixedMiddle, commands.swingVertical.value.fixedLower,
        commands.swingVertical.value.fixedLowest].includes(devcfg.defaultVerticalSwing)) ?
        { defaultVerticalSwing: DEFAULT_DEVICE_CONFIG.defaultVerticalSwing } : {}),
      ...((devcfg.overrideDefaultVerticalSwing && !Object.values(OVERRIDE_DEFAULT_SWING).includes(devcfg.overrideDefaultVerticalSwing)) ?
        { overrideDefaultVerticalSwing: DEFAULT_DEVICE_CONFIG.overrideDefaultVerticalSwing } : {}),
      ...((devcfg.encryptionVersion && !Object.values(ENCRYPTION_VERSION).includes(devcfg.encryptionVersion)) ?
        { encryptionVersion: DEFAULT_DEVICE_CONFIG.encryptionVersion } : {}),
    };
    Object.entries(DEFAULT_DEVICE_CONFIG).forEach(([key, value]) => {
      if (deviceConfig[key] === undefined) {
        deviceConfig[key] = value;
      }
    });
    // force encryption version if set in config
    if (deviceConfig.encryptionVersion !== ENCRYPTION_VERSION.auto) {
      deviceInfo.encryptionVersion = deviceConfig.encryptionVersion;
      this.log.debug(`Accessory ${deviceInfo.mac} encryption version forced:`, deviceInfo.encryptionVersion);
    }
    let accessory = this.devices[deviceInfo.mac];
    let accessory_ts = this.devices[deviceInfo.mac + '_ts'];

    if (deviceConfig?.disabled || !/^[a-f0-9]{12}$/.test(deviceConfig.mac)) {
      if (!this.skippedDevices[deviceInfo.mac]) {
        this.log.info(`Accessory ${deviceInfo.mac} skipped`);
        this.skippedDevices[deviceInfo.mac] = true;
      }
      if (accessory) {
        delete this.devices[accessory.context.deviceInfo.mac];
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.log.debug('registerDevice - unregister:', accessory.displayName, accessory.UUID);
      }
      if (accessory_ts) {
        delete this.devices[accessory_ts.context.deviceInfo.mac];
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory_ts]);
        this.log.debug('registerDevice - unregister:', accessory_ts.displayName, accessory_ts.UUID);
      }
      return;
    }

    if (accessory && this.initializedDevices[accessory.UUID]) {
      // already initalized
      this.log.debug('registerDevice - already initalized:', accessory.displayName, accessory.UUID, accessory.context.device.mac);
      return;
    }

    if (!accessory) {
      const deviceName = deviceConfig?.name ?? (deviceInfo.name || deviceInfo.mac);
      this.log.debug(`Initializing new accessory ${deviceInfo.mac} with name ${deviceName} ...`);
      const uuid = this.api.hap.uuid.generate(deviceInfo.mac);
      accessory = new this.api.platformAccessory(deviceName, uuid, Categories.AIR_CONDITIONER);

      this.devices[deviceInfo.mac] = accessory;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    if (!accessory_ts && deviceConfig.temperatureSensor === 'separate') {
      const deviceName = 'Temperature Sensor - ' + (deviceConfig?.name ?? (deviceInfo.name || deviceInfo.mac));
      this.log.debug(`Initializing new accessory ${deviceInfo.mac}_ts with name ${deviceName} ...`);
      const uuid = this.api.hap.uuid.generate(deviceInfo.mac + '_ts');
      accessory_ts = new this.api.platformAccessory(deviceName, uuid, Categories.SENSOR);

      this.devices[deviceInfo.mac + '_ts'] = accessory_ts;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory_ts]);
    }

    if (accessory_ts && deviceConfig.temperatureSensor !== 'separate') {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory_ts]);
      delete this.devices[deviceInfo.mac + '_ts'];
      this.log.debug('registerDevice - unregister:', accessory_ts.displayName, accessory_ts.UUID);
    }

    let tsService: GreeAirConditionerTS|null = null;
    if (accessory_ts && deviceConfig.temperatureSensor === 'separate') {
      // mark temperature sensor devices as initialized
      accessory_ts.context.device = { ...deviceInfo };
      accessory_ts.context.device.mac = deviceInfo.mac + '_ts';
      accessory_ts.context.deviceType = 'TemperatureSensor';
      this.initializedDevices[accessory_ts.UUID] = true;
      tsService = new GreeAirConditionerTS(this, accessory_ts, deviceConfig);
      this.log.debug(`registerDevice - ${accessory_ts.context.deviceType} initialized:`, accessory_ts.displayName,
        accessory_ts.context.device.mac, accessory_ts.UUID);
    }

    if (accessory) {
      // mark devices as initialized
      accessory.context.device = deviceInfo;
      accessory.context.deviceType = 'HeaterCooler';
      this.initializedDevices[accessory.UUID] = true;
      this.log.debug(`registerDevice - ${accessory.context.deviceType} initialized:`, accessory.displayName,
        accessory.context.device.mac, accessory.UUID);
      return new GreeAirConditioner(this, accessory, deviceConfig, this.config.port as number, tsService);
    }
  };

  broadcastScan() {
    const message = Buffer.from(JSON.stringify({ t: 'scan' }));
    Object.entries(this.pluginAddresses).forEach((value) => {
      this.socket.send(message, 0, message.length, UDP_SCAN_PORT, value[0], (error) => {
        this.log.debug(`Broadcast '${message}' ${value[0]}:${UDP_SCAN_PORT}`);
        if (error) {
          this.log.error('broadcastScan - Error:', error.message);
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
            pluginAddresses[broadcast] = pluginAddresses[broadcast] === undefined ? iface.address :
              pluginAddresses[broadcast] + ';' + iface.address;
          }
        }
      }
    }
    // Sort IP addresses for consistent comparison
    for (const bcast of Object.keys(pluginAddresses)) {
      // Keep only unique IPs
      const ips = Array.from(new Set(pluginAddresses[bcast].split(';') as string[]));
      ips.sort((a, b) => (a < b ? -1 : 1));
      pluginAddresses[bcast] = ips.join(';');
    }
    return pluginAddresses;
  }
}
