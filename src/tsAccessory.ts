import { Service, CharacteristicValue } from 'homebridge';

import { GreeACPlatform, MyPlatformAccessory } from './platform';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class GreeAirConditionerTS {
  public TemperatureSensor: Service;
  private currentTemperature = 25;

  constructor(
    private readonly platform: GreeACPlatform,
    private readonly accessory: MyPlatformAccessory,
  ) {
    // register accessory in homebridge by api if not registered before
    if (!this.accessory.registered) {
      this.platform.log.debug(`[${this.getDeviceLabel()}] registering new accessory in homebridge:`, this.accessory.context.device.mac,
        this.accessory.UUID);
      this.platform.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.accessory]);
      // set static accessory information
      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, this.accessory.context.device.brand || 'Gree')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.mac)
        .setCharacteristic(this.platform.Characteristic.Model,
          this.accessory.context.device.model || this.accessory.context.device.name || 'Air Conditioner')
        .setCharacteristic(this.platform.Characteristic.HardwareRevision,
          this.accessory.context.device.ver ?
            this.accessory.context.device.ver.substring(this.accessory.context.device.ver.lastIndexOf('V') + 1) : '1.0.0')
        .setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);
    }

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision,
        this.accessory.context.device.hid && this.accessory.context.device.hid.lastIndexOf('V') >= 0 &&
        this.accessory.context.device.hid.lastIndexOf('V') < this.accessory.context.device.hid.lastIndexOf('.') ?
          this.accessory.context.device.hid.substring(this.accessory.context.device.hid.lastIndexOf('V') + 1,
            this.accessory.context.device.hid.lastIndexOf('.')) : '1.0.0');

    this.platform.api.updatePlatformAccessories([this.accessory]);

    // get the TemperatureSensor service if it exists, otherwise create a new TemperatureSensor service
    // we don't use subtype because we add only one service with this type
    this.TemperatureSensor = this.accessory.getService(this.platform.Service.TemperatureSensor) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, this.accessory.displayName, undefined);

    // register handlers for the Current Temperature Characteristic
    this.TemperatureSensor.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));
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
  async getCurrentTemperature(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.getDeviceLabel()}] Get CurrentTemperature ->`, this.currentTemperature);
    return this.currentTemperature;
  }

  // helper functions

  public setCurrentTemperature(value: number) {
    this.currentTemperature = value;
    this.platform.log.debug(`[${this.getDeviceLabel()}] updateStatus (Current Temperature) ->`, this.currentTemperature);
  }

  getDeviceLabel() {
    return `${this.accessory.displayName} -- ${this.accessory.context.device.address}:${this.accessory.context.device.port}`;
  }
}
