[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm](https://badgen.net/npm/v/homebridge-gree-ac/latest?icon=npm&label)](https://www.npmjs.com/package/homebridge-gree-ac)
[![npm](https://badgen.net/npm/dt/homebridge-gree-ac?label=downloads)](https://www.npmjs.com/package/homebridge-gree-ac)
[![Donate](https://badgen.net/badge/donate/paypal/yellow)](https://paypal.me/eibenp)

> _*** Breaking changes ***_
> 
> Please read the [**Upgrade section**](#upgrade) before upgrading from version earlier than **v2.0.0** !

# Homebridge GREE Air Conditioner Platform Plugin

[Homebridge GREE Air Conditioner Platform Plugin](https://github.com/eibenp/homebridge-gree-airconditioner) is a dynamic platform plugin for [Homebridge](https://github.com/homebridge/homebridge) which allows control of GREE Air Conditioner devices from [Apple's Home App](https://www.apple.com/home-app/). (Make GREE Air Conditioner HomeKit compatible.)

You can add all of your GREE Air Conditioner devices to the Home App by specifying the network broadcast address, and Homebridge will find all connected devices. Each device appears in the Home App as a Heater Cooler device. It is also possible to add a separate Termperature Sensor (if temperature sensor is supported by the physical device). This allows to define automations (e.g. turn on) based on current temperature in the room. Be careful, if the device does not support internal temperature sensor but is added as a separate accessory, Home App will display the target temperature not the measured one. Child accessory does not appear in Home App if physical sensor is not available in the AC unit.

Quiet / Auto / Powerful mode is supported by the fan speed control. Zero means off. Minimum value turns on Quiet mode. Next value is Auto mode. Maximum value is Powerful mode. All other values between them are exact fan speeds (Low, MediumLow**, Medium, MediumHigh**, High)

** these values are supported only on 5-speed models

You have to add all devices to the Homebridge configuration, so that you can control all their parameters. If you don't want to control all of the devices in Home App, then you need to add to the configuration and disable the ones you don't need. Devices are identified by MAC Address (Serial Number). It can be queried using the official [GREE+ mobile app](https://apps.apple.com/us/app/gree/id1167857672). (The app is required to connect the devices to the local WiFi network for the first time.)

xFan function is also supported, but it works automatically if enabled in Homebridge configuration. If xFan is enabled for the device, it is automatically turned on when you select a supported operating mode in Home App. If xFan is disabled, the Home App will not modify its actual setting in any case.

Temperature display units of the physical device can be controlled using the Home App. (Configuration settings are required to be specified always in Degrees Celsius, independently from the display units.)

Vertical swing mode can be turned on/off, but special swing settings can't be controlled using the Home App. If device default vertical swing position is not acceptable in disabled swing mode it can be overridden to a pre selected position by configuration settings. (Only default position is overridden when this feature is enabled. Other positions selected by remote control are kept and not modified by Home App.)

This plugin is designed to be as simple and clear as possible and supports primarily the functions of the Home App's Heater Cooler accessory.

## Requirements

* Node.js (>= 18.15.0 || >= 20.8.0) with NPM
* Homebridge (>= 1.8.0)

You need to specify the local network broadcast address (192.168.1.255 in many home environments) and it is also recommended to add the device and specify its MAC address (Serial Number) in the configuration file. Homebridge and all AC units have to be on the same subnet.

It is highly recommended to use static IP addresses for connected devices. Using a dynamic IP address may require a restart of the Homebridge service on an address change to reconnect the device. Most routers offer static DHCP leases. (Please look at your router's documentation!)

## Supported devices

* GREE Air Conditioners with WiFi support (hardware version v1.x.x and v2.x.x)
* May work with other GREE compatible AC units (e.g. Sinclair)
    * Successfully tested with Sinclair SIH-13BITW
 
> If you get _"error:1C80006B:Provider routines::wrong final block length"_ error message then your device is not supported.
>
> If you get _"Device not bound:..."_ warning message then your device is not supported.

By default this plugin tries to auto detect the network protocol encryption version. If not the right version is selected there can get errors and the AC device will not correctly work. It is possible to force a network protocol encryption version in configuration file. If auto detection does not work then it is recommended to try all possible values to check if the device is compatible or not.

## Known limitations

This plugin was designed to support the Home App's Heater Cooler functionality using GREE Air Conditioners. Some special features of GREE AC's are not supported natively by Apple and also dismiss support in this plugin.
* Fan and dry modes are not supported. They may work if set directly on the device until you change operating mode. They can't be turned on using Home App.
* Lights of the AC unit can't be controlled.
* Additional device functions (e.g. health mode, sleep, SE) are not supported.
* Horizontal swing control is not supported, it remains the same as set directly on the device.
* GREE AC units do not support temperature ranges in auto mode, so temperature ranges have zero length in Home App.
* GREE AC units are not able to display decimals of temperature values (if set to half a degree, e.g. 21.5 °C, then unit display may not be in sync with temperature set in Home App).
* Not all half a degree values are supported in °C mode (GREE AC units are designed to support only integer °C and °F values). Unsupported values are automatically updated to the nearest supported values.
* There is no way to get current heating-cooling state from the AC unit in auto mode, so displayed state in the Home App is based on temperature measurement, but internal sensor is not precise enough to always display the correct state.
* Cooling / Heating temperature threshold limits (minimum and maximum values) can only be set in active cooling / heating mode. So the gauge in Home App may show invalid minimum and maximum values for the first use of cooling and heating modes. If so please restart Home App. Next time the correct values will be displayed.
* Homebridge and AC unit on different subnets is a not supported configuration.
* Devices without a built-in temperature sensor display the target temperature as current temperature not the measured one. (Some AC firmware versions do not report the measured temperature but the unit has a built-in sensor. They are handled by the plugin as devices without a sensor.)

## Installation instructions

It is recommended to install the plugin using the graphical user interface of Homebridge ([Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x)). You can find the plugin if you search on the Plugins page for GREE Air Conditioner ('GREE AC' or 'homebridge-gree-ac' if you'd like an exact match). It is recommended to configure the plugin using the same GUI controls.

Command line install:
```
npm install homebridge-gree-ac -g
```
If successfully installed and configured, your devices will appear on the Homebridge GUI Accessories page and also in Home App (if Homebridge is already connected to the Home App). (If the additional temperature sensor is enabled, then 2 items will be displayed for supported devices (Heater Cooler and Temperature Sensor).)

## Upgrade

There is no clean way to update the plugin to release v2.0.0 or later if you are using an older version (v1.x.x). You need to remove and reinstall the plugin during upgrade.

### Upgrade steps

1. Check out your current settings in Homebridge and also in Homekit (including scenes and automation rules)
2. Uninstall the old version (this will remove all settings also)
3. Install the new version
4. Configure plugin in Homebridge
5. Assign accessories to rooms and recreate scenes and automations in Homekit

## Example configuration
_Only the relevant part of the configuration file is displayed:_
```
    "platforms": [
        {
            "name": "Gree Air Conditioner",
            "platform": "GREEAirConditioner",
            "port": 7002,
            "scanAddress": "192.168.1.255",
            "scanCount": 5,
            "scanTimeout": 10,
            "devices": [
                {
                    "mac": "502cc6000000",
                    "name": "Living room AC",
                    "model": "Pulse 3.2kW GWH12AGB-K6DNA1A/I",
                    "speedSteps": 5,
                    "encryptionVersion": 0,
                    "statusUpdateInterval": 10,
                    "sensorOffset": 40,
                    "minimumTargetTemperature": 16,
                    "maximumTargetTemperature": 30,
                    "xFanEnabled": true,
                    "temperatureSensor": "disabled",
                    "overrideDefaultVerticalSwing": 0,
                    "defaultVerticalSwing": 0,
                    "disabled": false
                }
            ]
        }
    ]
```
* name - Unique name of the platform plugin
* platform - **GREEAirConditioner** (fixed name, it identifies the plugin)
* port - free UDP port (homebridge will use this port for network communication; it is recommended to select a port which is not used and the next 256 ports are also available because devices will be bound to a separate port based on the last part of the device's IPv4 address and the port specified in the configuration; valid values: 1025 - 65279)
* scanAddress - local network broadcast address (some network knowledge is required to determine this address; in many cases its default value is 192.168.1.255)
* scanCount - number of retries for locating devices on the network (minimum 3 retries have to be specified)
* scanTimeout - time period in seconds between device query retries
* devices - devices should be listed in this block (specify as many devices as you have on your network)
* mac - MAC address (Serial Number) of the device
* name - custom name of the device (optional)
* model - model name, information only (optional)
* speedSteps - fan speed steps of the unit (valid values are: 3 and 5)
* encryptionVersion - Auto (0) is fine for most AC units. If auto does not work then you can force v1 (1) or v2 (2) encryption version to use in network communication
* statusUpdateInterval - device status will be refreshed based on this interval (in seconds)
* sensorOffset - device temperature sensor offset value for current temperature calibration (default is 40 °C, must be specified in °C)
* minimumTargetTemperature - minimum target temperature accepted by the device (default is 16 °C, must be specified in °C, valid values: 16-30)
* maximumTargetTemperature - maximum target temperature accepted by the device (default is 30 °C, must be specified in °C, valid values: 16-30)
* xFanEnabled - automatically turn on xFan functionality in supported device modes (xFan actual setting is not modified by the Home App if disabled)
* temperatureSensor - control additional temperature sensor accessory in Home App (disabled = do not add to Home App / child = add as a child accessory / separate = add as a separate (independent) accessory)
* overrideDefaultVerticalSwing - by default this plugin does not change the vertical swing position of the AC unit but some devices do not keep the original vertical position set by the remote control if controlled from Homebridge and return back to device default position; this setting allows to override the default position -> if AC unit is set to default vertical swing position Homebridge modifies it to a predefined position (set by defaultVerticalSwing) (Never (0) = turn off override, let device use default / After power on (1) = override default position on each power on / After power on and swing disable (2) = override default position on each power on and each time when swing is switched to disabled)
* defaultVerticalSwing - specify the vertical swing position to be used instead of device default when overriding is enabled (Device default (0) = use device default, same position as used by device by default without overriding / one of the following 5 positions: fixed Highest (2), fixed Higher (3), fixed Middle (4), fixed Lower (5), fixed Lowest (6))
* disabled - set to true if you do not want to control this device in the Home App (old devices can be removed using this parameter)

![Homebridge UI](./uiconfig.jpg)

## Tips

### MAC Address in GREE+ mobile app

Open selected device and in the upper right corner select menu symbol:

![AC device](./greedevice.jpg)![MAC Address](./greemac.jpg)

### Network broadcast address

All devices on the local network use the same broadcast address. The broadcast address can be calculated from the IP address and the subnet mask of any device which is connected to the LAN. (E.g. your router or computer) You can find several online calculators which help to determine the broadcast address.

On Unix-like systems you can query the broadcast address using the following command:
```bash
ifconfig | grep broadcast
# result
# inet 192.168.1.10 netmask 0xffffff00 broadcast 192.168.1.255
```
On Windows there is no easy way to read the broadcast address. You can query the IP address and the subnet mask using the following command:
```cmd
ipconfig
# result
# IPv4 Address. . . . . . . . . . . : 192.168.1.10
# Subnet Mask . . . . . . . . . . . : 255.255.255.0
# Default Gateway . . . . . . . . . : 192.168.1.254
```
You have to calculate the broadcast address from the IP address and the Subnet mask.

### Device settings

Some settings are initialized by Home App only once (when enabling the device). They can only be changed by disabling and re-enabling the device. The following settings are affected:

* name
* model
* speedSteps

All other settings are applied when starting up Homebridge. You have to restart Homebridge to apply changes in configuration settings.

### Temperature display units

Home App allows to set the device temperature display units but it is independent from the temperature units shown in Home App. Home App always displays temperature values as specified by iOS/MacOS (can be changed in Preferences / Regional settings section). Display unit conversion is made by the Home App device (e.g. iPhone).

### Temperature measurement

Temperature measurement is not perfect if using the built-in sensor. It is highly affected by current operation and can differ from actual temperature of other places in the room. It is recommended to use a sperarate temperature sensor and place it not too close to the AC unit if you plan to set up automations based on temperature values.

### Invalid room temperature

Some AC units have a built-in temperature sensor but the actual room temperature is not displayed in Home App. This is an AC firmware problem. Older firware versions do not report temperature values at all and there are some firmware versions which report a fixed value (e.g. zero) instead of the measured one. This plugin replaces the missing value and the fixed zero value by the desired target temperature. To get the correct measured temperature please try to upgrade or downgrade the AC firmware.

### Fan speed

Fan speed is adjustable on the Heater Cooler's settings page in Home App. There is a gear icon in the buttom right corner of the Heater Cooler page if it was opened from the Home App (gear icon is missing if opened from control center or home view of control center). This gear icon can be used to access settings (and fan speed).

![Home App Heater Cooler settings](./ha_settings.jpg)

Slider description: Zero means off. Minimum value turns on Quiet mode. Next value is Auto mode. Maximum value is Powerful mode. All other values between them are exact fan speeds (Low, MediumLow**, Medium, MediumHigh**, High)

** these values are supported only on 5-speed models

## Refs & Credits

Special thanks to [tomikaa87](https://github.com/tomikaa87) and [kongkx](https://github.com/kongkx) for GREE network protocol information and code samples. Thank you [mateuszm7](https://github.com/mateuszm7) and [zivanek](https://github.com/zivanek) for helping to implement the version 2 network protocol.

- [homebridge-gree-air-conditioner](https://github.com/kongkx/homebridge-gree-air-conditioner)
- [gree-remote](https://github.com/tomikaa87/gree-remote)
- [homebridge-gree-heatercooler](https://github.com/ddenisyuk/homebridge-gree-heatercooler)
- [Homebridge API](https://developers.homebridge.io/)
- [Homebridge Platform Plugin Template](https://github.com/homebridge/homebridge-plugin-template)
- [HomeAssistant-GreeClimateComponent](https://github.com/RobHofmann/HomeAssistant-GreeClimateComponent)