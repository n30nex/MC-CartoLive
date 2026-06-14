declare const __APP_VERSION__: string | undefined;
declare const __BUILD_NUMBER__: string | undefined;
declare const __GIT_SHA__: string | undefined;
declare const __BUILD_TIME__: string | undefined;
declare const __RELEASE_URL__: string | undefined;
declare const __APP_BRAND_NAME__: string | undefined;
declare const __APP_BRAND_URL__: string | undefined;
declare const __APP_BRAND_LOGO__: string | undefined;
declare const __APP_ASSET_PACK__: string | undefined;

export const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
export const buildNumber = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : '0';
export const gitSha = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : '';
export const buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
export const releaseURL = typeof __RELEASE_URL__ !== 'undefined' ? __RELEASE_URL__ : '';
export const appBrandName = typeof __APP_BRAND_NAME__ !== 'undefined' ? __APP_BRAND_NAME__ : '';
export const appBrandURL = typeof __APP_BRAND_URL__ !== 'undefined' ? __APP_BRAND_URL__ : '';
export const appBrandLogo = typeof __APP_BRAND_LOGO__ !== 'undefined' ? __APP_BRAND_LOGO__ : '';
export const appAssetPack = typeof __APP_ASSET_PACK__ !== 'undefined' ? __APP_ASSET_PACK__ : 'world';
