import dgram from 'dgram';
import crypto from './crypto';
import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic, Categories } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME, UDP_SCAN_PORT, DEFAULT_DEVICE_CONFIG } from './settings';
import { GreeAirConditioner } from './platformAccessory';

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
  private socket: dgram.Socket;
  private timer: NodeJS.Timeout | undefined;
  private scanCount: number;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.socket = dgram.createSocket({type: 'udp4', reuseAddr: true});
    this.devices = {};
    this.initializedDevices = {};
    this.scanCount = 0;
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.socket.on('message', this.handleMessage);
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache: ', accessory.displayName, accessory.context.device);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    if (accessory.context.device?.mac) {
      this.devices[accessory.context.device.mac] = accessory;
    }
  }

  /**
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    this.socket.bind(this.config.port, () => {
      this.log.info(`UDP server bind to port ${this.config.port}`);
      this.socket.setBroadcast(true);
      this.timer = setInterval(() => {
        this.scanCount += 1;
        if (this.scanCount > this.config.scanCount && this.timer) {
          this.log.info('Scan finished.');
          clearInterval(this.timer);
          this.socket.close();
        } else {
          this.broadcastScan();
        }
      }, this.config.scanTimeout * 1000); // scanTimeout in seconds
    });
  }

  handleMessage = (msg, rinfo) => {
    this.log.debug('handleMessage', msg.toString());
    try {
      const message = JSON.parse(msg.toString());
      if (message.i !== 1 || message.t !== 'pack') {
        return;
      }
      const pack = crypto.decrypt(message.pack);
      if (pack.t === 'dev') {
        this.registerDevice({
          ...pack,
          address: rinfo.address,
          port: rinfo.port,
        });
      }
    } catch (err) {
      this.log.error('handleMessage Error', err);
    }
  };

  registerDevice = (deviceInfo) => {
    const devcfg = this.config.devices.find((item) => item.mac === deviceInfo.mac) || {};
    const deviceConfig = {
      ...devcfg,
      ...((devcfg.speedSteps && devcfg.speedSteps !== 3 && devcfg.speedSteps !== 5) || devcfg.speedSteps === 0 ?
        {speedSteps: 5} : {}),
    };
    Object.entries(DEFAULT_DEVICE_CONFIG).forEach(([key, value]) => {
      if (deviceConfig[key] === undefined) {
        deviceConfig[key] = value;
      }
    });
    let accessory = this.devices[deviceInfo.mac];

    if (deviceConfig?.disabled) {
      this.log.info(`accessory ${deviceInfo.mac} skipped`);
      if (accessory) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        delete this.devices[deviceConfig.mac];
      }
      return;
    }

    if (accessory && this.initializedDevices[accessory.UUID]) {
      return;
    }

    if (!accessory) {
      const deviceName = deviceConfig?.name ?? (deviceInfo.name || deviceInfo.mac);
      this.log.debug(`Initializing new accessory ${deviceInfo.mac} with name ${deviceName}...`);
      const uuid = this.api.hap.uuid.generate(deviceInfo.mac);
      accessory = new this.api.platformAccessory(deviceName, uuid, Categories.AIR_CONDITIONER);

      this.devices[deviceInfo.mac] = accessory;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    if (accessory) {
      // mark devices as initialized.
      accessory.context.device = deviceInfo;
      this.initializedDevices[accessory.UUID] = true;
      return new GreeAirConditioner(this, accessory, deviceConfig, this.config.port as number);
    }
  };

  broadcastScan() {
    const message = Buffer.from(JSON.stringify({ t: 'scan' }));
    this.socket.send(message, 0, message.length, UDP_SCAN_PORT, this.config.scanAddress, (error) => {
      this.log.debug(`Broadcast '${message}' ${this.config.scanAddress}:${UDP_SCAN_PORT}`);
      if (error) {
        this.log.error(error.message);
      }
    });
  }
}
