# Changelog

## [2.3.0-beta.7] - 2026-01-04

**<ins>Reminders:</ins>**
- **All devices on the local subnet are automatically added to Homebridge since v2.1.7** Please use the "disabled" parameter to disable individual devices, or disable automatic device detection globally starting from version v2.2.2.
- **If the fan control is disabled, the Home App interprets the device in fan mode as if it is turned off.**
- **Similarly, the dry mode is considered to be off by the Home App, because the dry mode is not supported at all.**

When upgrading from v2.0.0 - v2.1.1 to v2.1.2 or later, configuration settings should be updated.
The following configuration parameters are applied only once, when the device is enabled:
* name
* model
* speedSteps
* minimumTargetTemperature
* maximumTargetTemperature
* temperatureStepSize

Changes of the above parameters are ignored until the device is disabled and re-enabled. But keep in mind that disabling the device breaks all associated automations in Home App also.

### New features
- GCloud support
- Multilingual configuration UI (requires [Homebridge UI](https://github.com/homebridge/homebridge-config-ui-x) v5.13.0 or later)

## [2.2.2] - 2025-12-10

**<ins>Reminders:</ins>**
- **All devices on the local subnet are automatically added to Homebridge since v2.1.7** Please use the "disabled" parameter to disable individual devices, or disable automatic device detection globally starting from version v2.2.2.
- **If the fan control is disabled, the Home App interprets the device in fan mode as if it is turned off.**
- **Similarly, the dry mode is considered to be off by the Home App, because the dry mode is not supported at all.**

When upgrading from v2.0.0 - v2.1.1 to v2.1.2 or later, configuration settings should be updated.
The following configuration parameters are applied only once, when the device is enabled:
* name
* model
* speedSteps
* minimumTargetTemperature
* maximumTargetTemperature
* temperatureStepSize

Changes of the above parameters are ignored until the device is disabled and re-enabled. But keep in mind that disabling the device breaks all associated automations in Home App also.

### New features
- Define silent time range when AC unit doesn't beep on commands (not all firmware versions support muting)
- It is possible to disable device auto detection

### Updates
- Show deprecated configuration parameter warning only once per device
- If Homebridge is configured to use only selected network interfaces then the plugin's auto detection will work only on these selected interfaces

#### Updated dependencies
- Added Node.js v24 to supported versions (20.19.0 or later, 22.13.0 or later and 24.0.0 or later are supported)
- Node.js v18 is not supported any more

## [2.2.1] - 2025-05-26

**<ins>Reminders:</ins>**
- **All devices on the local subnet are automatically added to Homebridge since v2.1.7 Please use the "disabled" parameter to skip any device!**
- **If the fan control is disabled, the Home App interprets the device in fan mode as if it is turned off.**
- **Similarly, the dry mode is considered to be off by the Home App, because the dry mode is not supported at all.**

When upgrading from v2.0.0 - v2.1.1 to v2.1.2 or later, configuration settings should be updated.
The following configuration parameters are applied only once, when the device is enabled:
* name
* model
* speedSteps
* minimumTargetTemperature
* maximumTargetTemperature
* temperatureStepSize

Changes of the above parameters are ignored until the device is disabled and re-enabled. But keep in mind that disabling the device breaks all associated automations in Home App also.

### Fixes
- Locked pending command is now unlocked if a status message arrives

## [2.2.0] - 2025-02-01

**<ins>Reminders:</ins>**
- **All devices on the local subnet are automatically added to Homebridge since v2.1.7 Please use the "disabled" parameter to skip any device!**
- **If the fan control is disabled, the Home App interprets the device in fan mode as if it is turned off.**
- **Similarly, the dry mode is considered to be off by the Home App, because the dry mode is not supported at all.**

When upgrading from v2.0.0 - v2.1.1 to v2.1.2 or later, configuration settings should be updated.
The following configuration parameters are applied only once, when the device is enabled:
* name
* model
* speedSteps
* minimumTargetTemperature
* maximumTargetTemperature
* temperatureStepSize

Changes of the above parameters are ignored until the device is disabled and re-enabled. But keep in mind that disabling the device breaks all associated automations in Home App also.

### New features
- Support of customized default parameters
- Support of fan mode
- 'Override default vertical swing position' functionality extended with new cases (also configuration parameter renamed) _Please see the documentation for more details!_

### Fixes
- Minimal configuration without a "devices" entry failed to load
- Sometimes the plugin has sent multiple power commands to the device before device response
- Vertical swing position was overridden on mode change, which was not the designed and documented behaviour
- In some cases, certain speed values ​​could not be set
- Plugin allowed sending some unsupported combination of parameters to the device

### Updates
- In versions before v2.2.0 fan and dry modes were considered to be auto heating-cooling mode by Home App. Now - by default - these modes are considered to be off by Home App, but fan mode support can be enabled.

## [2.1.7] - 2024-12-27

**Unlisted devices are not skipped any more if they are on the same subnet. If you want to skip them please add these devices to the configuration and set the "disabled" parameter to true!**

**<ins>Reminder:</ins> New (v2) network encryption protocol supported since v2.1.0**

When upgrading from v2.0.0 - v2.1.1 to v2.1.2 or later, configuration settings should be updated.
The following configuration parameters are applied only once, when the device is enabled:
* name
* model
* speedSteps
* minimumTargetTemperature
* maximumTargetTemperature
* temperatureStepSize

Changes of the above parameters are ignored until the device is disabled and re-enabled. But keep in mind that disabling the device breaks all associated automations in Home App also.

### Updates
- Addig all devices to the configuration is not needed any more.

Starting from version 2.1.7 all devices on the same subnet are detected and used automatically. Addig a device to the configuration is required only if default configuration is not appropriate. Please see the documentation to check default device parameters!

## [2.1.6] - 2024-11-28

**<ins>Reminder:</ins> New (v2) network encryption protocol supported since v2.1.0**

When upgrading from v2.0.0 - v2.1.1 to v2.1.2 or later, configuration settings should be updated.
The following configuration parameters are applied only once, when the device is enabled:
* name
* model
* speedSteps
* minimumTargetTemperature
* maximumTargetTemperature
* temperatureStepSize

Changes of the above parameters are ignored until the device is disabled and re-enabled. But keep in mind that disabling the device breaks all associated automations in Home App also.

### Updates
- Extended heating threshold temperature range: 8°C~30°C (works only on selected models)

### New features
- Added new configuration parameter: temperatureStepSize

### Fixes
- Fixed heating / cooling threshold minimum and maximum value settings on accessory initialization
- Heating / Cooling threshold temperature handling has aligned to physical AC unit capabilities

## [2.1.5] - 2024-11-12

**<ins>Reminder:</ins> New (v2) network encryption protocol supported since v2.1.0**

When upgrading from v2.0.0 - v2.1.1 to v2.1.2 or later, configuration settings should be updated.

### Fixes
- Fixed invalid temperature sensor data detection (valid temperature values are in range -39°C ~ +59 °C) - if the device reports an invalid value, then plugin assumes that the device doesn't have a built-in temperature sensor

## [2.1.4] - 2024-11-11

**<ins>Reminder:</ins> New (v2) network encryption protocol supported since v2.1.0**

When upgrading from v2.0.0 - v2.1.1 to v2.1.2 or later, configuration settings should be updated.

### New features
- Added support of devices with hardware version V3.x which use a mix of V1 and V2 network encryptions
- Reorganized device registration with binding error detection

### Fixes
- Fixed error on disabling device after successful registration
- After homebridge startup, don't wait before scanning devices on the network
- Handling conflicting port numbers

## [2.1.3] - 2024-11-05

**<ins>Reminder:</ins> New (v2) network encryption protocol supported since v2.1.0**

When upgrading from v2.0.0 - v2.1.1 to v2.1.2 or later, configuration settings should be updated.

#### Updated dependencies
- added Node.js v22 to supported versions (18.15.0 or later, 20.7.0 or later and 22.0.0 or later are supported)

### New features
- new optional IP address parameter to support devices on different subnets
- new optional device port parameter to support cases when automatic port assigment is not appropriate

### Fixes
- consistent xFan default setting in configuration UI and in plugin behaviour

## [2.1.2] - 2024-10-01

**<ins>Reminder:</ins> New (v2) network encryption protocol supported since v2.1.0**

When upgrading from v2.0.0 - v2.1.1 to v2.1.2, configuration settings should be updated.

#### Configuration update steps

- <ins>Recommended:</ins> Using the graphical user interface of Homebridge ([Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x))
  1) Open plugin configuration
  1) Review and update settings if needed
  1) Save changes _(pressing the Save button is required to update the configuration to new version even if no changes needed in the displayed values)_
  1) Restart Homebridge
