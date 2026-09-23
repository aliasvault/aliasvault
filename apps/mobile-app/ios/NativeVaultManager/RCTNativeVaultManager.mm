#import "RCTNativeVaultManager.h"
#import <ExpoModulesCore-Swift.h>
#import "AliasVault-Swift.h"

@interface RCTNativeVaultManager () <NativeVaultManagerSpec>
@end

/**
 * This objective-c class is used as a bridge to allow React Native to interact with the underlying
 * Swift VaultManager class and communicates with the VaultStore that is used by both React Native
 * and the native iOS Autofill extension.
 *
 * This class should implement all methods defined in the specs/NativeVaultManager.ts TurboModule.
 * When adding a new method, make sure to update the spec .ts file first and then run `pod install` to
 * update the spec which generates the interface this class implements.
 */
@implementation RCTNativeVaultManager {
    VaultManager *vaultManager;
}

+ (NSString *)moduleName {
    return @"NativeVaultManager";
}

- (id) init {
   if (self = [super init]) {
    vaultManager = [VaultManager new];
   }
   return self;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
    return std::make_shared<facebook::react::NativeVaultManagerSpecJSI>(params);
}

- (void)clearVault {
    [vaultManager clearVault];
}

- (void)executeQuery:(NSString *)query params:(NSArray *)params resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager executeQuery:query params:params resolver:resolve rejecter:reject];
}

- (void)executeUpdate:(NSString *)query params:(NSArray *)params resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager executeUpdate:query params:params resolver:resolve rejecter:reject];
}

- (void)executeRaw:(NSString *)query resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager executeRaw:query resolver:resolve rejecter:reject];
}

- (void)beginTransaction:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager beginTransaction:resolve rejecter:reject];
}

- (void)commitTransaction:(NSString *)scope resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager commitTransaction:scope resolver:resolve rejecter:reject];
}

- (void)rollbackTransaction:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager rollbackTransaction:resolve rejecter:reject];
}

- (void)persistAndMarkDirty:(NSString *)scope resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager persistAndMarkDirty:scope resolver:resolve rejecter:reject];
}

- (void)getAuthMethods:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getAuthMethods:resolve rejecter:reject];
}

- (void)getAutoLockTimeout:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getAutoLockTimeout:resolve rejecter:reject];
}

- (void)getVaultMetadata:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getVaultMetadata:resolve rejecter:reject];
}

- (void)hasEncryptedDatabase:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager hasEncryptedDatabase:resolve rejecter:reject];
}

- (void)isVaultUnlocked:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager isVaultUnlocked:resolve rejecter:reject];
}

- (void)setAuthMethods:(NSArray *)authMethods resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager setAuthMethods:authMethods resolver:resolve rejecter:reject];
}

- (void)setAutoLockTimeout:(double)timeout resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager setAutoLockTimeout:timeout resolver:resolve rejecter:reject];
}

- (void)storeMetadata:(NSString *)metadata resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager storeMetadata:metadata resolver:resolve rejecter:reject];
}

- (void)storeUnlockKeyInMemory:(NSString *)base64UnlockKey resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager storeUnlockKeyInMemory:base64UnlockKey resolver:resolve rejecter:reject];
}

- (void)storeUnlockKey:(NSString *)base64UnlockKey resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager storeUnlockKey:base64UnlockKey resolver:resolve rejecter:reject];
}

- (void)clearEncryptionKeyFromMemory:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager clearEncryptionKeyFromMemory:resolve rejecter:reject];
}

- (void)storeUnlockKeyDerivationParams:(NSString *)keyDerivationParams resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager storeUnlockKeyDerivationParams:keyDerivationParams resolver:resolve rejecter:reject];
}

- (void)getUnlockKeyDerivationParams:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getUnlockKeyDerivationParams:resolve rejecter:reject];
}

- (void)storeAccountKeyChain:(NSString *)chainJson resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager storeAccountKeyChain:chainJson resolver:resolve rejecter:reject];
}

- (void)getAccountKeyChain:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getAccountKeyChain:resolve rejecter:reject];
}

- (void)resolveVaultKey:(NSString *)base64DerivedKey resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager resolveVaultKey:base64DerivedKey resolver:resolve rejecter:reject];
}

- (void)getPersonalManifestId:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getPersonalManifestId:resolve rejecter:reject];
}

- (void)decryptInvitationName:(NSString *)encryptedName resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager decryptInvitationName:encryptedName resolver:resolve rejecter:reject];
}

- (void)unlockVault:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager unlockVault:resolve rejecter:reject];
}

