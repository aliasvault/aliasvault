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

- (void)commitTransaction:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager commitTransaction:resolve rejecter:reject];
}

- (void)rollbackTransaction:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager rollbackTransaction:resolve rejecter:reject];
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

- (void)clearClipboardAfterDelay:(double)delayInSeconds resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager clearClipboardAfterDelay:delayInSeconds resolver:resolve rejecter:reject];
}

- (void)storeDatabase:(NSString *)base64EncryptedDb resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager storeDatabase:base64EncryptedDb resolver:resolve rejecter:reject];
}

- (void)storeMetadata:(NSString *)metadata resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager storeMetadata:metadata resolver:resolve rejecter:reject];
}

- (void)storeEncryptionKey:(NSString *)base64EncryptionKey resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager storeEncryptionKey:base64EncryptionKey resolver:resolve rejecter:reject];
}

- (void)storeEncryptionKeyDerivationParams:(NSString *)keyDerivationParams resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager storeEncryptionKeyDerivationParams:keyDerivationParams resolver:resolve rejecter:reject];
}

- (void)getEncryptionKeyDerivationParams:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getEncryptionKeyDerivationParams:resolve rejecter:reject];
}

- (void)unlockVault:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager unlockVault:resolve rejecter:reject];
}

- (void)clearVault:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager clearVault];
}

- (void)getEncryptedDatabase:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getEncryptedDatabase:resolve rejecter:reject];
}

- (void)getCurrentVaultRevisionNumber:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager getCurrentVaultRevisionNumber:resolve rejecter:reject];
}

- (void)setCurrentVaultRevisionNumber:(double)revisionNumber resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager setCurrentVaultRevisionNumber:revisionNumber resolver:resolve rejecter:reject];
}

- (void)deriveKeyFromPassword:(NSString *)password salt:(NSString *)salt encryptionType:(NSString *)encryptionType encryptionSettings:(NSString *)encryptionSettings resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager deriveKeyFromPassword:password salt:salt encryptionType:encryptionType encryptionSettings:encryptionSettings resolver:resolve rejecter:reject];
}

- (void)openAutofillSettingsPage:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager openAutofillSettingsPage:resolve rejecter:reject];
}

- (void)copyToClipboardWithExpiration:(NSString *)text expirationSeconds:(double)expirationSeconds resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    [vaultManager copyToClipboardWithExpiration:text expirationSeconds:expirationSeconds resolver:resolve rejecter:reject];
}

// MARK: - Android-specific methods (stubs for iOS)

- (void)canScheduleExactAlarms:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    // Only used by Android, return true.
    resolve(@(YES));
}

- (void)requestExactAlarmPermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    // Only used by Android, return true.
    resolve(@"Not applicable on iOS");
}

- (void)isIgnoringBatteryOptimizations:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    // Only used by Android, return true.
    resolve(@(YES));
}

- (void)requestIgnoreBatteryOptimizations:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    // Only used by Android, return true.
    resolve(@"Not applicable on iOS");
}

@end
