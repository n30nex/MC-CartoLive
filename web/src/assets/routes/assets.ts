import { activeAssetPack } from '../v3/assetPacks';

export const routeAssetIcons = {
  app: activeAssetPack.brand.appIcon,
  repeater: activeAssetPack.roles.repeater,
  companion: activeAssetPack.roles.companion,
  room: activeAssetPack.roles.room,
  observer: activeAssetPack.roles.observer,
  sensor: activeAssetPack.roles.sensor,
  tower: activeAssetPack.roles.antennaTower,
  unknown: activeAssetPack.roles.unknown,
  gateway: activeAssetPack.roles.gateway,
  solarRepeater: activeAssetPack.roles.solarRepeater,
  mobileCompanion: activeAssetPack.roles.mobileCompanion,
  mqttBridge: activeAssetPack.roles.mqttBridge
};

export const routePacketDots: Record<string, string> = {
  ADVERT: activeAssetPack.packets.ADVERT,
  PLAIN_TEXT: activeAssetPack.packets.PLAIN_TEXT,
  GROUP_TEXT: activeAssetPack.packets.GROUP_TEXT,
  GROUP_DATA: activeAssetPack.packets.GROUP_DATA,
  TRACE: activeAssetPack.packets.TRACE,
  RETURNED_PATH: activeAssetPack.packets.RETURNED_PATH,
  REQUEST: activeAssetPack.packets.REQUEST,
  RESPONSE: activeAssetPack.packets.RESPONSE,
  ACK: activeAssetPack.packets.ACK,
  CONTROL: activeAssetPack.packets.CONTROL,
  OTHER: activeAssetPack.packets.OTHER
};