- (void)clearVault:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager clearVault];
    resolve(nil);
}

- (void)clearSession:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager clearSession];
    resolve(nil);
}

- (void)getEncryptedDatabase:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getEncryptedDatabase:resolve rejecter:reject];
}

- (void)deriveKeyFromPassword:(NSString *)password salt:(NSString *)salt encryptionType:(NSString *)encryptionType encryptionSettings:(NSString *)encryptionSettings resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager deriveKeyFromPassword:password salt:salt encryptionType:encryptionType encryptionSettings:encryptionSettings resolver:resolve rejecter:reject];
}

- (void)openAutofillSettingsPage:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager openAutofillSettingsPage:resolve rejecter:reject];
}

- (void)getAutofillShowSearchText:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getAutofillShowSearchText:resolve rejecter:reject];
}

- (void)setAutofillShowSearchText:(BOOL)showSearchText resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager setAutofillShowSearchText:showSearchText resolver:resolve rejecter:reject];
}

- (void)getAutofillCopyTotpOnFill:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getAutofillCopyTotpOnFill:resolve rejecter:reject];
}

- (void)setAutofillCopyTotpOnFill:(BOOL)enabled resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager setAutofillCopyTotpOnFill:enabled resolver:resolve rejecter:reject];
}

- (void)copyToClipboardWithExpiration:(NSString *)text expirationSeconds:(double)expirationSeconds localOnly:(BOOL)localOnly resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager copyToClipboardWithExpiration:text expirationSeconds:expirationSeconds localOnly:localOnly resolver:resolve rejecter:reject];
}

- (void)generateTotpCode:(NSString *)secret algorithm:(NSString *)algorithm digits:(double)digits period:(double)period resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager generateTotpCode:secret algorithm:algorithm digits:digits period:period resolver:resolve rejecter:reject];
}

// MARK: - Android-specific methods (stubs for iOS)

- (void)isIgnoringBatteryOptimizations:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    // Only used by Android, return true.
    resolve(@(YES));
}

- (void)requestIgnoreBatteryOptimizations:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    // Only used by Android, return true.
    resolve(@"Not applicable on iOS");
}

- (void)registerCredentialIdentities:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager registerCredentialIdentities:resolve rejecter:reject];
}

- (void)removeCredentialIdentities:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager removeCredentialIdentities:resolve rejecter:reject];
}

// MARK: - WebAPI Configuration

- (void)setApiUrl:(NSString *)url resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager setApiUrl:url resolver:resolve rejecter:reject];
}

- (void)getApiUrl:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getApiUrl:resolve rejecter:reject];
}

- (void)setCustomProxyHeaders:(NSString *)headersJson resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager setCustomProxyHeaders:headersJson resolver:resolve rejecter:reject];
}

- (void)getCustomProxyHeaders:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getCustomProxyHeaders:resolve rejecter:reject];
}

// MARK: - WebAPI Token Management

- (void)setAuthTokens:(NSString *)accessToken refreshToken:(NSString *)refreshToken resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager setAuthTokens:accessToken refreshToken:refreshToken resolver:resolve rejecter:reject];
}

- (void)getAccessToken:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getAccessToken:resolve rejecter:reject];
}

- (void)clearAuthTokens:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager clearAuthTokens:resolve rejecter:reject];
}

- (void)revokeTokens:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager revokeTokens:resolve rejecter:reject];
}

// MARK: - WebAPI Request Execution

- (void)executeWebApiRequest:(NSString *)method endpoint:(NSString *)endpoint body:(NSString *)body headers:(NSString *)headers requiresAuth:(BOOL)requiresAuth resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager executeWebApiRequest:method endpoint:endpoint body:body headers:headers requiresAuth:requiresAuth resolver:resolve rejecter:reject];
}

// MARK: - Username Management

- (void)setUsername:(NSString *)username resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager setUsername:username resolver:resolve rejecter:reject];
}

- (void)getUsername:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getUsername:resolve rejecter:reject];
}

- (void)clearUsername:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager clearUsername:resolve rejecter:reject];
}

// MARK: - Server Version Management

- (void)isServerVersionGreaterThanOrEqualTo:(NSString *)targetVersion resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager isServerVersionGreaterThanOrEqualTo:targetVersion resolver:resolve rejecter:reject];
}

- (void)getServerVersion:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getServerVersion:resolve rejecter:reject];
}

- (void)getCapabilities:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getCapabilities:resolve rejecter:reject];
}

// MARK: - Offline Mode Management

