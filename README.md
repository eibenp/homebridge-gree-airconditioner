# Homebridge GREE Air Conditioner Platform Plugin

[Homebridge GREE Air Conditioner Platform Plugin](https://github.com/eibenp/homebridge-gree-airconditioner) is a dynamic platform plugin for [Homebridge](https://github.com/homebridge/homebridge) which allows control of GREE Air Conditioner devices from [Apple's Home app](https://www.apple.com/home-app/). (Make GREE Air Conditioner HomeKit compatible.)

You can add all of your GREE Air Conditioner devices to the Home App by specifying the network broadcast address, and Homebridge will find all connected devices. Each device appears in the Home App as a Heater Cooler device and also as a separate Termperature Sensor (if temperature sensor is supported by the physical device). This allows to define automations (e.g. turn on) based on current temperature in the room.

Quiet / Auto / Powerful mode is supported by the fan speed control. Minimum value turns on Quite mode. Next value is Auto mode. Maximum value is Powerful mode. All other values between them are exact fan speeds (Low, MediumLow**, Medium, MediumHigh**, High)

** these values are supported only on 5-speed units

It is recommended, to add all devices to the Homebridge configuration. So you can control all parameters of the devices and also disable them, if not all of them should be controlled using the Home App. Devices are identified by MAC Address (Serial Number). It can be queried by the official [GREE+ mobile app](https://apps.apple.com/us/app/gree/id1167857672). (The app is required to connect the devices to the local WiFi network for the first time.)

xFan function is also supported, but it works automatically if enabled in Homebridge configuration. If xFan is enabled for the device it is automatically turned on when you select a supported operating mode in Home App. If xFan is disabled then the Home App will not modify it's actual setting in any case.

## Requirements

* Node.js (>= 18.17.0) with NPM
* Homebridge (>= 1.6.0)

You need to specify the local network broadcast address (192.168.1.255 in many home environments) and also recommended to add the device and specify it's MAC address (Serial Number) in configuration file.

It is highly recommended to use static IP addresses for connected devices. Using dynamic IP address may require restarting the Homebridge service on address change to reconnect the device. Most routers offer static DHCP leases. (Please see your router documentation!)

## Installation instructions

It is recommended to install the plugin using the graphical user interface of Homebridge ([Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x)). You can find the plugin if you search on the Plugins page for GREE Air Conditioner. It is recommended to configure the plugin using the same GUI controls.

Command line install:
```
npm install @eibenp/homebridge-gree-airconditioner -g
```
If successfully installed and configured then your devices will appear on the Homebridge GUI Accessories page (2 items for supported devices (Heater Cooler and Temperature Sensor)) and also in Home App (if Homebridge is already connected to the Home App).

## Example configuration
_Only relevant part of the configuration file is displayed:_
```
    "platforms": [
        {
            "name": "Gree Air Conditioner",
            "platform": "GREEAirConditioner",
            "port": 7002,
            "scanAddress": "192.168.1.255",
            "scanCount": 10,
            "scanTimeout": 5,
            "devices": [
                {
                    "mac": "502cc6000000",
                    "name": "Living room AC",
                    "model": "Pulse 3.2kW GWH12AGB-K6DNA1A/I",
                    "speedSteps": 5,
                    "statusUpdateInterval": 10,
                    "sensorOffset": 40,
                    "minimumTargetTemperature": 16,
                    "maximumTargetTemperature": 30,
                    "xFanEnabled": true,
                    "disabled": false
                }
            ]
        }
    ]
```
* name - Unique name of the platform plugin
* platform - **GREEAirConditioner** (fixed name, it identifies the plugin)
* port - free UDP port (homebridge will use this port for network communication; it is recommended to select a port which is not used and the next 256 ports are also available because devices will be bound to a separate port based on the last part of the device IPv4 address and the port specified in the configuration)
* scanAddress - local network broadcast address (some network knowledge is required to determine this address; in many cases it is default to 192.168.1.255)
* scanCount - number of retries for locating devices on the network (minimum 3 retries have to be specified)
* scanTimeout - time period in seconds between device query retries
* devices - devices should be listed in this block (specify as many devices as you have on your network)
* mac - MAC address (Serial Number) of the device
* name - custom name of the device (optional)
* model - model name, information only (optional)
* speedSteps - fan speed steps of the unit (valid values are: 3 and 5)
* statusUpdateInterval - device status will be refreshed based in this interval (in seconds)
* sensorOffset - device temperature sensor offset value for current temperature calibration (default is 40 celsius, must be specified in celsius)
* minimumTargetTemperature - minimum target temperature accepted by the device (default is 16 celsius, must be specified in celsius)
* maximumTargetTemperature - maximum target temperature accepted by the device (default is 30 celsius, must be specified in celsius)
* xFanEnabled - automatically turn on xFan functionality in supported device modes (xFan actual setting is not modified by the Home App if disabled)
* disabled - set to true if you do not want to control this device in the Home App (old devices can be removed using this parameter)

## Tips

### Network broadcast address

All devices on the local network use the same broadcast address. Broadcast address can be calculated from the IP address and the subnet mask of any device which is connected to the LAN. (E.g. your router or computer) You can find several online calculators which help to determine the broadcast address.

On Unix like systems you can query the broadcast address using the following command:
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
## Refs & Credits

Special thanks to [tomikaa87](https://github.com/tomikaa87) and [kongkx](https://github.com/kongkx) for GREE network protocol information and code samples.

- [homebridge-gree-air-conditioner](https://github.com/kongkx/homebridge-gree-air-conditioner)
- [gree-remote](https://github.com/tomikaa87/gree-remote)
- [homebridge-gree-heatercooler](https://github.com/ddenisyuk/homebridge-gree-heatercooler)
- [Homebridge API](https://developers.homebridge.io/)
- [Homebridge Platform Plugin Template](https://github.com/homebridge/homebridge-plugin-template)