- **OR** <ins>Alternative:</ins> Edit the configuration file directly
  1) Remove the following parameters from the platform section:
     - port _(it may be kept if you want to set the UDP port manually)_
     - scanAddress
     - scanCount
     - scanTimeout
  1) Optionally you can add the following parameter to the platform section:
     - scanInterval _(default is 60 if missing, needed only if other value required)_
  1) Save changes
  1) Restart Homebridge

#### Updated dependencies
- homebridge-config-ui-x 4.59.0 or later required
- added homebridge 2.0.0-beta.0 and later to supported versions

### New features

- Simplified configuration
  - Broadcast address not needed any more
  - UDP port is optional
  - Scan count and scan timeout replaced with scan interval parameter
- AC units can have dynamic addresses

### Fixes

- Fixed "Failed to save cached accessories to disk: Converting circular structure to JSON" error

## [2.1.1] - 2024-06-25

**New (v2) network encryption protocol supported since v2.1.0**

- Updated dependencies (homebridge-config-ui-x 4.56.3 or later required)

### Fixes

- Do not show error on unknown network packets received from non GREE devices

## [2.1.0] - 2024-06-23

### New features

- New encryption protocol added to support latest AC devices (e.g. GREE CS532AE Wifi Modul, GREE GRJ532-J14 Wifi Modul, GREE GEH12AA-K6DNA1A, GREE GWH14QD-K3NNB4D/I, etc.)
- New configuration parameter added to force network encryption version