- (void)setOfflineMode:(BOOL)isOffline resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager setOfflineMode:isOffline resolver:resolve rejecter:reject];
}

- (void)getOfflineMode:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getOfflineMode:resolve rejecter:reject];
}

// MARK: - Vault Sync

- (void)checkSyncStatus:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager checkSyncStatus:resolve rejecter:reject];
}

- (void)syncVaultWithServer:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager syncVaultWithServer:resolve rejecter:reject];
}

- (void)getVaultMigrationStatus:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getVaultMigrationStatus:resolve rejecter:reject];
}

- (void)migrateVaultManifest:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager migrateVaultManifest:resolve rejecter:reject];
}

- (void)runSharingOperation:(NSString *)operation paramsJson:(NSString *)paramsJson resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager runSharingOperation:operation paramsJson:paramsJson resolver:resolve rejecter:reject];
}

- (void)getVaultSyncLogs:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getVaultSyncLogs:resolve rejecter:reject];
}

// MARK: - Sync State Management

- (void)getSyncState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getSyncState:resolve rejecter:reject];
}

- (void)markVaultClean:(double)mutationSeqAtStart newServerRevision:(double)newServerRevision resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager markVaultClean:(NSInteger)mutationSeqAtStart newServerRevision:(NSInteger)newServerRevision resolver:resolve rejecter:reject];
}

- (void)clearEncryptedVaultForFreshDownload:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager clearEncryptedVaultForFreshDownload:resolve rejecter:reject];
}

// MARK: - PIN Unlock

- (void)isPinEnabled:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager isPinEnabled:resolve rejecter:reject];
}

- (void)isKeystoreAvailable:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager isKeystoreAvailable:resolve rejecter:reject];
}

- (void)isBiometricsAvailableOnDevice:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager isBiometricsAvailableOnDevice:resolve rejecter:reject];
}

- (void)isBiometricUnlockAvailable:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager isBiometricUnlockAvailable:resolve rejecter:reject];
}

- (void)removeAndDisablePin:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager removeAndDisablePin:resolve rejecter:reject];
}

- (void)showPinUnlock:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager showPinUnlock:resolve rejecter:reject];
}

- (void)showPinSetup:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager showPinSetup:resolve rejecter:reject];
}

- (void)showPasswordUnlock:(NSString *)title subtitle:(NSString *)subtitle buttonText:(NSString *)buttonText resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager showPasswordUnlock:title subtitle:subtitle buttonText:buttonText resolver:resolve rejecter:reject];
}

// MARK: - Mobile Login

- (void)encryptUnlockKeyForMobileLogin:(NSString *)publicKeyJWK resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager encryptUnlockKeyForMobileLogin:publicKeyJWK resolver:resolve rejecter:reject];
}

// MARK: - Re-authentication

- (void)authenticateUser:(NSString *)title subtitle:(NSString *)subtitle allowedMethods:(NSArray<NSString *> *)allowedMethods buttonText:(NSString *)buttonText recentUnlockGraceSeconds:(double)recentUnlockGraceSeconds resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager authenticateUser:title subtitle:subtitle allowedMethods:allowedMethods buttonText:buttonText recentUnlockGraceSeconds:recentUnlockGraceSeconds resolver:resolve rejecter:reject];
}

- (void)deriveSrpProof:(NSString *)salt srpIdentity:(NSString *)srpIdentity serverEphemeral:(NSString *)serverEphemeral resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager deriveSrpProof:salt srpIdentity:srpIdentity serverEphemeral:serverEphemeral resolver:resolve rejecter:reject];
}

// MARK: - QR Code Scanner

- (void)scanQRCode:(NSArray<NSString *> *)prefixes statusText:(NSString *)statusText resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager scanQRCode:prefixes statusText:statusText resolver:resolve rejecter:reject];
}

// MARK: - App Store Review

- (void)isAppReviewAvailable:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager isAppReviewAvailable:resolve rejecter:reject];
}

- (void)requestAppReview:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager requestAppReview:resolve rejecter:reject];
}

- (void)getAppInstallDate:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getAppInstallDate:resolve rejecter:reject];
}

// MARK: - Client core bridge

- (void)rustCall:(NSString *)name argsJson:(NSString *)argsJson resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager rustCall:name argsJson:argsJson resolver:resolve rejecter:reject];
}

- (void)storeEncryptedDatabase:(NSString *)base64EncryptedDb resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager storeEncryptedDatabase:base64EncryptedDb resolver:resolve rejecter:reject];
}

@end
