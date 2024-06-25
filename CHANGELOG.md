# Changelog

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