### Fixes

- Fixed "error:1C80006B:Provider routines::wrong final block length" error
- Fixed incorrect display of current temperature on devices without temperature sensor (on devices without sensor the target temperature is displayed in Home App)
  Some AC firmware versions do not report the measured temperature but the device has a built-in sensor. They are handled as devices without sensor.

## [2.0.2] - 2024-06-04

### New features

- Override default fixed vertical swing position to a predefined position

### Fixes

- Fixed registration problem of unsupported devices (Unsupported devices were registered successfully
  but Homebridge could not control them. Unsupported devices won't be registered any more.)
- Valid port value verification

## [2.0.1] - 2024-04-21

- Fixed error on setting Threshold Temperature minimum and maximum values
- Improved debug logging
- Updated dependencies (Homebridge 1.8.0 or later required)

## [2.0.0] - 2023-10-26

Homebridge platform plugin. **_homebridge-gee-ac_**

**Don't forget to reconfigure the plugin and re-set-up scenes and automations in Home App if upgraded from earlier version!**

### Major changes

- Completly rewritten from the base as a platform plugin
- This is the successor of the original platform plugin _@eibenp/homebridge-gree-airconditioner_ which is now obsolete on that name

## [1.0.x]

All 1.0.x versions are now obsolete

- Original accessory plugin _homebridge-gee-ac_ maintained by _duculete_
- Original platform plugin _@eibenp/homebridge-gree-airconditioner_ maintained by _eibenp_