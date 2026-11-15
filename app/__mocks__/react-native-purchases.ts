// Jest stand-in for the native RevenueCat SDK, so tests that import src/payments load without native code.
const Purchases = {
  configure: jest.fn(),
  getCustomerInfo: jest.fn(async () => ({ entitlements: { active: {} }, nonSubscriptionTransactions: [] })),
  addCustomerInfoUpdateListener: jest.fn(),
  removeCustomerInfoUpdateListener: jest.fn(() => true),
  getOfferings: jest.fn(async () => ({ current: null, all: {} as Record<string, unknown> })),
  setAttributes: jest.fn(async () => {}),
  setMediaSource: jest.fn(async () => {}),
  setCampaign: jest.fn(async () => {}),
  presentCodeRedemptionSheet: jest.fn(async () => {}),
  restorePurchases: jest.fn(async () => ({ entitlements: { active: {} }, nonSubscriptionTransactions: [] })),
};

export default Purchases;
