# Changelog

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